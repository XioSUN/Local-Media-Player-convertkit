/**
 * Converters — 三条转换流水线（纯逻辑）
 *
 *  - docxToPdf :  ZIP(word/document.xml) → DocxParser → PdfWriter
 *  - pdfToDocx :  PdfTextExtractor → 行高聚类/标题推断 → DocxWriter
 *  - pdfToXlsx :  PdfTextExtractor → y 聚类 + x 切列 → XlsxWriter
 *
 * 平台边界：输入为 ZipSource / 字节流；PDF FlateDecode 需注入 zlib inflate。
 */

import { type ZipSource } from './zip/ZipCodec.ts';
import { utf8Decode, utf8Encode } from './zip/Utf8.ts';
import { parseDocxXml, type DocParagraph, type ParagraphStyle } from './ooxml/DocxParser.ts';
import { DocxWriter } from './ooxml/DocxWriter.ts';
import { XlsxWriter, type CellValue } from './ooxml/XlsxWriter.ts';
import { parseXlsx } from './ooxml/XlsxParser.ts';
import { PdfWriter } from './pdf/PdfWriter.ts';
import { extractPdfText, linesToRows, type PdfInflate } from './pdf/PdfTextExtractor.ts';
import { parseEpub, type EpubChapter } from './epub/EpubParser.ts';
import { parseMobi } from './pdf/MobiParser.ts';
import { writeEpub } from './epub/EpubWriter.ts';

export const CONVERTER_DOCX2PDF = 'docx-to-pdf';
export const CONVERTER_PDF2DOCX = 'pdf-to-docx';
export const CONVERTER_PDF2XLSX = 'pdf-to-xlsx';

/** Word → PDF */
export function docxToPdf(source: ZipSource): Uint8Array {
  const xml = source.readText('word/document.xml');
  if (!xml) {
    throw new Error('docxToPdf: 缺少 word/document.xml（不是有效的 DOCX）');
  }
  const doc = parseDocxXml(xml);
  const pdf = new PdfWriter({ pageSize: 'A4' });
  for (const para of doc.paragraphs) {
    const text = para.runs.map((r) => r.text).join('');
    pdf.addParagraph(text, para.style);
  }
  return pdf.build();
}

const STYLE_ORDER: ParagraphStyle[] = ['normal', 'li', 'h3', 'h2', 'h1'];

/** 从行尺寸分布推断正文字号（取出现最多的字号，平局取更小值） */
function inferStyles(sizes: number[]): { body: number } {
  if (sizes.length === 0) {
    return { body: 11 };
  }
  const freq = new Map<number, number>();
  for (const s of sizes) {
    freq.set(s, (freq.get(s) ?? 0) + 1);
  }
  let body = sizes[0];
  let bestCount = -1;
  for (const [size, count] of freq) {
    if (count > bestCount || (count === bestCount && size < body)) {
      body = size;
      bestCount = count;
    }
  }
  return { body };
}

function styleFor(size: number, body: number): ParagraphStyle {
  if (size >= body * 1.55) {
    return 'h1';
  }
  if (size >= body * 1.3) {
    return 'h2';
  }
  if (size >= body * 1.12) {
    return 'h3';
  }
  return 'normal';
}

/** PDF → Word（标题按字号推断，行聚合成段落） */
export function pdfToDocx(bytes: Uint8Array, inflate: PdfInflate): Uint8Array {
  const text = extractPdfText(bytes, inflate);
  const paragraphs: DocParagraph[] = [];
  const body = inferStyles(text.pages.flatMap((p) => p.lines.map((l) => l.size))).body;

  for (const page of text.pages) {
    let buffer = '';
    let lastY: number | null = null;
    let lastSize = body;
    const flushPara = () => {
      const t = buffer.trim();
      if (t.length > 0) {
        paragraphs.push({ style: styleFor(lastSize, body), runs: [{ text: t }] });
      }
      buffer = '';
    };
    for (const line of page.lines) {
      // 新段落判定：大 y 跳变（> 1.6 倍行高）或字号变化
      const yGap = lastY === null ? 0 : lastY - line.y;
      if (lastY !== null && (yGap > line.size * 1.7 || Math.abs(line.size - lastSize) > 0.5)) {
        flushPara();
      }
      buffer += (buffer.length > 0 ? ' ' : '') + line.text;
      lastY = line.y;
      lastSize = line.size;
    }
    flushPara();
    paragraphs.push({ style: 'normal', runs: [{ text: '' }] }); // 页分隔空行
  }
  // 去掉末尾多余空行
  while (paragraphs.length > 0 && paragraphs[paragraphs.length - 1].runs[0]?.text === '') {
    paragraphs.pop();
  }
  return new DocxWriter({ paragraphs }).build();
}

function looksLikeNumber(s: string): number | null {
  const t = s.replace(/[,\s]/g, '');
  if (t.length === 0 || !/^[-+]?\d+(\.\d+)?$/.test(t)) {
    return null;
  }
  const v = parseFloat(t);
  return Number.isFinite(v) ? v : null;
}

/** 展开单元格：单行内以制表符/多空格分隔的多列拆开（PDF 文本行常见形态） */
function expandCells(cells: CellValue[]): CellValue[] {
  const out: CellValue[] = [];
  for (const cell of cells) {
    if (typeof cell === 'string' && /[\t]| {2,}/.test(cell)) {
      for (const part of cell.split(/[\t]+| {2,}/)) {
        const trimmed = part.trim();
        if (trimmed.length > 0) {
          const n = looksLikeNumber(trimmed);
          out.push(n !== null ? n : trimmed);
        }
      }
    } else if (typeof cell === 'string') {
      const n = looksLikeNumber(cell);
      out.push(n !== null ? n : cell);
    } else {
      out.push(cell);
    }
  }
  return out;
}

/** PDF → Excel（每页行聚类 + 列切分；数字单元格自动转型） */
export function pdfToXlsx(bytes: Uint8Array, inflate: PdfInflate): Uint8Array {
  const text = extractPdfText(bytes, inflate);
  const rows: CellValue[][] = [];

  for (let p = 0; p < text.pages.length; p++) {
    const pageRows = linesToRows(text.pages[p]);
    for (const row of pageRows) {
      if (row.every((c) => c.length === 0)) {
        continue;
      }
      const cells = expandCells(row);
      if (cells.length > 0) {
        rows.push(cells);
      }
    }
    if (p < text.pages.length - 1 && rows.length > 0) {
      rows.push(['—— 第 ' + (p + 1) + ' 页结束 ——']);
    }
  }

  return new XlsxWriter({ sheets: [{ name: 'Sheet1', rows }] }).build();
}

// ─────────────────────────────────────────────────────
// v2 扩展管线（参考 convertio / smallpdf 的文档转换面）
// ─────────────────────────────────────────────────────

export const CONVERTER_EPUB2PDF = 'epub-to-pdf';
export const CONVERTER_TXT2PDF = 'txt-to-pdf';
export const CONVERTER_PDF2EPUB = 'pdf-to-epub';
export const CONVERTER_XLSX2PDF = 'xlsx-to-pdf';
export const CONVERTER_DOCX2TXT = 'docx-to-txt';

/** TXT → PDF（UTF-8 文本，空行分段） */
export function txtToPdf(bytes: Uint8Array): Uint8Array {
  const text = utf8Decode(bytes);
  if (text.trim().length === 0) {
    throw new Error('txtToPdf: 文本内容为空');
  }
  const pdf = new PdfWriter({ pageSize: 'A4' });
  let pendingBlank = false;
  let first = true;
  for (const raw of text.split('\n')) {
    const line = raw.replace(/\r$/, '').trim();
    if (line.length === 0) {
      if (!first) {
        pendingBlank = true;
      }
      continue;
    }
    if (pendingBlank) {
      pdf.addParagraph('', 'normal'); // 段间空行
      pendingBlank = false;
    }
    pdf.addParagraph(line, 'normal');
    first = false;
  }
  return pdf.build();
}

/** EPUB → PDF（章节标题 h1 + 正文段落） */
export function epubToPdf(source: ZipSource): Uint8Array {
  const book = parseEpub(source);
  const pdf = new PdfWriter({ pageSize: 'A4' });
  for (let i = 0; i < book.chapters.length; i++) {
    const ch = book.chapters[i];
    if (ch.title.length > 0) {
      pdf.addParagraph(ch.title, 'h1');
    }
    for (const line of ch.text.split('\n')) {
      const t = line.trim();
      if (t.length > 0) {
        pdf.addParagraph(t, 'normal');
      }
    }
  }
  return pdf.build();
}

/** PDF → EPUB（复用 pdfToDocx 的字号推断与段落聚合，h1/h2 切章） */
export function pdfToEpub(bytes: Uint8Array, inflate: PdfInflate): Uint8Array {
  const text = extractPdfText(bytes, inflate);
  const paragraphs: DocParagraph[] = [];
  const body = inferStyles(text.pages.flatMap((p) => p.lines.map((l) => l.size))).body;
  for (const page of text.pages) {
    let buffer = '';
    let lastY: number | null = null;
    let lastSize = body;
    const flushPara = () => {
      const t = buffer.trim();
      if (t.length > 0) {
        paragraphs.push({ style: styleFor(lastSize, body), runs: [{ text: t }] });
      }
      buffer = '';
    };
    for (const line of page.lines) {
      const yGap = lastY === null ? 0 : lastY - line.y;
      if (lastY !== null && (yGap > line.size * 1.7 || Math.abs(line.size - lastSize) > 0.5)) {
        flushPara();
      }
      buffer += (buffer.length > 0 ? ' ' : '') + line.text;
      lastY = line.y;
      lastSize = line.size;
    }
    flushPara();
  }

  // h1/h2 起章，其余聚合；无标题则约每 60 段一章
  const chapters: EpubChapter[] = [];
  let current: EpubChapter | null = null;
  let count = 0;
  for (const para of paragraphs) {
    const heading = para.style === 'h1' || para.style === 'h2' ? para.runs.map((r) => r.text).join('').trim() : '';
    if (current === null || (heading.length > 0 && heading.length <= 80) || count >= 60) {
      current = { title: heading.length > 0 ? heading : `第 ${chapters.length + 1} 部分`, text: '' };
      chapters.push(current);
      count = 0;
      if (heading.length > 0) {
        continue;
      }
    }
    const t = para.runs.map((r) => r.text).join('');
    if (t.length > 0) {
      current.text += (current.text.length > 0 ? '\n\n' : '') + t;
    }
    count += 1;
  }
  if (chapters.length === 0) {
    throw new Error('pdfToEpub: PDF 无可提取文本（可能是扫描件）');
  }
  const title = `Converted ${new Date().toISOString().slice(0, 10)}`;
  return writeEpub({ title, chapters });
}

/** XLSX → PDF（每表一节：表名 h2 + 行单元格「|」连接） */
export function xlsxToPdf(source: ZipSource): Uint8Array {
  const workbook = parseXlsx(source);
  const pdf = new PdfWriter({ pageSize: 'A4' });
  for (let i = 0; i < workbook.sheets.length; i++) {
    const sheet = workbook.sheets[i];
    pdf.addParagraph(sheet.name.length > 0 ? sheet.name : `Sheet${i + 1}`, 'h2');
    for (const row of sheet.rows) {
      const cells = row.map((c: CellValue): string => (c === null ? '' : String(c)));
      if (cells.some((c: string) => c.length > 0)) {
        pdf.addParagraph(cells.join(' | '), 'normal');
      }
    }
  }
  return pdf.build();
}

/** DOCX → TXT（段落文本，空行分隔） */
export function docxToTxt(source: ZipSource): Uint8Array {
  const xml = source.readText('word/document.xml');
  if (xml === null) {
    throw new Error('docxToTxt: 缺少 word/document.xml（不是有效的 DOCX）');
  }
  const doc = parseDocxXml(xml);
  const parts: string[] = [];
  for (const para of doc.paragraphs) {
    parts.push(para.runs.map((r) => r.text).join(''));
  }
  return utf8Encode(parts.join('\n'));
}

// ─────────────────────────────────────────────────────
// v3 扩展管线（MOBI → PDF；PDF 合并）
// ─────────────────────────────────────────────────────

export const CONVERTER_MOBI2PDF = 'mobi-to-pdf';
export const CONVERTER_PDFMERGE = 'pdf-merge';

/** MOBI → PDF（章节标题 h1 + 正文段落） */
export function mobiToPdf(bytes: Uint8Array): Uint8Array {
  const book = parseMobi(bytes);
  const pdf = new PdfWriter({ pageSize: 'A4' });
  for (const ch of book.chapters) {
    if (ch.title.length > 0) {
      pdf.addParagraph(ch.title, 'h1');
    }
    for (const line of ch.text.split('\n')) {
      const t = line.trim();
      if (t.length > 0) {
        pdf.addParagraph(t, 'normal');
      }
    }
  }
  return pdf.build();
}
