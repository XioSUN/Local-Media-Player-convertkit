import { picker } from '@kit.CoreFileKit';
import fs from '@ohos.file.fs';
import { common } from '@kit.AbilityKit';
import { util } from '@kit.ArkTS';
import { common } from '@kit.AbilityKit';
import { util } from '@kit.ArkTS';
import { http } from '@kit.NetworkKit';
import {
  parseManifest, isCompatible, APP_VERSION,
  type ExtensionManifest
} from '../core/extpack/ExtensionManifest.ts';
import {
  parseRegistry, latestCompatible, InstalledStore,
  type InstalledPackage, type RegistryPackage
} from '../core/extpack/RegistryCore.ts';
import { sha256HexBytes, safeEqualHex } from '../core/extpack/Hash.ts';
import { MemoryZipSource } from '../core/zip/ZipCodec.ts';

/**
 * ExtensionPackageManager — 在线扩展包管理（设备侧）。
 *
 * 流程：registry.json → 选择包 → 下载 zip → SHA-256 校验 → 解包到
 * files/plugins/<id>/<version>/ → 读取并校验 manifest.json → 记录 installed.json。
 * 扩展包提供「能力解锁 + 配置」；转换器实现编译进应用（见 EXTENSION-PACK-SPEC）。
 */
export type InstallPhase = 'idle' | 'downloading' | 'verifying' | 'installing' | 'done' | 'failed';

/** 安装结果 */
export interface InstallResult {
  ok: boolean;
  message: string;
}

export class ExtensionPackageManager {
  readonly context: common.Context;
  readonly pluginsDir: string;
  readonly installedFile: string;
  private store: InstalledStore;

  constructor(context: common.Context) {
    this.context = context;
    this.pluginsDir = `${context.filesDir}/plugins`;
    this.installedFile = `${this.pluginsDir}/installed.json`;
    this.store = new InstalledStore([]);
  }

  /** 启动时加载安装记录 */
  async load(): Promise<void> {
    this.store = InstalledStore([]);
    try {
      const file = await fs.open(this.installedFile, fs.OpenMode.READ_ONLY);
      try {
        const stat = await fs.stat(file.fd);
        const buf = new ArrayBuffer(stat.size);
        await fs.read(file.fd, buf);
        const decoder = util.TextDecoder.create('utf-8');
        this.store = InstalledStore.deserialize(decoder.decodeToString(new Uint8Array(buf)));
      } finally {
        await fs.close(file.fd);
      }
    } catch (e) {
      // 首次启动无记录
    }
  }

  listInstalled(): InstalledPackage[] {
    return this.store.list();
  }

  isConverterUnlocked(converterId: string): boolean {
    return this.store.isConverterUnlocked(converterId);
  }

  setEnabled(id: string, enabled: boolean): Promise<void> {
    this.store.setEnabled(id, enabled);
    return this.persist();
  }

  uninstall(id: string): Promise<void> {
    const pkg = this.store.get(id);
    this.store.remove(id);
    if (pkg) {
      fs.rmdir(pkg.installPath).catch(() => undefined);
    }
    return this.persist();
  }

  /** 拉取注册表（返回与当前应用兼容的最新包列表） */
  async fetchRegistry(registryUrl: string): Promise<RegistryPackage[]> {
    const text = await this.httpGet(registryUrl);
    const registry = parseRegistry(text);
    return latestCompatible(registry.packages, APP_VERSION);
  }

  /** 下载 + 校验 + 安装一个扩展包 */
  async install(
    pkg: RegistryPackage,
    onPhase?: (phase: InstallPhase, message: string) => void
  ): Promise<InstallResult> {
    try {
      onPhase?.('downloading', `下载 ${pkg.name}…`);
      const bytes = await this.httpGetBytes(pkg.url);

      onPhase?.('verifying', 'SHA-256 校验…');
      const actual = sha256HexBytes(bytes);
      if (!safeEqualHex(actual, pkg.sha256)) {
        return { ok: false, message: `校验失败：期望 ${pkg.sha256.slice(0, 12)}…，实际 ${actual.slice(0, 12)}…` };
      }
      if (bytes.length !== pkg.size) {
        return { ok: false, message: `大小不符：期望 ${pkg.size}B，实际 ${bytes.length}B` };
      }

      onPhase?.('installing', '解包安装…');
      const src = MemoryZipSource.from(bytes);
      const manifestRaw = src.readText('manifest.json');
      if (!manifestRaw) {
        return { ok: false, message: '包内缺少 manifest.json' };
      }
      let manifest: ExtensionManifest;
      try {
        manifest = parseManifest(JSON.parse(manifestRaw) as object);
      } catch (e) {
        return { ok: false, message: `manifest 非法: ${(e as Error).message}` };
      }
      if (manifest.id !== pkg.id || manifest.version !== pkg.version) {
        return { ok: false, message: 'manifest 与注册表记录不一致' };
      }
      if (!isCompatible(manifest, APP_VERSION)) {
        return { ok: false, message: `需要应用 ≥ ${manifest.minAppVersion}` };
      }

      const installPath = `${this.pluginsDir}/${manifest.id}/${manifest.version}`;
      await this.writeEntries(installPath, src);

      this.store.upsert({
        id: manifest.id,
        name: manifest.name,
        version: manifest.version,
        kind: manifest.kind,
        installPath,
        enabled: true,
        installedAt: new Date().toISOString(),
        provides: (manifest.provides ?? []).map((p) => p.converterId)
      });
      await this.persist();
      onPhase?.('done', `已安装 ${manifest.name} ${manifest.version}`);
      return { ok: true, message: `已安装 ${manifest.name} ${manifest.version}` };
    } catch (e) {
      onPhase?.('failed', (e as Error).message);
      return { ok: false, message: `安装失败: ${(e as Error).message}` };
    }
  }

  private async writeEntries(dir: string, src: MemoryZipSource): Promise<void> {
    await fs.mkdir(dir).catch(() => undefined);
    for (const name of src.names()) {
      const data = src.read(name)!;
      const full = `${dir}/${name}`;
      const slash = full.lastIndexOf('/');
      if (slash > this.pluginsDir.length) {
        await fs.mkdir(full.slice(0, slash), true).catch(() => undefined);
      }
      const file = await fs.open(full, fs.OpenMode.READ_WRITE | fs.OpenMode.CREATE | fs.OpenMode.TRUNC);
      try {
        await fs.write(file.fd, data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer);
      } finally {
        await fs.close(file.fd);
      }
    }
  }

  private async persist(): Promise<void> {
    await fs.mkdir(this.pluginsDir).catch(() => undefined);
    const file = await fs.open(this.installedFile, fs.OpenMode.READ_WRITE | fs.OpenMode.CREATE | fs.OpenMode.TRUNC);
    try {
      const text = this.store.serialize();
      const encoded = util.TextEncoder.createUtf8().encodeInto(text);
      await fs.write(file.fd, encoded.buffer as ArrayBuffer);
    } finally {
      await fs.close(file.fd);
    }
  }

  private async httpGet(url: string): Promise<string> {
    const bytes = await this.httpGetBytes(url);
    return util.TextDecoder.create('utf-8').decodeToString(bytes);
  }

  private httpGetBytes(url: string): Promise<Uint8Array> {
    return new Promise((resolve, reject) => {
      const req = http.createHttp();
      req.request(
        url,
        { method: http.RequestMethod.GET, expectDataType: http.HttpDataType.ARRAY_BUFFER, connectTimeout: 15000, readTimeout: 30000 },
        (err, data) => {
          if (err) {
            reject(new Error(`网络请求失败: ${err.message}`));
          } else if (data.responseCode >= 400) {
            reject(new Error(`HTTP ${data.responseCode}`));
          } else {
            resolve(new Uint8Array(data.result as ArrayBuffer));
          }
          req.destroy();
        }
      );
    });
  }

  /** 读取已安装包内的 profile.json（converter-profile 配置） */
  async readProfile(id: string): Promise<object | null> {
    const pkg = this.store.get(id);
    if (!pkg) {
      return null;
    }
    try {
      const file = await fs.open(`${pkg.installPath}/profile.json`, fs.OpenMode.READ_ONLY);
      try {
        const stat = await fs.stat(file.fd);
        const buf = new ArrayBuffer(stat.size);
        await fs.read(file.fd, buf);
        const decoder = util.TextDecoder.create('utf-8');
        return JSON.parse(decoder.decodeToString(new Uint8Array(buf))) as object;
      } finally {
        await fs.close(file.fd);
      }
    } catch (e) {
      return null;
    }
  }
}
