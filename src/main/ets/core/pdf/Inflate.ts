/**
 * Inflate — 纯 TS 的 DEFLATE（RFC1951）解压 + zlib 包装（RFC1950）读取。
 *
 * 为什么自研：HMOS 的 @ohos.zlib 只有文件级 API（compressFile/decompressFile），
 * 没有内存解压；而 PDF FlateDecode 内容流是内存中的 zlib 流。核心层保持零平台
 * 依赖（ArkTS/Node 双端一致），Node 侧测试用 node:zlib 交叉验证。
 *
 * 实现：经典 puff 风格（Huffman 表逐位解码），无优化但正确、确定、够快
 * （PDF 内容流通常几 KB ~ 几百 KB）。
 */

/** RFC1951 raw inflate */
export function inflateRaw(data: Uint8Array, expectedSize: number = 0): Uint8Array {
  const out = expectedSize > 0 ? new Uint8Array(expectedSize) : new Uint8Array(Math.max(256, data.length * 4));
  let outLen = 0;
  let bitPos = 0;

  const ensure = (need: number): void => {
    if (outLen + need > out.length) {
      let cap = out.length * 2;
      while (cap < outLen + need) {
        cap *= 2;
      }
      const bigger = new Uint8Array(cap);
      bigger.set(out.subarray(0, outLen));
      outBuf = bigger;
    }
  };
  let outBuf = out;
  const put = (b: number): void => {
    ensure(1);
    outBuf[outLen++] = b & 0xff;
  };
  const copy = (dist: number, len: number): void => {
    ensure(len);
    for (let i = 0; i < len; i++) {
      outBuf[outLen] = outBuf[outLen - dist];
      outLen++;
    }
  };

  const readBits = (count: number): number => {
    let value = 0;
    for (let i = 0; i < count; i++) {
      const byte = data[bitPos >> 3];
      if (byte === undefined) {
        throw new Error('Inflate: 输入提前结束');
      }
      const bit = (byte >> (bitPos & 7)) & 1;
      value |= bit << i;
      bitPos++;
    }
    return value;
  };
  const alignByte = (): void => {
    if (bitPos % 8 !== 0) {
      bitPos += 8 - (bitPos % 8);
    }
  };

  // Huffman 解码表：{counts, symbols}（canonical Huffman）
  interface HuffTable {
    counts: Int32Array;
    symbols: Int32Array;
  }
  const buildTable = (lengths: Uint8Array | number[]): HuffTable => {
    const counts = new Int32Array(16);
    for (let i = 0; i < lengths.length; i++) {
      counts[lengths[i]]++;
    }
    counts[0] = 0;
    const offsets = new Int32Array(16);
    for (let i = 1; i < 16; i++) {
      offsets[i] = offsets[i - 1] + counts[i - 1];
    }
    const symbols = new Int32Array(lengths.length);
    for (let i = 0; i < lengths.length; i++) {
      if (lengths[i] !== 0) {
        symbols[offsets[lengths[i]]++] = i;
      }
    }
    return { counts, symbols };
  };
  const decode = (table: HuffTable): number => {
    let code = 0;
    let first = 0;
    let index = 0;
    for (let len = 1; len < 16; len++) {
      code |= readBits(1);
      const count = table.counts[len];
      if (code - first < count) {
        return table.symbols[index + (code - first)];
      }
      index += count;
      first = (first + count) << 1;
      code <<= 1;
    }
    throw new Error('Inflate: 非法 Huffman 编码');
  };

  const LEN_BASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258];
  const LEN_EXTRA = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0];
  const DIST_BASE = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577];
  const DIST_EXTRA = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13];

  const fixedLitTable: HuffTable = (() => {
    const lengths = new Uint8Array(288);
    for (let i = 0; i < 144; i++) { lengths[i] = 8; }
    for (let i = 144; i < 256; i++) { lengths[i] = 9; }
    for (let i = 256; i < 280; i++) { lengths[i] = 7; }
    for (let i = 280; i < 288; i++) { lengths[i] = 8; }
    return buildTable(lengths);
  })();
  const fixedDistTable: HuffTable = buildTable(new Uint8Array(30).fill(5));

  const inflateBlock = (litTable: HuffTable, distTable: HuffTable): void => {
    for (;;) {
      const sym = decode(litTable);
      if (sym < 256) {
        put(sym);
      } else if (sym === 256) {
        return;
      } else {
        const lenSym = sym - 257;
        if (lenSym < 0 || lenSym >= LEN_BASE.length) {
          throw new Error(`Inflate: 非法长度符号 ${sym}`);
        }
        const len = LEN_BASE[lenSym] + readBits(LEN_EXTRA[lenSym]);
        const distSym = decode(distTable);
        const dist = DIST_BASE[distSym] + readBits(DIST_EXTRA[distSym]);
        if (dist > outLen) {
          throw new Error('Inflate: 距离超出输出窗口');
        }
        copy(dist, len);
      }
    }
  };

  const readStoredBlock = (): void => {
    alignByte();
    const len = data[bitPos >> 3] | (data[(bitPos >> 3) + 1] << 8);
    bitPos += 16;
    const nlen = data[bitPos >> 3] | (data[(bitPos >> 3) + 1] << 8);
    bitPos += 16;
    if ((len ^ 0xffff) !== nlen) {
      throw new Error('Inflate: stored 块 LEN/NLEN 不一致');
    }
    const start = bitPos >> 3;
    ensure(len);
    outBuf.set(data.subarray(start, start + len), outLen);
    outLen += len;
    bitPos += len * 8;
  };

  const readDynamicTables = (): [HuffTable, HuffTable] => {
    const HLIT = readBits(5) + 257;
    const HDIST = readBits(5) + 1;
    const HCLEN = readBits(4) + 4;
    const ORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];
    const codeLengths = new Uint8Array(19);
    for (let i = 0; i < HCLEN; i++) {
      codeLengths[ORDER[i]] = readBits(3);
    }
    const codeTable = buildTable(codeLengths);

    const lengths = new Uint8Array(HLIT + HDIST);
    let i = 0;
    while (i < lengths.length) {
      const sym = decode(codeTable);
      if (sym < 16) {
        lengths[i++] = sym;
      } else if (sym === 16) {
        if (i === 0) {
          throw new Error('Inflate: 重复标记无前置长度');
        }
        const prev = lengths[i - 1];
        const repeat = 3 + readBits(2);
        for (let k = 0; k < repeat; k++) { lengths[i++] = prev; }
      } else if (sym === 17) {
        const repeat = 3 + readBits(3);
        for (let k = 0; k < repeat; k++) { lengths[i++] = 0; }
      } else {
        const repeat = 11 + readBits(7);
        for (let k = 0; k < repeat; k++) { lengths[i++] = 0; }
      }
    }
    return [buildTable(lengths.subarray(0, HLIT)), buildTable(lengths.subarray(HLIT))];
  };

  // 块循环
  for (;;) {
    const final = readBits(1);
    const type = readBits(2);
    if (type === 0) {
      readStoredBlock();
    } else if (type === 1) {
      inflateBlock(fixedLitTable, fixedDistTable);
    } else if (type === 2) {
      const [lit, dist] = readDynamicTables();
      inflateBlock(lit, dist);
    } else {
      throw new Error('Inflate: 非法块类型 3');
    }
    if (final === 1) {
      break;
    }
  }

  if (outBuf.length !== outLen) {
    const result = new Uint8Array(outLen);
    result.set(outBuf.subarray(0, outLen));
    return result;
  }
  return outBuf;
}

/**
 * zlib 流（RFC1950）解压：2 字节头 + raw deflate + adler32 校验。
 * PDF FlateDecode 与 Node zlib.inflate 的输入格式。
 */
export function inflateZlib(data: Uint8Array, expectedSize: number = 0): Uint8Array {
  if (data.length < 6) {
    throw new Error('Inflate: zlib 流过短');
  }
  const cmf = data[0];
  const flg = data[1];
  if ((cmf & 0x0f) !== 8) {
    throw new Error(`Inflate: 非法压缩方法 ${cmf & 0x0f}`);
  }
  if (((cmf << 8) | flg) % 31 !== 0) {
    throw new Error('Inflate: zlib 头校验失败');
  }
  const dictFlag = (flg >> 5) & 1;
  let start = 2;
  if (dictFlag) {
    start += 4; // 跳过 DICTID（不支持预设字典，PDF 不使用）
  }
  const inflated = inflateRaw(data.subarray(start, data.length - 4), expectedSize);
  // adler32 校验（大端，位于流尾 4 字节）
  const expect = ((data[data.length - 4] << 24) | (data[data.length - 3] << 16) | (data[data.length - 2] << 8) | data[data.length - 1]) >>> 0;
  let a = 1;
  let b = 0;
  for (let i = 0; i < inflated.length; i++) {
    a = (a + inflated[i]) % 65521;
    b = (b + a) % 65521;
  }
  const actual = ((b << 16) | a) >>> 0;
  if (actual !== expect) {
    throw new Error(`Inflate: adler32 校验失败 actual=${actual.toString(16)} expect=${expect.toString(16)}`);
  }
  return inflated;
}
