/**
 * XlsxParser — XLSX（ZIP 容器）→ 工作簿模型（纯逻辑，XlsxWriter 的读端）。
 *
 * 支持：sharedStrings / inlineStr / 字符串/数值/布尔单元格、r 引用的稀疏网格
 * （缺位补 null）。列字母 → 索引与 XlsxWriter.colLetter 互逆。
 */

import { type ZipSource } from '../zip/ZipCodec.ts';
import { type Workbook, type Worksheet, type CellValue } from './XlsxWriter.ts';

function attr(tag: string, name: string): string {
  const m = new RegExp(`${name}\\s*=\\s*"([^"]*)"`).exec(tag);
  return m !== null ? m[1] : '';
}

/** B3 → col=1, row=2（0 起） */
function cellRefToXY(ref: string): { col: number; row: number } | null {
  const m = /^([A-Z]+)([0-9]+)$/.exec(ref);
  if (m === null) {
    return null;
  }
  let col = 0;
  for (let i = 0; i < m[1].length; i++) {
    col = col * 26 + (m[1].charCodeAt(i) - 64);
  }
  return { col: col - 1, row: parseInt(m[2], 10) - 1 };
}

function textContent(xml: string): string {
  return xml
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

/** sharedStrings：<si><t>..</t></si> 或富文本 <si><r><t>..</t></r>...</si>（拼接） */
function parseSharedStrings(xml: string): string[] {
  const out: string[] = [];
  for (const m of xml.matchAll(/<si>([\s\S]*?)<\/si>/g)) {
    const parts: string[] = [];
    for (const t of m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)) {
      parts.push(textContent(t[1]));
    }
    out.push(parts.join(''));
  }
  return out;
}

function parseSheet(xml: string, shared: string[], name: string): Worksheet {
  const rows: CellValue[][] = [];
  for (const rowMatch of xml.matchAll(/<row\s[^>]*>([\s\S]*?)<\/row>/g)) {
    for (const c of rowMatch[1].matchAll(/<c\s[^>]*\/>|<c\s[^>]*>[\s\S]*?<\/c>/g)) {
      const cell = c[0];
      const xy = cellRefToXY(attr(cell, 'r'));
      if (xy === null) {
        continue;
      }
      const type = attr(cell, 't');
      let value: CellValue = null;
      if (type === 'inlineStr') {
        const parts: string[] = [];
        for (const t of cell.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)) {
          parts.push(textContent(t[1]));
        }
        value = parts.join('');
      } else {
        const v = /<v>([\s\S]*?)<\/v>/.exec(cell);
        if (v !== null) {
          const raw = textContent(v[1]);
          if (type === 's') {
            const idx = parseInt(raw, 10);
            value = idx >= 0 && idx < shared.length ? shared[idx] : null;
          } else if (type === 'b') {
            value = raw === '1' ? 'TRUE' : 'FALSE';
          } else if (type === 'str') {
            value = raw;
          } else if (/^-?[0-9]+(\.[0-9]+)?([eE][-+]?[0-9]+)?$/.test(raw)) {
            const num = parseFloat(raw);
            value = Number.isFinite(num) ? num : raw;
          } else {
            value = raw;
          }
        }
      }
      while (rows.length <= xy.row) {
        rows.push([]);
      }
      const rowArr = rows[xy.row];
      while (rowArr.length <= xy.col) {
        rowArr.push(null);
      }
      rowArr[xy.col] = value;
    }
  }
  return { name, rows };
}

export function parseXlsx(source: ZipSource): Workbook {
  const workbookXml = source.readText('xl/workbook.xml');
  if (workbookXml === null) {
    throw new Error('parseXlsx: 缺少 xl/workbook.xml（不是有效的 XLSX）');
  }
  const relsXml = source.readText('xl/_rels/workbook.xml.rels') ?? '';
  const targetById = new Map<string, string>();
  for (const m of relsXml.matchAll(/<Relationship\s[^>]*>/g)) {
    const id = attr(m[0], 'Id');
    const target = attr(m[0], 'Target');
    if (id.length > 0 && target.length > 0) {
      targetById.set(id, target.startsWith('/') ? target.slice(1) : `xl/${target}`);
    }
  }

  const sharedXml = source.readText('xl/sharedStrings.xml');
  const shared = sharedXml !== null ? parseSharedStrings(sharedXml) : [];

  const sheets: Worksheet[] = [];
  for (const m of workbookXml.matchAll(/<sheet\s[^>]*>/g)) {
    const name = attr(m[0], 'name');
    const rid = attr(m[0], 'r:id');
    const target = targetById.get(rid);
    if (name.length === 0 || target === undefined) {
      continue;
    }
    const sheetXml = source.readText(target);
    if (sheetXml === null) {
      continue;
    }
    sheets.push(parseSheet(sheetXml, shared, name));
  }
  if (sheets.length === 0) {
    throw new Error('parseXlsx: 没有可读工作表');
  }
  return { sheets };
}
