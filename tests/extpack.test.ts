import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  sha256Hex, sha256HexBytes, toHex, safeEqualHex
} from '../src/main/ets/core/extpack/Hash.ts';
import {
  validateManifest, parseManifest, compareVersions, isCompatible
} from '../src/main/ets/core/extpack/ExtensionManifest.ts';
import {
  parseRegistry, latestCompatible, InstalledStore, BUILTIN_CONVERTERS
} from '../src/main/ets/core/extpack/RegistryCore.ts';

// ── SHA-256 ──────────────────────────────────────────

test('SHA-256 标准向量', () => {
  assert.equal(sha256Hex(''), 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  assert.equal(sha256Hex('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  assert.equal(
    sha256Hex('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq'),
    '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1'
  );
  assert.equal(
    sha256Hex('a'.repeat(1000)),
    '41edece42d63e8d9bf515a9ba6932e1c20cbc9f5a5d134645adb5db1b9737ea3'
  );
});

test('SHA-256 字节接口与 hex 比较', () => {
  const data = new TextEncoder().encode('hello');
  assert.equal(sha256HexBytes(data), '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824');
  assert.equal(toHex(new Uint8Array([0, 15, 255])), '000fff');
});

test('safeEqualHex 防时序比较', () => {
  assert.equal(safeEqualHex('aa'.repeat(32), 'aa'.repeat(32)), true);
  assert.equal(safeEqualHex('aa'.repeat(32), 'ab'.repeat(32)), false);
  assert.equal(safeEqualHex('aa', 'aaa'), false);
});

// ── Manifest ─────────────────────────────────────────

const GOOD_MANIFEST = {
  schemaVersion: 1,
  id: 'pack-docx-to-pdf',
  name: 'Word 导出 PDF 功能包',
  version: '1.2.0',
  kind: 'converter-profile',
  minAppVersion: '1.0.0',
  description: '解锁 docx→pdf 转换',
  provides: [{ converterId: 'docx-to-pdf', from: ['docx'], to: 'pdf' }]
};

test('合法清单通过校验', () => {
  assert.deepEqual(validateManifest(GOOD_MANIFEST), []);
  assert.equal(parseManifest(GOOD_MANIFEST).id, 'pack-docx-to-pdf');
});

test('非法清单逐项报错', () => {
  const bad = validateManifest({
    schemaVersion: 2,
    id: 'X',
    name: '',
    version: '1.0',
    kind: 'other',
    minAppVersion: 'v1',
    description: '',
    kind2: 1
  });
  assert.ok(bad.some((e) => e.includes('schemaVersion')));
  assert.ok(bad.some((e) => e.includes('id ')));
  assert.ok(bad.some((e) => e.includes('version')));
  assert.ok(bad.some((e) => e.includes('kind')));
  assert.ok(bad.length >= 4);
});

test('converter-profile 必须提供 provides', () => {
  const bad = validateManifest({ ...GOOD_MANIFEST, provides: [] });
  assert.ok(bad.some((e) => e.includes('provides')));
});

test('语义化版本比较', () => {
  assert.equal(compareVersions('1.0.0', '1.0.0'), 0);
  assert.equal(compareVersions('1.2.0', '1.1.9'), 1);
  assert.equal(compareVersions('0.9.9', '1.0.0'), -1);
  assert.equal(compareVersions('1.0.10', '1.0.9'), 1);
  assert.equal(compareVersions('2.0', '1.9.9'), 1);
});

test('兼容性判断', () => {
  const m = parseManifest({ ...GOOD_MANIFEST, minAppVersion: '1.2.0' });
  assert.equal(isCompatible(m, '1.2.0'), true);
  assert.equal(isCompatible(m, '1.1.0'), false);
  assert.equal(isCompatible(m, '2.0.0'), true);
});

// ── Registry / Installed ─────────────────────────────

const REGISTRY_JSON = JSON.stringify({
  updatedAt: '2026-10-06T00:00:00Z',
  packages: [
    { id: 'pack-b', name: 'B', version: '1.0.0', kind: 'converter-profile', summary: '', url: 'http://x/b.zip', sha256: 'a'.repeat(64), size: 100, minAppVersion: '1.0.0' },
    { id: 'pack-b', name: 'B', version: '1.1.0', kind: 'converter-profile', summary: '', url: 'http://x/b11.zip', sha256: 'b'.repeat(64), size: 110, minAppVersion: '1.0.0' },
    { id: 'pack-a', name: 'A', version: '2.0.0', kind: 'visual-preset', summary: '', url: 'http://x/a.zip', sha256: 'c'.repeat(64), size: 50, minAppVersion: '1.5.0' }
  ]
});

test('注册表解析与校验', () => {
  const reg = parseRegistry(REGISTRY_JSON);
  assert.equal(reg.packages.length, 3);
  assert.throws(() => parseRegistry('{"packages": "x"}'), /packages/);
  assert.throws(
    () => parseRegistry('{"packages": [{ "id": "x" }]}'),
    /缺少字段/
  );
  assert.throws(
    () => parseRegistry('{"packages": [{ "id":"x","name":"x","version":"1.0.0","kind":"visual-preset","summary":"","url":"u","sha256":"zz","size":1,"minAppVersion":"1.0.0" }]}'),
    /sha256/
  );
});

test('最新兼容版本筛选', () => {
  const reg = parseRegistry(REGISTRY_JSON);
  const latest = latestCompatible(reg.packages, '1.0.0');
  assert.deepEqual(latest.map((p) => `${p.id}@${p.version}`), ['pack-b@1.1.0']);
  const all = latestCompatible(reg.packages, '1.5.0');
  assert.equal(all.length, 2);
});

test('内置转换器免安装解锁（v1.1 默认可用）', () => {
  const empty = new InstalledStore(); // 空库（未安装任何包）
  for (const id of BUILTIN_CONVERTERS) {
    assert.equal(empty.isConverterUnlocked(id), true, `${id} 应内置解锁`);
  }
  // 未知/未来能力仍受扩展包门控
  assert.equal(empty.isConverterUnlocked('pdf-to-excel'), false);
  empty.upsert({
    id: 'pack-future', name: '未来能力', version: '1.0.0',
    kind: 'converter-profile', installPath: '/tmp/x', enabled: true,
    installedAt: '2026-10-06T00:00:00Z', provides: ['pdf-to-excel']
  });
  assert.equal(empty.isConverterUnlocked('pdf-to-excel'), true);
});

test('InstalledStore：安装/启停/持久化 round-trip', () => {
  const store = new InstalledStore();
  store.upsert({
    id: 'pack-docx-to-pdf', name: 'Word导出PDF', version: '1.2.0',
    kind: 'converter-profile', installPath: '/data/pack', enabled: true,
    installedAt: '2026-10-06T00:00:00Z', provides: ['docx-to-pdf']
  });
  assert.equal(store.isConverterUnlocked('docx-to-pdf'), true);
  assert.equal(store.isConverterUnlocked('pdf-to-excel'), false);
  store.setEnabled('pack-docx-to-pdf', false);
  // v1.1：内置转换器不随扩展包启停变化
  assert.equal(store.isConverterUnlocked('docx-to-pdf'), true);

  const restored = InstalledStore.deserialize(store.serialize());
  assert.equal(restored.get('pack-docx-to-pdf')?.provides?.[0], 'docx-to-pdf');
  assert.equal(InstalledStore.deserialize('bad json').list().length, 0);
});
