/**
 * 转换回归看护（docs/TEST-GUARDS.md #1/#4/#6/#7）
 * bug 历史：
 *  #1 转换报 "undefined"/"TypeError: …length…" —— 设备 API 抛无 message 的 BusinessError
 *     （zlib.unzipFile 拒绝 file:// URI 时 code:-1 无 message），UI 直渲染原始错误对象。
 *  #4 转换格式矩阵散落两处（service 分支 / RegistryCore.BUILTIN_CONVERTERS）易漂移。
 *  #6 v1 仅识别 pdf/docx/xlsx，epub/txt 落 unsupported。
 *  #7 autoTest 钩子直连验证过 docx→pdf 后，新格式（epub/txt）无路由级守护。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { errText } from '../src/main/ets/core/ErrorText.ts';
import { routeConversion } from '../src/main/ets/core/ConvertRoute.ts';
import { detectDocKind } from '../src/main/ets/core/DocKind.ts';
import { BUILTIN_CONVERTERS } from '../src/main/ets/core/extpack/RegistryCore.ts';

// ── #1 errText：任何错误形态都产出非空可读文本 ──

test('errText：undefined/null → 未知错误（不出现 "undefined" 字样）', () => {
  assert.equal(errText(undefined), '未知错误');
  assert.equal(errText(null), '未知错误');
  assert.ok(!errText(undefined).includes('undefined'));
});

test('errText：有 message 用 message', () => {
  assert.equal(errText(new Error('boom')), 'boom');
  assert.equal(errText({ message: '打开失败' }), '打开失败');
});

test('errText：无 message 只有 code → 错误码 N（zlib -1 场景回归）', () => {
  assert.equal(errText({ code: -1 }), '错误码 -1');
  assert.equal(errText({ code: '160001' }), '错误码 160001');
});

test('errText：空对象/原始值兜底为非空字符串', () => {
  const out = errText({});
  assert.ok(out.length > 0);
  assert.equal(errText('直接字符串'), '直接字符串');
  assert.ok(errText(42).length > 0);
});

// ── #4/#7 路由矩阵：单一权威 + 与 BUILTIN_CONVERTERS 一致 ──

test('路由矩阵：八条支持管线逐一命中', () => {
  const pairs: Array<[string, string, string]> = [
    ['docx', 'pdf', 'docxToPdf'],
    ['docx', 'txt', 'docxToTxt'],
    ['pdf', 'docx', 'pdfToDocx'],
    ['pdf', 'xlsx', 'pdfToXlsx'],
    ['pdf', 'epub', 'pdfToEpub'],
    ['xlsx', 'pdf', 'xlsxToPdf'],
    ['epub', 'pdf', 'epubToPdf'],
    ['txt', 'pdf', 'txtToPdf'],
  ];
  for (const [kind, target, route] of pairs) {
    assert.equal(routeConversion(kind as never, target), route, `${kind}->${target}`);
  }
});

test('路由矩阵：不支持组合必须返回 null（如 docx→xlsx、pdf→txt）', () => {
  for (const [kind, target] of [['docx', 'xlsx'], ['pdf', 'txt'], ['docx', 'docx'],
    ['xlsx', 'docx'], ['epub', 'epub'], ['txt', 'docx'], ['unsupported', 'pdf']]) {
    assert.equal(routeConversion(kind as never, target), null, `${kind}->${target}`);
  }
});

test('一致性：BUILTIN_CONVERTERS 与路由支持集完全相等（防双表漂移）', () => {
  // 路由 id 为 camelCase，BUILTIN 为 kebab-case（对外协议命名）——规范化后必须一一对应
  const routes = ['docxToPdf', 'docxToTxt', 'pdfToDocx', 'pdfToXlsx',
    'pdfToEpub', 'xlsxToPdf', 'epubToPdf', 'txtToPdf']
    .map((r) => r.replace(/([A-Z])/g, '-$1').toLowerCase());
  assert.deepEqual([...BUILTIN_CONVERTERS].sort(), [...routes].sort());
});

// ── #6 DocKind：魔数 + 扩展名全类型 ──

test('DocKind：ZIP 容器按内容特征判别', () => {
  const pk = (inner: string): Uint8Array => {
    const head = new Uint8Array([0x50, 0x4b, 0x03, 0x04]);
    const body = new TextEncoder().encode(inner);
    const out = new Uint8Array(head.length + body.length);
    out.set(head, 0);
    out.set(body, head.length);
    return out;
  };
  assert.equal(detectDocKind(pk('word/document.xml'), 'x.docx'), 'docx');
  assert.equal(detectDocKind(pk('xl/workbook.xml'), 'x.xlsx'), 'xlsx');
  assert.equal(detectDocKind(pk('mimetypeapplication/epub+zip'), 'x.epub'), 'epub');
});

test('DocKind：PDF 魔数优先于扩展名', () => {
  assert.equal(detectDocKind(new Uint8Array([0x25, 0x50, 0x44, 0x46]), 'a.docx'), 'pdf');
});

test('DocKind：扩展名兜底（txt/md/epub）与 unknown', () => {
  assert.equal(detectDocKind(new Uint8Array(0), 'a.txt'), 'txt');
  assert.equal(detectDocKind(new Uint8Array(0), 'a.md'), 'txt');
  assert.equal(detectDocKind(new Uint8Array(0), 'a.epub'), 'epub');
  assert.equal(detectDocKind(new Uint8Array(0), 'a.xyz'), 'unsupported');
});
