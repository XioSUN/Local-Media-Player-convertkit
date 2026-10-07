/**
 * PalmDoc — PalmDOC（LZ77）解压（MOBI 文本记录用，纯逻辑）。
 * 算法（PalmDOC 规范）：
 *  0x00        → 字面 0x00
 *  0x01-0x08   → 后跟 b 个字面字节
 *  0x09-0x7F   → 字面
 *  0x80-0xBF   → 双字节：11bit 距离 + 3bit(+3) 长度的回引（不跨记录边界）
 *  0xC0-0xFF   → 字面空格 + (b ^ 0x80)
 */
export function palmDocInflate(src: Uint8Array): Uint8Array {
  const out: number[] = [];
  let i = 0;
  while (i < src.length) {
    const b = src[i];
    i += 1;
    if (b === 0) {
      out.push(0);
    } else if (b <= 0x08) {
      for (let j = 0; j < b && i < src.length; j++) {
        out.push(src[i]);
        i += 1;
      }
    } else if (b <= 0x7f) {
      out.push(b);
    } else if (b <= 0xbf) {
      if (i >= src.length) {
        break;
      }
      const b2 = src[i];
      i += 1;
      const pair = (b << 8) | b2;
      const dist = (pair >> 3) & 0x7ff;
      const len = (pair & 0x07) + 3;
      for (let k = 0; k < len; k++) {
        const idx = out.length - dist;
        if (idx < 0) {
          break; // 非法回引（跨边界），截断保护
        }
        out.push(out[idx]);
      }
    } else {
      out.push(0x20);
      out.push(b ^ 0x80);
    }
  }
  const bytes = new Uint8Array(out.length);
  for (let n = 0; n < out.length; n++) {
    bytes[n] = out[n];
  }
  return bytes;
}

/** 测试/夹具用：只发安全字面与长度对转义的"平凡压缩器"（字节保真 round-trip）。
 * 注：0xC0+ 的"空格+(b^0x80)"是文本压缩技巧（不保真），夹具不用。 */
export function palmDocFlatten(src: Uint8Array): Uint8Array {
  const out: number[] = [];
  for (let i = 0; i < src.length; i++) {
    const b = src[i];
    if (b === 0x00 || (b >= 0x09 && b <= 0x7f)) {
      out.push(b); // 安全字面
    } else {
      out.push(0x01, b); // 长度对转义（1 个字面字节，任意值保真）
    }
  }
  const bytes = new Uint8Array(out.length);
  for (let n = 0; n < out.length; n++) {
    bytes[n] = out[n];
  }
  return bytes;
}
