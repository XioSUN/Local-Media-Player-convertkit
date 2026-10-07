/**
 * v3 管线看护：MOBI→PDF、PDF 合并（docs/TEST-GUARDS.md #11）
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

import { mobiToPdf } from '../src/main/ets/core/Converters.ts';
import { parseMobi } from '../src/main/ets/core/pdf/MobiParser.ts';
import { palmDocInflate, palmDocFlatten } from '../src/main/ets/core/pdf/PalmDoc.ts';
import { mergePdfs } from '../src/main/ets/core/pdf/PdfMerge.ts';
import { PdfWriter } from '../src/main/ets/core/pdf/PdfWriter.ts';
import { extractPdfText } from '../src/main/ets/core/pdf/PdfTextExtractor.ts';
import { MemoryZipSource } from '../src/main/ets/core/zip/ZipCodec.ts';
import { docxToPdf } from '../src/main/ets/core/Converters.ts';
import { detectDocKind } from '../src/main/ets/core/DocKind.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MEDIA = path.resolve(HERE, '../../../test-media/docs');
const inflate = (d: Uint8Array): Uint8Array => new Uint8Array(zlib.inflateSync(d));

// ── PalmDoc ─────────────────────────────────────────

test('PalmDoc：平凡压缩器 round-trip（含全部转义区间）', () => {
  // 覆盖 0x00 / 0x01-0x08 / 0x09-0x7F / 0x80-0xBF / 0xC0-0xFF 全区间
  const src = new Uint8Array(256);
  for (let i = 0; i < 256; i++) { src[i] = i; }
  const packed = palmDocFlatten(src);
  const back = palmDocInflate(packed);
  assert.deepEqual(Array.from(back), Array.from(src));
});

test('PalmDoc：回引解压正确（"AAAA" 型重复）', () => {
  // 手工构造：4 字面 'A' + 回引 dist=4 len=4 → 0xB0? dist=4,len=4: pair=(4<<3)|(4-3)=33=0x21 → 高字节 0x80|(33>>8)=0x80, 低 33
  const stream = new Uint8Array([65, 65, 65, 65, 0x80, 0x21]);
  const out = palmDocInflate(stream);
  assert.equal(Buffer.from(out).toString(), 'AAAAAAAA');
});

// ── MOBI 夹具与解析 ─────────────────────────────────

function buildMobi(title: string, chaptersHtml: string[], compress: boolean): Uint8Array {
  const pagebreak = '<mbp:pagebreak/>';
  const fullHtml = chaptersHtml.join(pagebreak);
  const textBytes = new TextEncoder().encode(fullHtml);
  const recordSize = 4096;
  const records: Uint8Array[] = [];
  for (let i = 0; i < textBytes.length; i += recordSize) {
    const chunk = textBytes.subarray(i, Math.min(i + recordSize, textBytes.length));
    records.push(compress ? palmDocFlatten(chunk) : chunk);
  }
  while (records.length === 0) { records.push(new Uint8Array(0)); }
  const textRecordCount = records.length;

  const enc = new TextEncoder();
  const nameBytes = enc.encode(title.slice(0, 32));
  const rec0 = new Uint8Array(16 + 264);
  const dv = new DataView(rec0.buffer);
  dv.setUint16(0, compress ? 2 : 1);            // compression
  dv.setUint32(4, textBytes.length);            // uncompressed text length
  dv.setUint16(8, textRecordCount);             // record count
  dv.setUint16(10, recordSize);                 // record size
  dv.setUint16(12, 0);                          // encryption: none
  rec0.set(enc.encode('MOBI'), 16);
  dv.setUint32(16 + 4, 264);                    // mobi header length
  dv.setUint32(16 + 8, 2);                      // mobi type: book
  dv.setUint32(16 + 12, 65001);                 // text encoding: utf-8
  const fullName = enc.encode(title);
  const nameOff = 16 + 264;
  dv.setUint32(16 + 84, nameOff);
  dv.setUint32(16 + 88, fullName.length);
  const rec0Full = new Uint8Array(nameOff + fullName.length);
  rec0Full.set(rec0.subarray(0, nameOff), 0);
  rec0Full.set(fullName, nameOff);

  const all: Uint8Array[] = [rec0Full, ...records];
  const numRecords = all.length;
  const headerLen = 78 + numRecords * 8 + 2;
  let total = headerLen;
  for (const r of all) { total += r.length; }
  const out = new Uint8Array(total);
  out.set(nameBytes, 0);
  out.set(enc.encode('BOOK'), 60);
  out.set(enc.encode('MOBI'), 64);
  out[76] = (numRecords >> 8) & 0xff;
  out[77] = numRecords & 0xff;
  let off = headerLen;
  for (let i = 0; i < numRecords; i++) {
    const p = 78 + i * 8;
    out[p] = (off >> 24) & 0xff; out[p + 1] = (off >> 16) & 0xff;
    out[p + 2] = (off >> 8) & 0xff; out[p + 3] = off & 0xff;
    out[p + 4] = i & 0xff; // unique id（低 3 字节简化）
    out.set(all[i], off);
    off += all[i].length;
  }
  return out;
}

test('parseMobi：无压缩夹具 → 书名/章节/文本', () => {
  const mobi = buildMobi('测试书', [
    '<html><body><h1>第一章</h1><p>苹果与橙子</p></body></html>',
    '<html><body><h1>第二章</h1><p>香蕉 &amp; 梨</p></body></html>'
  ], false);
  const book = parseMobi(mobi);
  assert.equal(book.title, '测试书');
  assert.equal(book.chapters.length, 2);
  assert.ok(book.chapters[0].text.includes('苹果与橙子'));
  assert.ok(book.chapters[1].text.includes('香蕉 & 梨'));
});

test('parseMobi：PalmDOC 压缩夹具等价于无压缩', () => {
  const html = ['<p>' + 'A'.repeat(9000) + '</p>']; // 跨多条 4096 记录
  const plain = parseMobi(buildMobi('压缩书', html, false));
  const packed = parseMobi(buildMobi('压缩书', html, true));
  assert.equal(packed.chapters[0].text.replace(/\n/g, '').length,
    plain.chapters[0].text.replace(/\n/g, '').length);
  assert.ok(packed.chapters[0].text.includes('A'.repeat(100)));
});

test('parseMobi：非 MOBI 输入报可读错误', () => {
  assert.throws(() => parseMobi(new Uint8Array(200)), /BOOKMOBI|MOBI/);
});

test('mobiToPdf：夹具 → %PDF-', () => {
  const mobi = buildMobi('转书', ['<h1>唯章</h1><p>内容甲</p>'], true);
  const pdf = mobiToPdf(mobi);
  assert.equal(Buffer.from(pdf.slice(0, 5)).toString(), '%PDF-');
});

test('DocKind：BOOKMOBI 魔数与扩展名兜底', () => {
  const mobi = buildMobi('k', ['x'], false);
  assert.equal(detectDocKind(mobi, 'a.bin'), 'mobi', '魔数优先');
  assert.equal(detectDocKind(new Uint8Array(100), 'b.mobi'), 'mobi');
});

// ── PDF 合并 ────────────────────────────────────────

function samplePdf(text: string): Uint8Array {
  const w = new PdfWriter({ pageSize: 'A4' });
  w.addParagraph(text, 'h1');
  return w.build();
}

test('mergePdfs：两份自产 PDF → 页数与文本都保留', () => {
  const a = samplePdf('ALPHA-甲');
  const b = samplePdf('BETA-乙');
  const merged = mergePdfs([a, b]);
  assert.equal(Buffer.from(merged.slice(0, 5)).toString(), '%PDF-');
  const text = extractPdfText(merged, (d: Uint8Array): Uint8Array => new Uint8Array(zlib.inflateSync(d)));
  const all = text.pages.map((p: { lines: Array<{ text: string }> }): string =>
    p.lines.map((l: { text: string }): string => l.text).join('')).join('|');
  assert.ok(all.includes('ALPHA-甲'));
  assert.ok(all.includes('BETA-乙'));
  // 页数 = 两份之和（每份单页）
  assert.equal(text.pages.length, 2);
});

test('mergePdfs：三份真实样本（baseline+dummy+docx 产物）', () => {
  const files = ['sample-baseline.pdf', 'dummy.pdf'];
  const inputs: Uint8Array[] = files.map((f: string): Uint8Array =>
    new Uint8Array(fs.readFileSync(path.join(MEDIA, f))));
  const docx = new Uint8Array(fs.readFileSync(path.join(MEDIA, 'sample-report.docx')));
  inputs.push(docxToPdf(MemoryZipSource.from(docx, (d: Uint8Array): Uint8Array =>
    new Uint8Array(zlib.inflateRawSync(d)))));
  const merged = mergePdfs(inputs);
  assert.ok(merged.length > 5000);
});

test('mergePdfs：单份/损坏输入的可读错误', () => {
  assert.throws(() => mergePdfs([samplePdf('x')]), /至少/);
  assert.throws(() => mergePdfs([new TextEncoder().encode('not a pdf'), samplePdf('y')]), /对象|PDF/);
});
