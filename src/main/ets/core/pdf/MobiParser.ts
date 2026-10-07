/**
 * MobiParser — MOBI（PalmDB 容器）→ 章节文本（纯逻辑）。
 * 结构：PalmDB 头(78B)+记录表 → 记录0=PalmDOC 头(16B)+MOBI 头
 * → 记录1..N 文本记录（≤4096B，PalmDOC 压缩，回引不跨记录）
 * → 按 <mbp:pagebreak/> 分章，HTML 标记交给 HtmlText 剥除。
 * 编码：textEncoding 65001=UTF-8；1252 用 CP1252 映射表兜底。
 */

import { palmDocInflate } from './PalmDoc.ts';
import { htmlToText, htmlTitle } from '../html/HtmlText.ts';

export interface MobiChapter {
  title: string;
  text: string;
}

export interface MobiBook {
  title: string;
  chapters: MobiChapter[];
}

/** CP1252 高位字节 → Unicode（常用区间；未列出的按 Latin-1 直通） */
const CP1252_HIGH: Record<number, number> = {
  0x80: 0x20ac, 0x82: 0x201a, 0x83: 0x0192, 0x84: 0x201e, 0x85: 0x2026,
  0x86: 0x2020, 0x87: 0x2021, 0x88: 0x02c6, 0x89: 0x2030, 0x8a: 0x0160,
  0x8b: 0x2039, 0x8c: 0x0152, 0x8e: 0x017d, 0x91: 0x2018, 0x92: 0x2019,
  0x93: 0x201c, 0x94: 0x201d, 0x95: 0x2022, 0x96: 0x2013, 0x97: 0x2014,
  0x98: 0x02dc, 0x99: 0x2122, 0x9a: 0x0161, 0x9b: 0x203a, 0x9c: 0x0153,
  0x9e: 0x017e, 0x9f: 0x0178
};

function decodeBytes(bytes: Uint8Array, encoding: number): string {
  if (encoding === 65001) {
    return utf8DecodeLocal(bytes);
  }
  let out = '';
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i];
    if (b < 0x80 || (b >= 0xa0 && CP1252_HIGH[b] === undefined)) {
      out += String.fromCharCode(b);
    } else {
      const cp = CP1252_HIGH[b];
      out += String.fromCharCode(cp !== undefined ? cp : b);
    }
  }
  return out;
}

/** 本地 UTF-8 解码（避免依赖 zip/Utf8 造成模块环） */
function utf8DecodeLocal(bytes: Uint8Array): string {
  let out = '';
  let i = 0;
  while (i < bytes.length) {
    const b = bytes[i];
    if (b < 0x80) {
      out += String.fromCharCode(b);
      i += 1;
    } else if (b < 0xe0) {
      const cp = ((b & 0x1f) << 6) | (bytes[i + 1] & 0x3f);
      out += String.fromCharCode(cp);
      i += 2;
    } else if (b < 0xf0) {
      const cp = ((b & 0x0f) << 12) | ((bytes[i + 1] & 0x3f) << 6) | (bytes[i + 2] & 0x3f);
      out += String.fromCharCode(cp);
      i += 3;
    } else {
      const cp = (((b & 0x07) << 18) | ((bytes[i + 1] & 0x3f) << 12)
        | ((bytes[i + 2] & 0x3f) << 6) | (bytes[i + 3] & 0x3f)) - 0x10000;
      out += String.fromCharCode(0xd800 + (cp >> 10), 0xdc00 + (cp & 0x3ff));
      i += 4;
    }
  }
  return out;
}

function asciiAt(bytes: Uint8Array, off: number, len: number): string {
  let out = '';
  for (let i = 0; i < len; i++) {
    out += String.fromCharCode(bytes[off + i]);
  }
  return out;
}

export function parseMobi(bytes: Uint8Array): MobiBook {
  if (bytes.length < 132) {
    throw new Error('parseMobi: 文件过小（不是有效的 MOBI）');
  }
  if (asciiAt(bytes, 60, 8) !== 'BOOKMOBI') {
    throw new Error('parseMobi: 缺少 BOOKMOBI 标识（不是 MOBI 电子书）');
  }
  const numRecords = (bytes[76] << 8) | bytes[77];
  if (numRecords <= 0) {
    throw new Error('parseMobi: 无记录');
  }
  // 记录偏移表（78B 头之后）
  const offsets: number[] = [];
  for (let r = 0; r < numRecords; r++) {
    const p = 78 + r * 8;
    if (p + 8 > bytes.length) {
      break;
    }
    offsets.push((bytes[p] << 24) | (bytes[p + 1] << 16) | (bytes[p + 2] << 8) | bytes[p + 3]);
  }
  const rec0 = bytes.subarray(offsets[0], offsets.length > 1 ? offsets[1] : bytes.length);
  if (rec0.length < 24 || asciiAt(rec0, 16, 4) !== 'MOBI') {
    throw new Error('parseMobi: 记录0 缺少 MOBI 头（可能是纯 PalmDOC）');
  }
  const compression = (rec0[0] << 8) | rec0[1];
  const textRecordCount = (rec0[8] << 8) | rec0[9];
  const headerLen = (rec0[20] << 24) | (rec0[21] << 16) | (rec0[22] << 8) | rec0[23];
  const textEncoding = (rec0[28] << 24) | (rec0[29] << 16) | (rec0[30] << 8) | rec0[31];
  let hasExtraTrail = false;
  // extra record flags（multibyte 尾部）在 MOBI 头 offset 242（存在时）
  if (headerLen >= 232 && 16 + 232 + 2 <= rec0.length) {
    const fl = rec0[16 + 242];
    hasExtraTrail = (fl & 0x03) !== 0; // 简化：存在 extra data 即按 1..2 字节尾部处理
  }
  const fullNameOff = (rec0[16 + 84] << 24) | (rec0[16 + 85] << 16) | (rec0[16 + 86] << 8) | rec0[16 + 87];
  const fullNameLen = (rec0[16 + 88] << 24) | (rec0[16 + 89] << 16) | (rec0[16 + 90] << 8) | rec0[16 + 91];
  let title = '';
  if (fullNameOff >= 0 && fullNameOff + fullNameLen <= rec0.length && fullNameLen > 0 && fullNameLen < 1024) {
    title = decodeBytes(rec0.subarray(fullNameOff, fullNameOff + fullNameLen), textEncoding);
  }

  // 拼接文本记录并解压
  const chunks: Uint8Array[] = [];
  for (let r = 1; r <= textRecordCount && r < offsets.length; r++) {
    const start = offsets[r];
    let end = r + 1 < offsets.length ? offsets[r + 1] : bytes.length;
    if (hasExtraTrail && end > start) {
      // 变宽 extra data 尾部：自末尾回溯至高位 bit=1 的字节（K8 多字节记录）
      let back = 0;
      while (back < 4 && end - 1 - back > start && (bytes[end - 1 - back] & 0x80) === 0) {
        back += 1;
      }
      end = Math.max(start, end - (back + 1));
    }
    if (end <= start) {
      continue;
    }
    const raw = bytes.subarray(start, end);
    chunks.push(compression === 2 ? palmDocInflate(raw) : raw);
  }
  let total = 0;
  for (const c of chunks) {
    total += c.length;
  }
  const text = new Uint8Array(total);
  let pos = 0;
  for (const c of chunks) {
    text.set(c, pos);
    pos += c.length;
  }
  const html = decodeBytes(text, textEncoding);

  // 分章：<mbp:pagebreak/> 优先，退回 h1/h2
  let parts: string[] = html.split(/<mbp:pagebreak\s*\/?>/i);
  if (parts.length <= 1) {
    parts = html.split(/(<h[12][^>]*>[\s\S]*?<\/h[12]>)/i).filter((s: string): boolean => s.trim().length > 0);
  }
  const chapters: MobiChapter[] = [];
  for (const part of parts) {
    const body = htmlToText(part);
    if (body.trim().length === 0) {
      continue;
    }
    chapters.push({ title: htmlTitle(part), text: body });
  }
  if (chapters.length === 0) {
    throw new Error('parseMobi: 无可读章节内容');
  }
  return { title: title.trim(), chapters };
}
