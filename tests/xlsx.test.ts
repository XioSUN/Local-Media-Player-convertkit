import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MemoryZipSource } from '../src/main/ets/core/zip/ZipCodec.ts';
import { XlsxWriter, colLetter } from '../src/main/ets/core/ooxml/XlsxWriter.ts';

test('colLetter：列号 → 字母', () => {
  assert.equal(colLetter(0), 'A');
  assert.equal(colLetter(25), 'Z');
  assert.equal(colLetter(26), 'AA');
  assert.equal(colLetter(701), 'ZZ');
  assert.equal(colLetter(702), 'AAA');
});

test('XlsxWriter 产出完整包结构（inlineStr + 数字单元格）', () => {
  const bytes = new XlsxWriter({
    sheets: [
      {
        name: 'Sheet1',
        rows: [
          ['名称', '数量', '备注'],
          ['苹果', 12, null],
          ['香蕉', 3.5, '含空格 文本']
        ]
      }
    ]
  }).build();

  const src = MemoryZipSource.from(bytes);
  const names = src.names();
  for (const required of [
    '[Content_Types].xml',
    'xl/workbook.xml',
    'xl/_rels/workbook.xml.rels',
    'xl/styles.xml',
    'xl/worksheets/sheet1.xml'
  ]) {
    assert.ok(names.includes(required), `缺少 ${required}`);
  }
  const sheet = src.readText('xl/worksheets/sheet1.xml')!;
  assert.ok(sheet.includes('t="inlineStr"'));
  assert.ok(sheet.includes('<v>12</v>'), '数字单元格');
  assert.ok(sheet.includes('<v>3.5</v>'));
  assert.ok(sheet.includes('A1'), '单元格引用');
  assert.ok(!sheet.includes('r="C2"'), 'null 单元格不输出');
  const workbook = src.readText('xl/workbook.xml')!;
  assert.ok(workbook.includes('r:id="rId1"'));
});

test('多工作表', () => {
  const bytes = new XlsxWriter({
    sheets: [
      { name: 'S1', rows: [['a']] },
      { name: 'S2', rows: [['b'], ['c']] },
      { name: 'S3', rows: [] }
    ]
  }).build();
  const src = MemoryZipSource.from(bytes);
  assert.ok(src.names().includes('xl/worksheets/sheet2.xml'));
  assert.ok(src.readText('xl/worksheets/sheet3.xml')!.includes('<sheetData></sheetData>'));
  assert.ok(src.readText('[Content_Types].xml')!.includes('sheet3.xml'));
});

test('空工作簿抛错', () => {
  assert.throws(() => new XlsxWriter({ sheets: [] }), /至少需要/);
});

test('XML 特殊字符转义', () => {
  const bytes = new XlsxWriter({ sheets: [{ name: 'S', rows: [['<b>&"x"</b>']] }] }).build();
  const sheet = MemoryZipSource.from(bytes).readText('xl/worksheets/sheet1.xml')!;
  assert.ok(sheet.includes('&lt;b&gt;&amp;&quot;x&quot;&lt;/b&gt;'));
});
