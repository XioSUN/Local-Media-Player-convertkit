import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseDocxXml, docToPlainText, type DocDocument } from '../src/main/ets/core/ooxml/DocxParser.ts';
import { DocxWriter } from '../src/main/ets/core/ooxml/DocxWriter.ts';

const SAMPLE_DOC: DocDocument = {
  paragraphs: [
    { style: 'h1', runs: [{ text: '项目计划' }] },
    { style: 'normal', runs: [{ text: '本季度目标：', bold: true }, { text: '完成鸿蒙移植', italic: true }] },
    { style: 'li', runs: [{ text: '音频播放\t频谱可视化' }] },
    { style: 'normal', runs: [{ text: '含 & < > " 引用与中文' }] }
  ]
};

test('DocxWriter 产出完整包结构', () => {
  const src = new DocxWriter(SAMPLE_DOC).toSource();
  const names = src.names();
  for (const required of [
    '[Content_Types].xml',
    '_rels/.rels',
    'word/document.xml',
    'word/_rels/document.xml.rels',
    'word/styles.xml'
  ]) {
    assert.ok(names.includes(required), `缺少 ${required}`);
  }
  const doc = src.readText('word/document.xml')!;
  assert.ok(doc.includes('<w:document'), 'document.xml 根元素');
  assert.ok(doc.includes('w:styleId="Heading1"') === false, '样式引用而非定义');
  assert.ok(doc.includes('<w:pStyle w:val="Heading1"/>'));
  assert.ok(doc.includes('<w:b/>'));
  assert.ok(doc.includes('<w:i/>'));
  assert.ok(doc.includes('&amp; &lt; &gt; &quot;'), '实体转义');
});

test('DocxWriter → DocxParser round-trip 保留内容与样式', () => {
  const src = new DocxWriter(SAMPLE_DOC).toSource();
  const parsed = parseDocxXml(src.readText('word/document.xml')!);
  assert.equal(parsed.paragraphs.length, SAMPLE_DOC.paragraphs.length);
  assert.equal(parsed.paragraphs[0].style, 'h1');
  assert.equal(parsed.paragraphs[0].runs[0].text, '项目计划');
  // run 分段保留（加粗/斜体边界）
  assert.equal(parsed.paragraphs[1].runs.length, 2);
  assert.equal(parsed.paragraphs[1].runs[0].bold, true);
  assert.equal(parsed.paragraphs[1].runs[1].italic, true);
  // 制表符
  assert.equal(parsed.paragraphs[2].runs[0].text, '音频播放\t频谱可视化');
  assert.ok(docToPlainText(parsed).includes('含 & < > " 引用与中文'));
});

test('parseDocxXml：直接解析 XML 片段', () => {
  const xml = `<w:document xmlns:w="x"><w:body>
    <w:p><w:pPr><w:pStyle w:val="Heading2"/></w:pPr><w:r><w:t>标题二</w:t></w:r></w:p>
    <w:p><w:r><w:rPr><w:b/></w:rPr><w:t xml:space="preserve"> 前后空格 </w:t></w:r></w:p>
    <w:p><w:r><w:br/><w:t>换行后</w:t></w:r></w:p>
  </w:body></w:document>`;
  const doc = parseDocxXml(xml);
  assert.equal(doc.paragraphs.length, 3);
  assert.equal(doc.paragraphs[0].style, 'h2');
  assert.equal(doc.paragraphs[1].runs[0].text, ' 前后空格 ');
  assert.equal(doc.paragraphs[2].runs[0].text, '\n');
  assert.equal(doc.paragraphs[2].runs[1].text, '换行后');
});

test('数字实体与常见实体解码', () => {
  const doc = parseDocxXml('<w:p><w:r><w:t>A&#233;b&#x4E2D;&amp;ok</w:t></w:r></w:p>');
  assert.equal(doc.paragraphs[0].runs[0].text, 'Aéb中&ok');
});

test('空文档写出合法包', () => {
  const src = new DocxWriter({ paragraphs: [] }).toSource();
  const parsed = parseDocxXml(src.readText('word/document.xml')!);
  assert.equal(parsed.paragraphs.length, 0);
});
