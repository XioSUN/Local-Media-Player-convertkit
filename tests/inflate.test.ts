import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deflateSync, inflateSync, deflateRawSync } from 'node:zlib';
import { inflateRaw, inflateZlib } from '../src/main/ets/core/pdf/Inflate.ts';
import { extractPdfText } from '../src/main/ets/core/pdf/PdfTextExtractor.ts';
import { PdfWriter } from '../src/main/ets/core/pdf/PdfWriter.ts';

/** 确定性伪随机字节（mulberry32） */
function pseudoBytes(n: number, seed = 7): Uint8Array {
  let s = seed >>> 0 || 1;
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    s = (s + 0x6d2b79f5) | 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    out[i] = (t ^ (t >>> 14)) & 0xff;
  }
  return out;
}

test('纯 TS inflateRaw 与 node zlib 往返一致（随机数据多档位）', () => {
  for (const size of [1, 100, 4096, 70000]) {
    const payload = pseudoBytes(size);
    const deflated = deflateRawSync(Buffer.from(payload), { level: 6 });
    const inflated = inflateRaw(new Uint8Array(deflated), size);
    assert.deepEqual(inflated, payload, `size=${size}`);
  }
});

test('纯 TS inflateZlib 与 node inflateSync 往返一致', () => {
  const payload = Buffer.from('FlateDecode 内容 '.repeat(500) + '含中文', 'utf8');
  const deflated = deflateSync(payload);
  const inflated = inflateZlib(new Uint8Array(deflated), payload.length);
  assert.deepEqual(new TextDecoder().decode(inflated), payload.toString('utf8'));
});

test('重复数据（RLE 密集）与未压缩 stored 块', () => {
  const repetitive = Buffer.alloc(50000, 0x41);
  const inflated1 = inflateRaw(new Uint8Array(deflateRawSync(repetitive, { level: 9 })), repetitive.length);
  assert.deepEqual(inflated1, new Uint8Array(repetitive));

  // level 0 → stored 块
  const stored = deflateRawSync(Buffer.from('STORED BLOCK DATA'.repeat(100)), { level: 0 });
  const inflated2 = inflateRaw(new Uint8Array(stored));
  assert.equal(new TextDecoder().decode(inflated2), 'STORED BLOCK DATA'.repeat(100));
});

test('损坏输入抛错而非挂死', () => {
  const bad = new Uint8Array([0x78, 0x9c, 0x00, 0x01, 0x02, 0x03]);
  assert.throws(() => inflateZlib(bad));
});

test('PDF 全链路：纯 TS inflate 替代 node zlib 完成 round-trip', () => {
  const pdf = new PdfWriter();
  pdf.addParagraph('用纯 TS 解压的内容流');
  pdf.addParagraph('The pure-TS inflate path works end to end.');
  const bytes = pdf.build();
  const text = extractPdfText(bytes, (d) => inflateZlib(d));
  const all = text.pages[0].lines.map((l) => l.text).join('\n');
  assert.ok(all.includes('用纯 TS 解压的内容流'));
  assert.ok(all.includes('The pure-TS inflate path works end to end.'));
  // 与 node zlib 结果一致性（双重校验）
  const viaNode = extractPdfText(bytes, (d) => new Uint8Array(inflateSync(Buffer.from(d))));
  assert.deepEqual(text, viaNode);
});
