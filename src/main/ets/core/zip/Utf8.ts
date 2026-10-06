/**
 * Utf8 — 纯 ECMA 的 UTF-8 编解码（零依赖）。
 *
 * ArkTS 运行时没有 Web API 的全局 TextEncoder/TextDecoder（Node 有），
 * 核心层为保证 ArkTS / Node 双端可跑，一律使用本实现：
 *  - encode：encodeURIComponent 逐字节展开（ECMA 内建，保证存在）
 *  - decode：手写 UTF-8 序列解码，非法序列以 U+FFFD 替代（容错与标准一致）
 */

export function utf8Encode(text: string): Uint8Array {
  const out: number[] = [];
  const escaped = encodeURIComponent(text);
  for (let i = 0; i < escaped.length; i++) {
    if (escaped[i] === '%') {
      out.push(parseInt(escaped.substr(i + 1, 2), 16));
      i += 2;
    } else {
      out.push(escaped.charCodeAt(i));
    }
  }
  return new Uint8Array(out);
}

export function utf8Decode(bytes: Uint8Array): string {
  let out = '';
  let i = 0;
  const n = bytes.length;
  while (i < n) {
    const b0 = bytes[i];
    if (b0 < 0x80) {
      out += String.fromCharCode(b0);
      i += 1;
      continue;
    }
    let seqLen = 0;
    let code = 0;
    if ((b0 & 0xe0) === 0xc0) {
      seqLen = 2;
      code = b0 & 0x1f;
    } else if ((b0 & 0xf0) === 0xe0) {
      seqLen = 3;
      code = b0 & 0x0f;
    } else if ((b0 & 0xf8) === 0xf0) {
      seqLen = 4;
      code = b0 & 0x07;
    } else {
      out += '\uFFFD';
      i += 1;
      continue;
    }
    if (i + seqLen > n) {
      out += '\uFFFD';
      break;
    }
    let valid = true;
    for (let k = 1; k < seqLen; k++) {
      const bk = bytes[i + k];
      if ((bk & 0xc0) !== 0x80) {
        valid = false;
        break;
      }
      code = (code << 6) | (bk & 0x3f);
    }
    if (!valid || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) {
      out += '\uFFFD';
      i += 1;
      continue;
    }
    if (code > 0xffff) {
      // 代理对输出
      const v = code - 0x10000;
      out += String.fromCharCode(0xd800 + (v >> 10), 0xdc00 + (v & 0x3ff));
    } else {
      out += String.fromCharCode(code);
    }
    i += seqLen;
  }
  return out;
}
