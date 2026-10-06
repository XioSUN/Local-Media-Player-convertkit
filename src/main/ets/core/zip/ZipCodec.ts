/**
 * ZipCodec — ZIP 容器读/写（纯逻辑）
 *
 * 写：STORE（不压缩）模式的合法 ZIP —— DOCX/XLSX/扩展包输出足够，
 *     且 100% 纯 TS 可实现、可测试（Word/Excel/标准 unzip 均可打开）。
 * 读：解析 EOCD + 中央目录；STORE 条目直接取切片；DEFLATE 条目通过
 *     注入的 inflateRaw 适配器解压（Node: zlib.inflateRawSync；
 *     设备侧走 zlib.UnzipFile 解包目录适配，见 service/ZipSourceFactory.ets）。
 *
 * 除 Utf8 外零 import：Node --experimental-strip-types 与 ArkTS 双端可跑。
 */

import { utf8Decode, utf8Encode } from './Utf8.ts';

export interface ZipEntry {
  name: string;
  data: Uint8Array;
}

/** ZIP 条目只读视图（转换器与扩展包框架依赖的最小接口） */
export interface ZipSource {
  names(): string[];
  read(name: string): Uint8Array | null;
  /** manifest 等小文本便捷方法 */
  readText(name: string): string | null;
}

// ─────────────────────────────────────────────────────
// CRC-32（ZIP 规范）
// ─────────────────────────────────────────────────────

const CRC_TABLE: Uint32Array = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) {
    crc = CRC_TABLE[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

// ─────────────────────────────────────────────────────
// 写：STORE ZIP
// ─────────────────────────────────────────────────────

/** utf-8 编码（全局 TextEncoder 在 ArkTS 不存在，统一走 Utf8） */
function utf8Bytes(text: string): Uint8Array {
  return utf8Encode(text);
}

export class ZipWriter {
  private entries: ZipEntry[] = [];

  add(name: string, data: Uint8Array): void {
    this.entries.push({ name, data });
  }

  addText(name: string, text: string): void {
    this.add(name, utf8Bytes(text));
  }

  /** 产出完整 ZIP 字节流（固定 DOS 时间 1980-01-01，保证确定性） */
  finish(): Uint8Array {
    const parts: Uint8Array[] = [];
    const central: Uint8Array[] = [];
    let offset = 0;

    const push = (arr: Uint8Array) => {
      parts.push(arr);
      offset += arr.length;
    };

    for (const entry of this.entries) {
      const nameBytes = utf8Bytes(entry.name);
      const crc = crc32(entry.data);
      const size = entry.data.length;
      const localOffset = offset;

      const localHead = new Uint8Array(30);
      const ldv = new DataView(localHead.buffer);
      localHead.set([0x50, 0x4b, 0x03, 0x04], 0); // 本地文件头签名
      ldv.setUint16(4, 0x000a, true);  // 需要的解压版本 1.0
      ldv.setUint16(6, 0x0800, true);  // 标志位：UTF-8 文件名
      ldv.setUint16(8, 0, true);       // method: store
      ldv.setUint16(10, 0, true);      // DOS 时间
      ldv.setUint16(12, 0x21, true);   // DOS 日期 1980-01-01（确定性输出）
      ldv.setUint32(14, crc, true);
      ldv.setUint32(18, size, true);
      ldv.setUint32(22, size, true);
      ldv.setUint16(26, nameBytes.length, true);
      ldv.setUint16(28, 0, true);

      const centralHead = new Uint8Array(46);
      const cdv = new DataView(centralHead.buffer);
      centralHead.set([0x50, 0x4b, 0x01, 0x02], 0);
      cdv.setUint16(4, 0x0014, true);  // 打包版本 2.0
      cdv.setUint16(6, 0x000a, true);
      cdv.setUint16(8, 0x0800, true);
      cdv.setUint16(10, 0, true);
      cdv.setUint16(12, 0, true);
      cdv.setUint16(14, 0x21, true);
      cdv.setUint32(16, crc, true);
      cdv.setUint32(20, size, true);
      cdv.setUint32(24, size, true);
      cdv.setUint16(28, nameBytes.length, true);
      cdv.setUint16(42, localOffset, true);

      push(localHead);
      push(nameBytes);
      push(entry.data);
      central.push(centralHead, nameBytes);
    }

    const centralStart = offset;
    for (const c of central) {
      push(c);
    }
    const centralSize = offset - centralStart;

    const eocd = new Uint8Array(22);
    const edv = new DataView(eocd.buffer);
    eocd.set([0x50, 0x4b, 0x05, 0x06], 0);
    edv.setUint16(8, this.entries.length, true);
    edv.setUint16(10, this.entries.length, true);
    edv.setUint32(12, centralSize, true);
    edv.setUint32(16, centralStart, true);
    push(eocd);

    return concat(parts);
  }
}

export function concat(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((s, p) => s + p.length, 0);
  const out = new Uint8Array(total);
  let pos = 0;
  for (const p of parts) {
    out.set(p, pos);
    pos += p.length;
  }
  return out;
}

// ─────────────────────────────────────────────────────
// 读：内存 ZIP（可选 raw-inflate 适配器）
// ─────────────────────────────────────────────────────

export type InflateRawFn = (data: Uint8Array, expectedSize: number) => Uint8Array;

export class MemoryZipSource implements ZipSource {
  private map = new Map<string, Uint8Array>();

  private constructor() {}

  /**
   * 解析 ZIP 字节流。
   * @param inflateRaw DEFLATE(method=8) 条目所需的 raw-inflate 实现；不提供时遇到压缩条目抛错
   */
  static from(bytes: Uint8Array, inflateRaw?: InflateRawFn): MemoryZipSource {
    const src = new MemoryZipSource();
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

    // 从尾部扫描 EOCD
    let eocd = -1;
    for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 65536); i--) {
      if (dv.getUint32(i, true) === 0x06054b50) {
        eocd = i;
        break;
      }
    }
    if (eocd < 0) {
      throw new Error('ZipCodec: 未找到 EOCD（非法 ZIP）');
    }
    const count = dv.getUint16(eocd + 10, true);
    let ptr = dv.getUint32(eocd + 16, true);

    for (let i = 0; i < count; i++) {
      if (dv.getUint32(ptr, true) !== 0x02014b50) {
        throw new Error(`ZipCodec: 中央目录损坏 @${ptr}`);
      }
      const method = dv.getUint16(ptr + 10, true);
      const compSize = dv.getUint32(ptr + 20, true);
      const uncompSize = dv.getUint32(ptr + 24, true);
      const nameLen = dv.getUint16(ptr + 28, true);
      const extraLen = dv.getUint16(ptr + 30, true);
      const commentLen = dv.getUint16(ptr + 32, true);
      const localOffset = dv.getUint32(ptr + 42, true);
      const name = utf8Decode(bytes.subarray(ptr + 46, ptr + 46 + nameLen));

      if (!name.endsWith('/')) {
        // 本地头：名字长度需重新读（防 local 与 central 不一致）
        const localNameLen = dv.getUint16(localOffset + 26, true);
        const localExtraLen = dv.getUint16(localOffset + 28, true);
        const dataStart = localOffset + 30 + localNameLen + localExtraLen;
        const raw = bytes.subarray(dataStart, dataStart + compSize);
        let data: Uint8Array;
        if (method === 0) {
          data = raw.slice();
        } else if (method === 8) {
          if (!inflateRaw) {
            throw new Error(`ZipCodec: 条目 ${name} 为 DEFLATE，需要注入 inflateRaw`);
          }
          data = inflateRaw(raw, uncompSize);
        } else {
          throw new Error(`ZipCodec: 不支持的压缩方法 ${method}`);
        }
        src.map.set(name, data);
      }
      ptr += 46 + nameLen + extraLen + commentLen;
    }
    return src;
  }

  names(): string[] {
    return Array.from(this.map.keys());
  }

  read(name: string): Uint8Array | null {
    return this.map.get(name) ?? null;
  }

  readText(name: string): string | null {
    const data = this.map.get(name);
    return data ? utf8Decode(data) : null;
  }
}

/** 目录展开型 ZipSource（设备侧 zlib.UnzipFile 解包后适配用） */
export class MappedZipSource implements ZipSource {
  private map: Map<string, Uint8Array>;

  constructor(entries: ZipEntry[]) {
    this.map = new Map(entries.map((e) => [e.name, e.data]));
  }

  names(): string[] {
    return Array.from(this.map.keys());
  }

  read(name: string): Uint8Array | null {
    return this.map.get(name) ?? null;
  }

  readText(name: string): string | null {
    const data = this.map.get(name);
    return data ? utf8Decode(data) : null;
  }
}
