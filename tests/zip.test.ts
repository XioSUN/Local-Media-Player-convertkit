import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inflateRawSync, deflateRawSync } from 'node:zlib';
import { ZipWriter, MemoryZipSource, MappedZipSource, crc32 } from '../src/main/ets/core/zip/ZipCodec.ts';

const inflateAdapter = (data: Uint8Array, _expected: number): Uint8Array =>
  new Uint8Array(inflateRawSync(Buffer.from(data)));

test('crc32 已知向量', () => {
  assert.equal(crc32(new TextEncoder().encode('123456789')), 0xcbf43926);
  assert.equal(crc32(new Uint8Array(0)), 0);
});

test('ZipWriter 输出可以被标准解析器回读（STORE round-trip）', () => {
  const zip = new ZipWriter();
  zip.addText('hello.txt', '你好，ZIP 世界！');
  zip.add('data/binary.bin', new Uint8Array([0, 1, 2, 250, 251]));
  zip.addText('sub/deep/nested.xml', '<root attr="值"/>');
  const bytes = zip.finish();

  // EOCD 签名位于末尾 22 字节
  assert.equal(bytes[bytes.length - 22], 0x50);
  assert.equal(bytes[bytes.length - 21], 0x4b);
  assert.equal(bytes[bytes.length - 20], 0x05);

  const src = MemoryZipSource.from(bytes);
  assert.deepEqual(src.names().sort(), ['data/binary.bin', 'hello.txt', 'sub/deep/nested.xml']);
  assert.equal(src.readText('hello.txt'), '你好，ZIP 世界！');
  const bin = src.read('data/binary.bin')!;
  assert.deepEqual(Array.from(bin), [0, 1, 2, 250, 251]);
  assert.equal(src.readText('sub/deep/nested.xml'), '<root attr="值"/>');
  assert.equal(src.read('missing'), null);
});

/** 手工构造含 DEFLATE 条目的 ZIP（覆盖解析器 method=8 路径） */
function buildDeflateZip(name: string, payload: Buffer): Uint8Array {
  const deflated = deflateRawSync(payload);
  const nameBytes = Buffer.from(name, 'utf8');
  const crc = crc32(new Uint8Array(payload));

  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(0, 6);
  local.writeUInt16LE(8, 8); // method = deflate
  local.writeUInt16LE(0, 10);
  local.writeUInt16LE(0x21, 12);
  local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(deflated.length, 18);
  local.writeUInt32LE(payload.length, 22);
  local.writeUInt16LE(nameBytes.length, 26);
  local.writeUInt16LE(0, 28);

  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt16LE(0, 8);
  central.writeUInt16LE(8, 10);
  central.writeUInt16LE(0, 12);
  central.writeUInt16LE(0x21, 14);
  central.writeUInt32LE(crc, 16);
  central.writeUInt32LE(deflated.length, 20);
  central.writeUInt32LE(payload.length, 24);
  central.writeUInt16LE(nameBytes.length, 28);
  central.writeUInt16LE(0, 30);
  central.writeUInt16LE(0, 32);
  central.writeUInt16LE(0, 34);
  central.writeUInt16LE(0, 36);
  central.writeUInt32LE(0, 38);
  central.writeUInt32LE(0, 42);

  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(1, 8);
  eocd.writeUInt16LE(1, 10);
  eocd.writeUInt32LE(central.length + nameBytes.length, 12);
  eocd.writeUInt32LE(30 + nameBytes.length + deflated.length, 16);

  return Buffer.concat([local, nameBytes, deflated, central, nameBytes, eocd]);
}

test('MemoryZipSource 支持注入 raw-inflate 解 DEFLATE 条目', () => {
  const payload = Buffer.from('deflate 内容 '.repeat(50), 'utf8');
  const bytes = buildDeflateZip('data/deflated.txt', payload);

  const src = MemoryZipSource.from(bytes, inflateAdapter);
  assert.equal(src.readText('data/deflated.txt'), payload.toString('utf8'));

  // 未注入 inflate 时抛错
  assert.throws(() => MemoryZipSource.from(bytes), /inflateRaw/);
});

test('MappedZipSource：目录型来源', () => {
  const src = new MappedZipSource([
    { name: 'a.txt', data: new TextEncoder().encode('A') },
    { name: 'b/c.txt', data: new TextEncoder().encode('C') }
  ]);
  assert.equal(src.readText('a.txt'), 'A');
  assert.equal(src.readText('b/c.txt'), 'C');
  assert.deepEqual(src.names().sort(), ['a.txt', 'b/c.txt']);
});

test('非法 ZIP 抛错', () => {
  assert.throws(() => MemoryZipSource.from(new Uint8Array([1, 2, 3])), /EOCD/);
});
