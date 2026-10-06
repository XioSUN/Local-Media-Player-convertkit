import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

import { sha256HexBytes, safeEqualHex } from '../src/main/ets/core/extpack/Hash.ts';
import { parseRegistry, latestCompatible, InstalledStore } from '../src/main/ets/core/extpack/RegistryCore.ts';
import { parseManifest, validateManifest, APP_VERSION } from '../src/main/ets/core/extpack/ExtensionManifest.ts';
import { MemoryZipSource } from '../src/main/ets/core/zip/ZipCodec.ts';

const REPO = path.dirname(fileURLToPath(import.meta.url));
const SERVER_JS = path.join(REPO, '..', '..', '..', 'server', 'index.js');
const BUILD_PACKS_JS = path.join(REPO, '..', '..', '..', 'server', 'tools', 'build-packs.js');

test('端到端：构建包 → 启动服务 → 拉注册表 → 下载 → 校验 → 安装', async () => {
  // 1. 构建扩展包
  execFileSync('node', [BUILD_PACKS_JS], { stdio: 'pipe' });
  const registryPath = path.join(REPO, '..', '..', '..', 'server', 'packages', 'registry.json');
  assert.ok(fs.existsSync(registryPath), 'registry.json 应已生成');

  // 2. 启动分发服务（随机端口）
  const child = spawn('node', [SERVER_JS, '--port', '0'], { stdio: ['ignore', 'pipe', 'pipe'] });
  const port = await new Promise((resolve, reject) => {
    let out = '';
    const timer = setTimeout(() => reject(new Error('server 启动超时')), 10000);
    child.stdout.on('data', (d) => {
      out += d.toString();
      const m = /127\.0\.0\.1:(\d+)/.exec(out);
      if (m) {
        clearTimeout(timer);
        resolve(parseInt(m[1], 10));
      }
    });
    child.on('exit', (code) => reject(new Error(`server 提前退出 code=${code}`)));
  });
  const base = `http://127.0.0.1:${port}`;
  try {
    // 3. 健康检查 + 注册表
    const health = await (await fetch(`${base}/health`)).json();
    assert.equal(health.ok, true);

    const registryText = await (await fetch(`${base}/registry.json`)).text();
    const registry = parseRegistry(registryText);
    const available = latestCompatible(registry.packages, APP_VERSION);
    assert.ok(available.length >= 4, `应有 ≥4 个包，实际 ${available.length}`);

    // 4. 逐包：下载 → SHA-256 → manifest 校验 → 模拟安装
    const store = new InstalledStore();
    for (const pkg of available) {
      const res = await fetch(`${base}${pkg.url}`);
      assert.equal(res.status, 200, `${pkg.url} 应可下载`);
      const bytes = new Uint8Array(await res.arrayBuffer());

      // SHA-256 + 大小校验（设备端 ExtensionPackageManager 同逻辑）
      const actual = sha256HexBytes(bytes);
      assert.ok(safeEqualHex(actual, pkg.sha256), `${pkg.id} sha256 校验`);
      assert.equal(bytes.length, pkg.size, `${pkg.id} 大小校验`);

      // manifest 校验
      const src = MemoryZipSource.from(bytes);
      const manifestRaw = src.readText('manifest.json');
      assert.ok(manifestRaw, `${pkg.id} 应含 manifest.json`);
      const manifestObj = JSON.parse(manifestRaw!) as object;
      assert.deepEqual(validateManifest(manifestObj), []);
      const manifest = parseManifest(manifestObj);
      assert.equal(manifest.id, pkg.id);
      assert.equal(manifest.version, pkg.version);

      // 安装记录
      store.upsert({
        id: manifest.id,
        name: manifest.name,
        version: manifest.version,
        kind: manifest.kind,
        installPath: `/tmp/plugins/${manifest.id}/${manifest.version}`,
        enabled: true,
        installedAt: new Date().toISOString(),
        provides: (manifest.provides ?? []).map((p) => p.converterId)
      });
    }

    // 5. 三条转换能力均被解锁
    assert.equal(store.isConverterUnlocked('docx-to-pdf'), true);
    assert.equal(store.isConverterUnlocked('pdf-to-docx'), true);
    assert.equal(store.isConverterUnlocked('pdf-to-xlsx'), true);
    // 视觉预设包不提供转换能力
    assert.equal(store.list().some((p) => p.kind === 'visual-preset'), true);
  } finally {
    child.kill('SIGTERM');
  }
});

test('篡改的包必须被 SHA-256 校验拦截', async () => {
  const registryText = fs.readFileSync(path.join(REPO, '..', '..', '..', 'server', 'packages', 'registry.json'), 'utf8');
  const registry = parseRegistry(registryText);
  const pkg = registry.packages[0];

  const tampered = new Uint8Array(pkg.size);
  tampered.set(Buffer.from('TAMPERED PACKAGE DATA', 'utf8'));
  const actual = sha256HexBytes(tampered);
  assert.equal(safeEqualHex(actual, pkg.sha256), false, '篡改包不得通过校验');
});
