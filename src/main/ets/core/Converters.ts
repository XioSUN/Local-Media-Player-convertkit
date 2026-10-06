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
import { parseDocxXml, type DocParagraph, type ParagraphStyle } from './ooxml/DocxParser.ts';
import { DocxWriter } from './ooxml/DocxWriter.ts';
import { XlsxWriter, type CellValue } from './ooxml/XlsxWriter.ts';
import { PdfWriter } from './pdf/PdfWriter.ts';
import { extractPdfText, linesToRows, type PdfInflate } from './pdf/PdfTextExtractor.ts';

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
