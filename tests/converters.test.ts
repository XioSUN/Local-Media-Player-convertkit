import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inflateSync } from 'node:zlib';
import { MemoryZipSource } from '../src/main/ets/core/zip/ZipCodec.ts';
import { parseDocxXml, docToPlainText } from '../src/main/ets/core/ooxml/DocxParser.ts';
import { DocxWriter } from '../src/main/ets/core/ooxml/DocxWriter.ts';
import { XlsxWriter } from '../src/main/ets/core/ooxml/XlsxWriter.ts';
import { PdfWriter } from '../src/main/ets/core/pdf/PdfWriter.ts';
import { extractPdfText, linesToRows } from '../src/main/ets/core/pdf/PdfTextExtractor.ts';
import { docxToPdf, pdfToDocx, pdfToXlsx, CONVERTER_DOCX2PDF } from '../src/main/ets/core/Converters.ts';

const zlibInflate = (data: Uint8Array): Uint8Array => new Uint8Array(inflateSync(Buffer.from(data)));

test('转换器常量导出', () => {
  assert.equal(CONVERTER_DOCX2PDF, 'docx-to-pdf');
});

test('docxToPdf：DOCX 字节 → PDF 字节 → 抽取文本一致', () => {
  const docx = new DocxWriter({
    paragraphs: [
      { style: 'h1', runs: [{ text: '季度报告' }] },
      { style: 'normal', runs: [{ text: '营收增长 20%，成本下降。' }] },
      { style: 'li', runs: [{ text: '重点项目：鸿蒙适配' }] }
    ]
  }).build();

  const pdfBytes = docxToPdf(MemoryZipSource.from(docx));
  assert.equal(new TextDecoder().decode(pdfBytes.slice(0, 8)), '%PDF-1.4');

  const text = extractPdfText(pdfBytes, zlibInflate);
  const all = text.pages[0].lines.map((l) => l.text).join('\n');
  assert.ok(all.includes('季度报告'));
  assert.ok(all.includes('营收增长 20%，成本下降。'));
  assert.ok(all.includes('重点项目：鸿蒙适配'));
});

test('pdfToDocx：PDF → DOCX round-trip', () => {
  const pdf = new PdfWriter();
  pdf.addParagraph('第一章 总则', 'h1');
  pdf.addParagraph('本协议适用于全部本地多媒体播放场景。');
  pdf.addParagraph('第二章 权利');
  const pdfBytes = pdf.build();

  const docxBytes = pdfToDocx(pdfBytes, zlibInflate);
  const src = MemoryZipSource.from(docxBytes);
  const doc = parseDocxXml(src.readText('word/document.xml')!);
  const plain = docToPlainText(doc);
  assert.ok(plain.includes('第一章 总则'));
  assert.ok(plain.includes('本协议适用于全部本地多媒体播放场景。'));
  // 大字号行被识别为标题
  const heading = doc.paragraphs.find((p) => p.runs[0]?.text.includes('第一章'));
  assert.equal(heading?.style, 'h1');
});

test('pdfToXlsx：表格聚类与数字转型', () => {
  // 构造带制表符分隔列的 PDF（PDF 表格文本的常见形态）
  const pdf = new PdfWriter();
  pdf.addParagraph('产品\t数量\t金额');
  pdf.addParagraph('苹果\t12\t99.5');
  pdf.addParagraph('香蕉\t300\t45');
  const pdfBytes = pdf.build();

  const xlsxBytes = pdfToXlsx(pdfBytes, zlibInflate);
  const src = MemoryZipSource.from(xlsxBytes);
  const sheet = src.readText('xl/worksheets/sheet1.xml')!;
  assert.ok(sheet.includes('产品'), '表头存在');
  // 数字单元格（无 inlineStr）出现
  assert.ok(/<v>12<\/v>|<v>300<\/v>/.test(sheet), '数字自动转型');
});

test('非 DOCX 输入抛错', () => {
  const notDocx = MemoryZipSource.from(
    new XlsxWriter({ sheets: [{ name: 'S', rows: [['x']] }] }).build()
  );
  assert.throws(() => docxToPdf(notDocx), /document\.xml/);
});

test('转换链：docx → pdf → docx 内容保持', () => {
  const original = {
    paragraphs: [
      { style: 'h1' as const, runs: [{ text: '链路测试' }] },
      { style: 'normal' as const, runs: [{ text: '内容在两种格式之间往返。' }] }
    ]
  };
  const pdfBytes = docxToPdf(new DocxWriter(original).toSource());
  const docxBytes = pdfToDocx(pdfBytes, zlibInflate);
  const doc = parseDocxXml(MemoryZipSource.from(docxBytes).readText('word/document.xml')!);
  const plain = docToPlainText(doc);
  assert.ok(plain.includes('链路测试'));
  assert.ok(plain.includes('内容在两种格式之间往返。'));
});

test('linesToRows 列聚类直接可用', () => {
  const page = {
    width: 595, height: 842,
    lines: [
      { x: 56, y: 800, size: 11, text: 'A' },
      { x: 200, y: 800, size: 11, text: 'B' }
    ]
  };
  assert.deepEqual(linesToRows(page), [['A', 'B']]);
});
