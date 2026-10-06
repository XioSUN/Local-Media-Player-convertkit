/**
 * ExtensionManifest — 扩展包清单 schema v1（纯逻辑）
 *
 * 扩展包 = zip（manifest.json + profile.json[/preset.rvm/...]），见
 * docs/EXTENSION-PACK-SPEC.md。安全模型：转换器实现编译进应用（ArkTS 无
 * 运行时代码注入能力），扩展包提供「能力解锁 + 配置 profile + 资源预设」，
 * 并以 SHA-256 校验保证完整性（v2 规划签名校验）。
 */

export type PackKind = 'converter-profile' | 'visual-preset';

export interface ConverterProvide {
  converterId: string;
  from: string[];
  to: string;
  label?: string;
}

export interface ExtensionManifest {
  schemaVersion: number;
  id: string;
  name: string;
  version: string;
  kind: PackKind;
  minAppVersion: string;
  description: string;
  author?: string;
  provides?: ConverterProvide[];
}

export const MANIFEST_SCHEMA_VERSION = 1;
export const APP_VERSION = '1.0.0';

/** 语义化版本比较：a>b 返回 1，a<b 返回 -1，相等 0（非法段按 0 处理） */
export function compareVersions(a: string, b: string): number {
  const pa = a.split(/[.-]/).map((x) => (/^\d+$/.test(x) ? parseInt(x, 10) : 0));
  const pb = b.split(/[.-]/).map((x) => (/^\d+$/.test(x) ? parseInt(x, 10) : 0));
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const va = pa[i] ?? 0;
    const vb = pb[i] ?? 0;
    if (va > vb) {
      return 1;
    }
    if (va < vb) {
      return -1;
    }
  }
  return 0;
}

const ID_RE = /^[a-z][a-z0-9-]{2,48}$/;
const VERSION_RE = /^\d+\.\d+\.\d+$/;
const KINDS: PackKind[] = ['converter-profile', 'visual-preset'];

/**
 * 校验清单；返回错误列表（空数组 = 合法）。
 * 宽松策略：未知字段忽略，缺失可选字段不报错。
 */
export function validateManifest(raw: object): string[] {
  const errors: string[] = [];
  const m = raw as Record<string, unknown>;

  if (m.schemaVersion !== MANIFEST_SCHEMA_VERSION) {
    errors.push(`schemaVersion 必须为 ${MANIFEST_SCHEMA_VERSION}`);
  }
  if (typeof m.id !== 'string' || !ID_RE.test(m.id)) {
    errors.push('id 必须为小写字母开头的 3-49 位 [a-z0-9-]');
  }
  if (typeof m.name !== 'string' || m.name.length === 0 || m.name.length > 64) {
    errors.push('name 必须为 1-64 字符');
  }
  if (typeof m.version !== 'string' || !VERSION_RE.test(m.version)) {
    errors.push('version 必须为 x.y.z 语义化版本');
  }
  if (typeof m.kind !== 'string' || !KINDS.includes(m.kind as PackKind)) {
    errors.push(`kind 必须为 ${KINDS.join(' | ')}`);
  }
  if (typeof m.minAppVersion !== 'string' || !VERSION_RE.test(m.minAppVersion)) {
    errors.push('minAppVersion 必须为 x.y.z');
  }
  if (typeof m.description !== 'string' || m.description.length > 256) {
    errors.push('description 必须为 ≤256 字符');
  }
  if (m.kind === 'converter-profile') {
    const provides = m.provides;
    if (!Array.isArray(provides) || provides.length === 0) {
      errors.push('converter-profile 必须提供非空 provides');
    } else {
      for (const p of provides) {
        const pv = p as Record<string, unknown>;
        if (typeof pv.converterId !== 'string' || pv.converterId.length === 0) {
          errors.push('provides[].converterId 缺失');
        }
        if (!Array.isArray(pv.from) || pv.from.length === 0) {
          errors.push('provides[].from 必须为非空数组');
        }
        if (typeof pv.to !== 'string' || pv.to.length === 0) {
          errors.push('provides[].to 缺失');
        }
      }
    }
  }
  return errors;
}

/** 是否与当前应用版本兼容 */
export function isCompatible(manifest: ExtensionManifest, appVersion: string = APP_VERSION): boolean {
  return compareVersions(appVersion, manifest.minAppVersion) >= 0;
}

/** 从未知对象解析（校验失败抛错） */
export function parseManifest(raw: object): ExtensionManifest {
  const errors = validateManifest(raw);
  if (errors.length > 0) {
    throw new Error(`ExtensionManifest: ${errors.join('; ')}`);
  }
  return raw as unknown as ExtensionManifest;
}
