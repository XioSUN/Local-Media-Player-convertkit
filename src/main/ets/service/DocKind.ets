/**
 * DocKind — 转换模块类型探测（设备侧转发）。
 * 逻辑实现在 core/DocKind.ts（零 @ohos 依赖），由 Node 测试看护
 * （docs/TEST-GUARDS.md #6）；本文件仅保持既有 import 路径兼容。
 */
import { detectDocKind as detect, type DocKind as Kind } from '../core/DocKind.ts';

export type DocKind = Kind;

export function detectDocKind(bytes: Uint8Array, fileName: string): DocKind {
  return detect(bytes, fileName);
}
