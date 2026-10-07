/**
 * DocKind — 转换模块的最小类型探测（魔数级）。
 * v2 扩展：epub（zip + mimetype 条目）/ txt（扩展名兜底）。
 */

export type DocKind = 'pdf' | 'docx' | 'xlsx' | 'epub' | 'txt' | 'unsupported';

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
    if (hasSub(bytes, 'epub+zip')) {
      return 'epub';
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
  if (lower.endsWith('.epub')) {
    return 'epub';
  }
  if (lower.endsWith('.txt') || lower.endsWith('.md')) {
    return 'txt';
  }
  return 'unsupported';
}
