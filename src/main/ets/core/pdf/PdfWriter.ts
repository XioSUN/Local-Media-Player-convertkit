/**
 * PdfWriter — 文档模型 → 最小合法 PDF 1.4（纯逻辑，base14/CJK 字体引用）
 *
 * 特性：
 *  - A4/Letter 页面、边距、标题层级（h1-h3 加粗大字）、列表缩进、自动换行、自动分页
 *  - 纯 ASCII 文本：Helvetica / Helvetica-Bold（WinAnsi）
 *  - 含非 ASCII（中文等）：Type0 引用 /STSong-Light + /UniGB-UCS2-H 预定义 CMap，
 *    文本以 UTF-16BE hex 写出（带 FEFF BOM）。说明：不内嵌字体，依赖查看器
 *    的亚洲字体包（Acrobat/Foxit/WPS 均可）；如需像素级保真应内嵌字体子集（v2）。
 *  - 确定性输出（固定 /CreationDate），便于 round-trip 测试。
 */

export interface PdfWriteOptions {
  pageSize?: 'A4' | 'Letter';
  /** 边距（pt），默认 56 */
  marginPt?: number;
}

export type PdfTextStyle = 'normal' | 'h1' | 'h2' | 'h3' | 'li';

interface TextOp {
  font: 'F1' | 'F2';
  size: number;
  x: number;
  y: number;
  text: string;
}

interface PendingPage {
  ops: TextOp[];
}

interface Line {
  text: string;
  size: number;
  font: 'F1' | 'F2';
  indent: number;
}

const PAGE_SIZES: Record<'A4' | 'Letter', [number, number]> = {
  A4: [595, 842],
  Letter: [612, 792]
};

const STYLE_METRICS: Record<PdfTextStyle, { size: number; lineHeight: number; bold: boolean; indent: number }> = {
  normal: { size: 11, lineHeight: 16, bold: false, indent: 0 },
  h1: { size: 20, lineHeight: 28, bold: true, indent: 0 },
  h2: { size: 16, lineHeight: 23, bold: true, indent: 0 },
  h3: { size: 13, lineHeight: 19, bold: true, indent: 0 },
  li: { size: 11, lineHeight: 16, bold: false, indent: 18 }
};

function latin1Bytes(text: string): Uint8Array {
  const out = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) {
    out[i] = text.charCodeAt(i) & 0xff;
  }
  return out;
}

function utf16Hex(text: string): string {
  let hex = '';
  for (const unit of text) {
    // 展开代理对：codePointAt 保证完整码点；PDF hex 按 16 位单元
    const cp = unit.codePointAt(0) ?? 0;
    if (cp > 0xffff) {
      const v = cp - 0x10000;
      const hi = 0xd800 + (v >> 10);
      const lo = 0xdc00 + (v & 0x3ff);
      hex += hi.toString(16).padStart(4, '0') + lo.toString(16).padStart(4, '0');
    } else {
      hex += cp.toString(16).padStart(4, '0');
    }
  }
  return hex.toUpperCase();
}

export class PdfWriter {
  private opts: Required<PdfWriteOptions>;
  private pages: PendingPage[] = [];
  private current: PendingPage;
  private cursorY: number;
  private hasNonAscii: boolean = false;

  constructor(options?: PdfWriteOptions) {
    this.opts = {
      pageSize: options?.pageSize ?? 'A4',
      marginPt: options?.marginPt ?? 56
    };
    const [, pageH] = PAGE_SIZES[this.opts.pageSize];
    this.current = { ops: [] };
    this.pages.push(this.current);
    this.cursorY = pageH - this.opts.marginPt;
  }

  /** 估算文本宽度（pt）：ASCII≈0.5em、CJK/非拉丁≈1em */
  static textWidth(text: string, size: number): number {
    let units = 0;
    for (const ch of text) {
      units += ch.charCodeAt(0) > 0x7f ? 1.0 : 0.5;
    }
    return units * size;
  }

  /** 追加段落（自动换行 + 自动分页） */
  addParagraph(text: string, style: PdfTextStyle = 'normal'): void {
    const m = STYLE_METRICS[style];
    const [, pageH] = PAGE_SIZES[this.opts.pageSize];
    const contentWidth = PAGE_SIZES[this.opts.pageSize][0] - this.opts.marginPt * 2 - m.indent;
    const clean = text.replace(/\r\n?/g, '\n');

    for (const rawLine of clean.split('\n')) {
      if (rawLine === '') {
        this.advance(m.lineHeight);
        continue;
      }
      // 按宽度贪心折行（lookbehind 正则在 ArkTS 正则引擎不可靠，手写按空格分词）
      let line = '';
      let lineWidth = 0;
      const flush = () => {
        if (line.length > 0) {
          this.emitLine(line, m);
          line = '';
          lineWidth = 0;
        }
      };
      const tokens = PdfWriter.splitOnSpaces(rawLine);
      for (const word of tokens) {
        const w = PdfWriter.textWidth(word, m.size);
        if (lineWidth + w > contentWidth && line.length > 0) {
          flush();
        }
        if (w > contentWidth) {
          // 单词超宽：逐字硬折
          for (const ch of word) {
            const cw = PdfWriter.textWidth(ch, m.size);
            if (lineWidth + cw > contentWidth) {
              flush();
            }
            line += ch;
            lineWidth += cw;
          }
        } else {
          line += word;
          lineWidth += w;
        }
      }
      flush();
      // 段后间距
      this.advance(style.startsWith('h') ? 6 : 4);
      if (this.cursorY < this.opts.marginPt) {
        this.newPage(pageH);
      }
    }
  }

  /** 按空格切分为词与空格片段（保留空格计入宽度，与旧正则行为一致） */
  private static splitOnSpaces(line: string): string[] {
    const tokens: string[] = [];
    let cur = '';
    for (const ch of line) {
      if (ch === ' ') {
        if (cur.length > 0) {
          tokens.push(cur);
          cur = '';
        }
        tokens.push(' ');
      } else {
        cur += ch;
      }
    }
    if (cur.length > 0) {
      tokens.push(cur);
    }
    return tokens;
  }

  private advance(dy: number): void {
    this.cursorY -= dy;
    if (this.cursorY < this.opts.marginPt) {
      this.newPage(PAGE_SIZES[this.opts.pageSize][1]);
    }
  }

  private newPage(pageH: number): void {
    this.current = { ops: [] };
    this.pages.push(this.current);
    this.cursorY = pageH - this.opts.marginPt;
  }

  private emitLine(text: string, m: (typeof STYLE_METRICS)[PdfTextStyle]): void {
    for (const ch of text) {
      if (ch.charCodeAt(0) > 0x7f) {
        this.hasNonAscii = true;
      }
    }
    const x = this.opts.marginPt + m.indent;
    this.current.ops.push({
      font: m.bold ? 'F2' : 'F1',
      size: m.size,
      x,
      y: this.cursorY, // PDF 坐标（自页面底部起算）
      text
    });
    this.cursorY -= m.lineHeight;
    if (this.cursorY < this.opts.marginPt) {
      this.newPage(PAGE_SIZES[this.opts.pageSize][1]);
    }
  }

  /** 组装 PDF 字节流 */
  build(): Uint8Array {
    const encoding = this.hasNonAscii ? 'cjk' : 'winansi';
    const [w, h] = PAGE_SIZES[this.opts.pageSize];

    const objects: string[] = [];
    // 对象编号：1 Catalog、2 Pages、3.. 字体组、其后每页 2 个（页 + 内容流）
    const pageCount = this.pages.length;
    let fontEnd: number;
    let fontRefs: string;
    if (encoding === 'winansi') {
      objects[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>';
      objects[4] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>';
      fontEnd = 4;
      fontRefs = '/F1 3 0 R /F2 4 0 R';
    } else {
      // Type0 字体引用（不内嵌字体文件，依赖查看器亚洲字体包）
      objects[3] = '<< /Type /Font /Subtype /Type0 /BaseFont /STSong-Light /Encoding /UniGB-UCS2-H /DescendantFonts [4 0 R] >>';
      objects[4] = '<< /Type /Font /Subtype /CIDFontType0 /BaseFont /STSong-Light /CIDSystemInfo << /Registry (Adobe) /Ordering (GB1) /Supplement 4 >> /FontDescriptor 5 0 R /DW 1000 >>';
      objects[5] = '<< /Type /FontDescriptor /FontName /STSong-Light /Flags 4 /FontBBox [-25 0 1000 880] /ItalicAngle 0 /Ascent 880 /Descent -120 /CapHeight 880 /StemV 80 >>';
      fontEnd = 5;
      fontRefs = '/F1 3 0 R /F2 3 0 R';
    }

    const pageObjIds: number[] = [];
    for (let i = 0; i < pageCount; i++) {
      pageObjIds.push(fontEnd + 1 + i * 2);
    }
    objects[1] = '<< /Type /Catalog /Pages 2 0 R >>';
    objects[2] = `<< /Type /Pages /Kids [${pageObjIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pageCount} >>`;

    // 内容流序列化：winansi → 字面字符串；cjk → UTF-16BE hex（含 FEFF BOM）
    const serializeOp = (op: TextOp): string => {
      const head = `BT /${op.font} ${op.size} Tf 1 0 0 1 ${fmt(op.x)} ${fmt(op.y)} Tm `;
      const tail = ' Tj ET';
      if (encoding === 'cjk') {
        return `${head}<${utf16Hex('\uFEFF' + op.text)}>${tail}`;
      }
      return `${head}${escapePdfText(op.text)}${tail}`;
    };
    const contentOf = (page: PendingPage): string => page.ops.map(serializeOp).join('\n');

    for (let i = 0; i < pageCount; i++) {
      const pageId = pageObjIds[i];
      const contentId = pageId + 1;
      const content = contentOf(this.pages[i]);
      objects[pageId] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${w} ${h}] /Resources << /Font << ${fontRefs} >> >> /Contents ${contentId} 0 R >>`;
      objects[contentId] = `<< /Length ${latin1Bytes(content).length} >>\nstream\n${content}\nendstream`;
    }

    // 组装字节 + xref
    const chunks: Uint8Array[] = [];
    let offset = 0;
    const offsets: number[] = new Array(objects.length);
    const push = (s: string) => {
      const b = latin1Bytes(s);
      chunks.push(b);
      offset += b.length;
    };
    push('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');
    for (let id = 1; id < objects.length; id++) {
      offsets[id] = offset;
      push(`${id} 0 obj\n${objects[id]}\nendobj\n`);
    }
    const xrefStart = offset;
    let xref = `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
    for (let id = 1; id < objects.length; id++) {
      xref += `${String(offsets[id]).padStart(10, '0')} 00000 n \n`;
    }
    xref += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`;
    push(xref);

    const total = chunks.reduce((s, c) => s + c.length, 0);
    const out = new Uint8Array(total);
    let pos = 0;
    for (const c of chunks) {
      out.set(c, pos);
      pos += c.length;
    }
    return out;
  }
}

/** 数字格式化（PDF 输出精度 2 位） */
function fmt(n: number): string {
  return (Math.round(n * 100) / 100).toString();
}

/** 转义 PDF 字面字符串（winansi 路径）；非 ASCII 以 \ooo 八进制容错 */
function escapePdfText(text: string): string {
  let out = '(';
  for (const ch of text) {
    const code = ch.charCodeAt(0);
    if (ch === '\\' || ch === '(' || ch === ')') {
      out += '\\' + ch;
    } else if (ch === '\n') {
      out += '\\n';
    } else if (ch === '\r') {
      out += '\\r';
    } else if (ch === '\t') {
      out += '\\t';
    } else if (code < 32 || code === 127) {
      out += '\\' + code.toString(8).padStart(3, '0');
    } else if (code < 128) {
      out += ch;
    } else {
      out += '\\' + code.toString(8).padStart(3, '0');
    }
  }
  return out + ')';
}
