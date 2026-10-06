import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inflateSync } from 'node:zlib';
import { PdfWriter } from '../src/main/ets/core/pdf/PdfWriter.ts';
import { extractPdfText, linesToRows } from '../src/main/ets/core/pdf/PdfTextExtractor.ts';

const zlibInflate = (data: Uint8Array): Uint8Array => new Uint8Array(inflateSync(Buffer.from(data)));

test('PDF 基本结构：头/xref/EOF', () => {
  const pdf = new PdfWriter();
  pdf.addParagraph('Hello PDF');
  const bytes = pdf.build();
  const head = new TextDecoder().decode(bytes.slice(0, 8));
  assert.equal(head, '%PDF-1.4');
  const tail = new TextDecoder().decode(bytes.slice(-8));
  assert.ok(tail.includes('%%EOF'));
  const content = new TextDecoder().decode(bytes);
  assert.ok(content.includes('/Type /Catalog'));
  assert.ok(content.includes('/BaseFont /Helvetica'));
  assert.ok(content.includes('startxref'));
});

test('ASCII round-trip：写出 → 抽取 → 文本一致', () => {
  const pdf = new PdfWriter();
  pdf.addParagraph('The quick brown fox');
  pdf.addParagraph('jumps over the lazy dog. 第二段含中文将切换 CJK 模式，所以这里保持 ASCII。'.replace(/[^\x00-\x7F]/g, ''));
  pdf.addParagraph('Third line', 'h1');
  const text = extractPdfText(pdf.build(), zlibInflate);
  assert.equal(text.pages.length, 1);
  const all = text.pages[0].lines.map((l) => l.text).join('\n');
  assert.ok(all.includes('The quick brown fox'));
  assert.ok(all.includes('jumps over the lazy dog.'));
  assert.ok(all.includes('Third line'));
  // 标题字号被抽取保留
  const h1 = text.pages[0].lines.find((l) => l.text.includes('Third line'));
  assert.equal(h1?.size, 20);
});

test('CJK round-trip：非 ASCII 触发 UniGB-UCS2-H + UTF-16BE hex', () => {
  const pdf = new PdfWriter();
  pdf.addParagraph('鸿蒙本地播放器');
  pdf.addParagraph('第二段：文档转换引擎测试');
  const bytes = pdf.build();
  const content = new TextDecoder().decode(bytes);
  assert.ok(content.includes('/STSong-Light'));
  assert.ok(content.includes('/UniGB-UCS2-H'));

  const text = extractPdfText(bytes, zlibInflate);
  const all = text.pages[0].lines.map((l) => l.text).join('\n');
  assert.ok(all.includes('鸿蒙本地播放器'), `实际输出: ${all}`);
  assert.ok(all.includes('第二段：文档转换引擎测试'));
});

test('自动分页：长文本产生多页', () => {
  const pdf = new PdfWriter();
  for (let i = 0; i < 120; i++) {
    pdf.addParagraph(`第 ${i} 行内容 some filler text to wrap around`);
  }
  const text = extractPdfText(pdf.build(), zlibInflate);
  assert.ok(text.pages.length >= 3, `页数=${text.pages.length}`);
  // 内容完整性（首尾都在）
  const first = text.pages[0].lines.some((l) => l.text.includes('第 0 行'));
  const last = text.pages[text.pages.length - 1].lines.some((l) => l.text.includes('第 119 行'));
  assert.ok(first && last);
});

test('linesToRows：y 聚类 + x 切列', () => {
  const page = {
    width: 595,
    height: 842,
    lines: [
      { x: 56, y: 800, size: 11, text: 'Name' },
      { x: 300, y: 800, size: 11, text: 'Age' },
      { x: 56, y: 784, size: 11, text: 'Alice' },
      { x: 300, y: 784, size: 11, text: '30' }
    ]
  };
  const rows = linesToRows(page);
  assert.deepEqual(rows, [['Name', 'Age'], ['Alice', '30']]);
});
