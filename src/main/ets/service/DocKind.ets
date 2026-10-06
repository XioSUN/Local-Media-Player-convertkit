/**
 * DocKind — 转换模块的最小类型探测（魔数级）。
 * 只需区分 pdf / docx / xlsx（转换路由用）；完整文档类型识别见 doc-viewer 仓。
 */

export type DocKind = 'pdf' | 'docx' | 'xlsx' | 'unsupported';

function hasSub(bytes: Uint8Array, text: string): boolean {
  const limit = Math.min(bytes.length - text.length, 4096);
  for (let i = 0; i <= limit; i++) {
    let ok = true;
    for (let j = 0; j < text.length; j++) {
      if (bytes[i + j] !== text.charCodeAt(j)) {
        ok = false;
        break;
      }
    }
    if (ok) {
      return true;
    }
  }
  return false;
}

export function detectDocKind(bytes: Uint8Array, fileName: string): DocKind {
  const lower = fileName.toLowerCase();
  // %PDF
  if (bytes.length >= 4 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46) {
    return 'pdf';
  }
  // ZIP 容器
  if (bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b) {
    if (hasSub(bytes, 'word/')) {
      return 'docx';
    }
    if (hasSub(bytes, 'xl/')) {
      return 'xlsx';
    }
  }
  if (lower.endsWith('.pdf')) {
    return 'pdf';
  }
  if (lower.endsWith('.docx')) {
    return 'docx';
  }
  if (lower.endsWith('.xlsx')) {
    return 'xlsx';
  }
  return 'unsupported';
}
