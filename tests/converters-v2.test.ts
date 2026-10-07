/**
 * v2 扩展管线测试：epubToPdf / txtToPdf / pdfToEpub / xlsxToPdf / docxToTxt
 * 真实语料：test-media/docs/{moby-dick.epub, moby-dick.txt, sample-baseline.pdf}
 * 合成语料：XlsxWriter 产物 round-trip、EpubWriter→EpubParser round-trip
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

import {
  epubToPdf, txtToPdf, pdfToEpub, xlsxToPdf, docxToTxt,
  docxToPdf
} from '../src/main/ets/core/Converters.ts';
import { MemoryZipSource, MappedZipSource, ZipWriter } from '../src/main/ets/core/zip/ZipCodec.ts';
import { parseEpub } from '../src/main/ets/core/epub/EpubParser.ts';
import { writeEpub } from '../src/main/ets/core/epub/EpubWriter.ts';
import { parseXlsx } from '../src/main/ets/core/ooxml/XlsxParser.ts';
import { XlsxWriter } from '../src/main/ets/core/ooxml/XlsxWriter.ts';
import { htmlToText, htmlTitle, decodeEntities } from '../src/main/ets/core/html/HtmlText.ts';
import { utf8Encode } from '../src/main/ets/core/zip/Utf8.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MEDIA = path.resolve(HERE, '../../../test-media/docs');
const inflate = (data: Uint8Array): Uint8Array => new Uint8Array(zlib.inflateSync(data));
const inflateRaw = (data: Uint8Array): Uint8Array => new Uint8Array(zlib.inflateRawSync(data));

function readBytes(p: string): Uint8Array {
  return new Uint8Array(fs.readFileSync(p));
}

// ── HtmlText ─────────────────────────────────────────

test('decodeEntities：命名/十进制/十六进制', () => {
  assert.equal(decodeEntities('a&amp;b'), 'a&b');
  assert.equal(decodeEntities('&#65;&#x42;'), 'AB');
  assert.equal(decodeEntities('&mdash;&hellip;'), '—…');
  assert.equal(decodeEntities('&unknown;'), '&unknown;');
});

test('htmlToText：块级断行 + 实体 + 空白收敛', () => {
  const html = '<html><head><title>T</title></head><body><h1>Chap</h1><p>a &amp; b</p><p>c<br/>d</p><span>x</span></body></html>';
  assert.equal(htmlTitle(html), 'T');
  assert.equal(htmlToText(html), 'Chap\n\na & b\n\nc\nd\n\nx');
});

// ── EpubWriter → EpubParser round-trip ───────────────

test('EPUB round-trip：写出 → 解析回读', () => {
  const book = {
    title: '测试书',
    chapters: [
      { title: '第一章', text: '甲段落\n\n乙段落' },
      { title: '第二章', text: '丙段落' }
    ]
  };
  const bytes = writeEpub(book);
  assert.ok(bytes.length > 0);
  // mimetype 首条且为明文
  const head = Buffer.from(bytes.slice(0, 80)).toString('latin1');
  assert.ok(head.includes('mimetype') && head.includes('application/epub+zip'));

  const source = MemoryZipSource.from(bytes, inflateRaw);
  const back = parseEpub(source);
  assert.equal(back.title, '测试书');
  assert.equal(back.chapters.length, 2);
  assert.equal(back.chapters[0].title, '第一章');
  assert.ok(back.chapters[0].text.includes('甲段落'));
  assert.ok(back.chapters[0].text.includes('乙段落'));
});

// ── epubToPdf（真实语料 moby-dick.epub）───────────────

test('epubToPdf：moby-dick.epub → PDF', () => {
  const source = MemoryZipSource.from(readBytes(path.join(MEDIA, 'moby-dick.epub')), inflateRaw);
  const book = parseEpub(source);
  assert.ok(book.chapters.length >= 20, `章节数 ${book.chapters.length}`);
  assert.ok(book.chapters.some((c) => c.text.includes('whale') || c.text.includes('Whale')));

  const pdf = epubToPdf(source);
  assert.ok(pdf.length > 10000);
  assert.equal(Buffer.from(pdf.slice(0, 5)).toString(), '%PDF-');
});

// ── txtToPdf（真实语料 moby-dick.txt）────────────────

test('txtToPdf：moby-dick.txt → PDF', () => {
  const pdf = txtToPdf(readBytes(path.join(MEDIA, 'moby-dick.txt')));
  assert.ok(pdf.length > 10000);
  assert.equal(Buffer.from(pdf.slice(0, 5)).toString(), '%PDF-');
});

test('txtToPdf：空文本报可读错误', () => {
  assert.throws(() => txtToPdf(utf8Encode('   \n \n')), /为空/);
});

// ── pdfToEpub（sample-baseline.pdf → EPUB → 回读）────

test('pdfToEpub：sample-baseline.pdf → EPUB 回读有内容', () => {
  const epub = pdfToEpub(readBytes(path.join(MEDIA, 'sample-baseline.pdf')), inflate);
  assert.ok(epub.length > 1000);
  const back = parseEpub(MemoryZipSource.from(epub, inflateRaw));
  assert.ok(back.chapters.length >= 1);
  const total = back.chapters.map((c) => c.text).join('');
  assert.ok(total.trim().length > 0);
});

// ── XlsxParser + xlsxToPdf ───────────────────────────

test('parseXlsx：XlsxWriter 产物 round-trip（inlineStr）', () => {
  const wb = {
    sheets: [
      { name: 'S1', rows: [['品名', '数量', '单价'], ['苹果', 3, 4.5], [null, '', '合计']] }
    ]
  };
  const bytes = new XlsxWriter(wb).build();
  const back = parseXlsx(MemoryZipSource.from(bytes, inflateRaw));
  assert.equal(back.sheets.length, 1);
  assert.equal(back.sheets[0].name, 'S1');
  assert.deepEqual(back.sheets[0].rows[0], ['品名', '数量', '单价']);
  assert.equal(back.sheets[0].rows[1][1], 3);
  assert.equal(back.sheets[0].rows[1][2], 4.5);
});

test('parseXlsx：sharedStrings + 稀疏 r 引用（手工夹具）', () => {
  const entries: { name: string; data: Uint8Array }[] = [];
  const zip = new ZipWriter();
  zip.addText('xl/workbook.xml',
    '<workbook><sheets><sheet name="数据" sheetId="1" r:id="rId1"/></sheets></workbook>');
  zip.addText('xl/_rels/workbook.xml.rels',
    '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>');
  zip.addText('xl/sharedStrings.xml',
    '<sst><si><t>姓名</t></si><si><t>张三</t></si></sst>');
  zip.addText('xl/worksheets/sheet1.xml',
    '<worksheet><sheetData>' +
    '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row>' +
    '<row r="3"><c r="C3"><v>42</v></c></row>' +
    '</sheetData></worksheet>');
  const back = parseXlsx(MemoryZipSource.from(zip.finish()));
  assert.deepEqual(back.sheets[0].rows[0], ['姓名', '张三']);
  assert.equal(back.sheets[0].rows[2][2], 42);
  assert.equal(back.sheets[0].rows[2][0], null);
});

test('xlsxToPdf：真实文件 sample-inventory.xlsx → PDF', () => {
  const pdf = xlsxToPdf(MemoryZipSource.from(readBytes(path.join(MEDIA, 'sample-inventory.xlsx')), inflateRaw));
  assert.ok(pdf.length > 1000);
  assert.equal(Buffer.from(pdf.slice(0, 5)).toString(), '%PDF-');
});

// ── docxToTxt ────────────────────────────────────────

test('docxToTxt：sample-report.docx → 文本', () => {
  const bytes = readBytes(path.join(MEDIA, 'sample-report.docx'));
  const txt = docxToTxt(MemoryZipSource.from(bytes, inflateRaw));
  const text = Buffer.from(txt).toString('utf8');
  assert.ok(text.trim().length > 50);
  // 与 docxToPdf 同源段落，正文一致出现
  const pdf = docxToPdf(MemoryZipSource.from(bytes, inflateRaw));
  assert.ok(pdf.length > 1000);
});
