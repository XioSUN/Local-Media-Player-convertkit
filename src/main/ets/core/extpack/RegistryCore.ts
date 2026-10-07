/**
 * RegistryCore — 扩展包注册表/安装记录核心逻辑（纯逻辑）
 *
 * 注册表（服务端 registry.json）：
 *   { "updatedAt": "...", "packages": [{ id,name,version,kind,summary,url,sha256,size,minAppVersion }] }
 * 安装记录（设备端 installed.json）：
 *   { "packages": [{ id, name, version, kind, installPath, enabled, installedAt }] }
 */

import { compareVersions, isCompatible, type PackKind } from './ExtensionManifest.ts';

/**
 * 内置转换器（v1.1 起随应用分发，无需安装任何扩展包即解锁）。
 * v2：电子书/文本方向扩展（epub→pdf、txt→pdf、pdf→epub、xlsx→pdf、docx→txt）。
 * converter-profile 类型扩展包保留用于未来分发新增转换能力。
 */
export const BUILTIN_CONVERTERS: string[] = [
  'docx-to-pdf', 'pdf-to-docx', 'pdf-to-xlsx',
  'epub-to-pdf', 'txt-to-pdf', 'pdf-to-epub', 'xlsx-to-pdf', 'docx-to-txt',
  'mobi-to-pdf'
];

export function isBuiltInConverter(converterId: string): boolean {
  return BUILTIN_CONVERTERS.includes(converterId);
}

export interface RegistryPackage {
  id: string;
  name: string;
  version: string;
  kind: PackKind;
  summary: string;
  url: string;
  sha256: string;
  size: number;
  minAppVersion: string;
}

export interface Registry {
  updatedAt: string;
  packages: RegistryPackage[];
}

export interface InstalledPackage {
  id: string;
  name: string;
  version: string;
  kind: PackKind;
  installPath: string;
  enabled: boolean;
  installedAt: string;
  /** converter-profile 包提供的转换器 id 列表 */
  provides?: string[];
}

export function parseRegistry(text: string): Registry {
  const raw = JSON.parse(text) as Record<string, unknown>;
  const packages = raw.packages;
  if (!Array.isArray(packages)) {
    throw new Error('RegistryCore: packages 必须为数组');
  }
  const out: RegistryPackage[] = [];
  for (const p of packages) {
    const rec = p as Record<string, unknown>;
    for (const field of ['id', 'name', 'version', 'kind', 'url', 'sha256', 'minAppVersion']) {
      if (typeof rec[field] !== 'string' || (rec[field] as string).length === 0) {
        throw new Error(`RegistryCore: 包记录缺少字段 ${field}`);
      }
    }
    if (typeof rec.summary !== 'string') {
      throw new Error('RegistryCore: 包记录缺少字段 summary');
    }
    if (!/^[0-9a-f]{64}$/.test(rec.sha256 as string)) {
      throw new Error(`RegistryCore: 包 ${rec.id} 的 sha256 非法`);
    }
    if (typeof rec.size !== 'number' || rec.size < 0) {
      throw new Error(`RegistryCore: 包 ${rec.id} 的 size 非法`);
    }
    out.push(rec as unknown as RegistryPackage);
  }
  return { updatedAt: String(raw.updatedAt ?? ''), packages: out };
}

/** 过滤与当前应用兼容的包，并按 id 分组取最新版本 */
export function latestCompatible(packages: RegistryPackage[], appVersion: string): RegistryPackage[] {
  const byId = new Map<string, RegistryPackage>();
  for (const p of packages) {
    if (!isCompatibleById(p, appVersion)) {
      continue;
    }
    const existing = byId.get(p.id);
    if (!existing || compareVersions(p.version, existing.version) > 0) {
      byId.set(p.id, p);
    }
  }
  return Array.from(byId.values()).sort((a, b) => a.id.localeCompare(b.id));
}

function isCompatibleById(p: RegistryPackage, appVersion: string): boolean {
  return compareVersions(appVersion, p.minAppVersion) >= 0;
}

export class InstalledStore {
  private packages: Map<string, InstalledPackage>;

  constructor(initial?: InstalledPackage[]) {
    this.packages = new Map((initial ?? []).map((p) => [p.id, p]));
  }

  list(): InstalledPackage[] {
    return Array.from(this.packages.values()).sort((a, b) => a.id.localeCompare(b.id));
  }

  get(id: string): InstalledPackage | null {
    return this.packages.get(id) ?? null;
  }

  upsert(pkg: InstalledPackage): void {
    this.packages.set(pkg.id, pkg);
  }

  remove(id: string): boolean {
    return this.packages.delete(id);
  }

  setEnabled(id: string, enabled: boolean): boolean {
    const pkg = this.packages.get(id);
    if (!pkg) {
      return false;
    }
    pkg.enabled = enabled;
    return true;
  }

  /**
   * 转换器是否可用：内置清单恒真；其余由已启用的 converter-profile 扩展包提供。
   */
  isConverterUnlocked(converterId: string): boolean {
    if (isBuiltInConverter(converterId)) {
      return true;
    }
    return Array.from(this.packages.values()).some(
      (p) => p.enabled && p.kind === 'converter-profile' && (p.provides ?? []).includes(converterId)
    );
  }

  /** 序列化（持久化到 installed.json） */
  serialize(): string {
    return JSON.stringify({ packages: this.list() }, null, 2);
  }

  static deserialize(text: string): InstalledStore {
    try {
      const raw = JSON.parse(text) as { packages?: InstalledPackage[] };
      return new InstalledStore(raw.packages ?? []);
    } catch (e) {
      return new InstalledStore([]);
    }
  }
}
