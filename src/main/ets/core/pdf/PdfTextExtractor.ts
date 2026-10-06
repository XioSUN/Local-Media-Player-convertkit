/**
 * PdfTextExtractor — PDF 文本抽取（纯逻辑 + 注入的 zlib inflate 适配器）
 *
 * 能力（基础级，覆盖本仓 PdfWriter 产物与多数简单 PDF）：
 *  - 扫描 stream/endstream 内容流；/FlateDecode 通过注入的 inflate（RFC1950）
 *  - 文本算子：Tj / TJ / ' / " ；定位：Td / TD / T* / Tm / TL / Tf
 *  - 字符串：字面量（转义还原、八进制）；hex（FEFF BOM 或含 NUL → UTF-16BE，
 *    否则 latin1）——与本仓 PdfWriter 的两种模式一致
 *  - 输出：每页行列表（x/y/size/text），y 聚类成行、x 间距补空格
 *
 * 已知限制（文档已声明）：无文本的扫描图片、复杂 CID/ToUnicode、旋转矩阵非线性文字
 * 不在 v1 范围。
 */

export type PdfInflate = (data: Uint8Array) => Uint8Array;

export interface PdfLine {
  x: number;
  y: number;
  size: number;
  text: string;
}

export interface PdfPageText {
  width: number;
  height: number;
  lines: PdfLine[];
}

export interface PdfText {
  pages: PdfPageText[];
}

interface Tok {
  type: 'num' | 'str' | 'hex' | 'name' | 'op' | 'arr';
  value?: string | number;
  str?: string;
  arr?: Tok[];
}

// ── 词法 ─────────────────────────────────────────────

function latin1(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i++) {
    s += String.fromCharCode(bytes[i]);
  }
  return s;
}

function unescapeLiteral(raw: string): string {
  let out = '';
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (ch === '\\' && i + 1 < raw.length) {
      const next = raw[i + 1];
      if (next === 'n') { out += '\n'; i++; continue; }
      if (next === 'r') { out += '\r'; i++; continue; }
      if (next === 't') { out += '\t'; i++; continue; }
      if (next === 'b' || next === 'f') { out += ' '; i++; continue; }
      const oct = /^[0-7]{1,3}/.exec(raw.slice(i + 1));
      if (oct) {
        out += String.fromCharCode(parseInt(oct[0], 8));
        i += oct[0].length;
        continue;
      }
      out += next;
      i++;
      continue;
    }
    out += ch;
  }
  return out;
}

function decodeHexString(hex: string): string {
  const clean = hex.replace(/[^0-9a-fA-F]/g, '');
  const bytes = new Uint8Array(Math.floor(clean.length / 2));
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  if (bytes.length === 0) {
    return '';
  }
  const hasBom = bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff;
  let hasNull = false;
  for (let i = 0; i < bytes.length; i += 2) {
    if (bytes[i] === 0) { hasNull = true; break; }
  }
  if ((hasBom || hasNull) && bytes.length % 2 === 0) {
    let s = '';
    for (let i = hasBom ? 2 : 0; i + 1 < bytes.length; i += 2) {
      s += String.fromCharCode((bytes[i] << 8) | bytes[i + 1]);
    }
    return s;
  }
  // 可能是 UTF-16 无 NUL（CJK）：若长度为偶数且解码 latin1 有大量非可打印字符，仍尝试 UTF-16BE
  if (bytes.length % 4 === 0) {
    let printable = 0;
    for (let i = 0; i < bytes.length; i++) {
      const b = bytes[i];
      if (b >= 32 && b < 127) printable++;
    }
    // latin1 可打印比例低 → 视为 UTF-16BE
    if (printable < bytes.length * 0.5) {
      let s = '';
      for (let i = 0; i + 1 < bytes.length; i += 2) {
        s += String.fromCharCode((bytes[i] << 8) | bytes[i + 1]);
      }
      return s;
    }
  }
  return latin1(bytes);
}

function tokenize(content: string): Tok[] {
  const toks: Tok[] = [];
  let i = 0;
  const n = content.length;
  while (i < n) {
    const ch = content[i];
    if (ch === ' ' || ch === '\n' || ch === '\r' || ch === '\t' || ch === '\f' || ch === '\0') {
      i++;
      continue;
    }
    if (ch === '%') {
      while (i < n && content[i] !== '\n') { i++; }
      continue;
    }
    if (ch === '(') {
      // 字面字符串（含嵌套与转义）
      let depth = 1;
      let raw = '';
      i++;
      while (i < n && depth > 0) {
        const c = content[i];
        if (c === '\\') {
          raw += c + (content[i + 1] ?? '');
          i += 2;
          continue;
        }
        if (c === '(') { depth++; }
        if (c === ')') {
          depth--;
          if (depth === 0) { i++; break; }
        }
        raw += c;
        i++;
      }
      toks.push({ type: 'str', str: unescapeLiteral(raw) });
      continue;
    }
    if (ch === '<' && content[i + 1] === '<') {
      toks.push({ type: 'op', value: '<<' });
      i += 2;
      continue;
    }
    if (ch === '>' && content[i + 1] === '>') {
      toks.push({ type: 'op', value: '>>' });
      i += 2;
      continue;
    }
    if (ch === '<') {
      const end = content.indexOf('>', i);
      const hex = content.slice(i + 1, end < 0 ? n : end);
      toks.push({ type: 'hex', str: decodeHexString(hex) });
      i = (end < 0 ? n : end) + 1;
      continue;
    }
    if (ch === '[') {
      // TJ 数组
      const arr: Tok[] = [];
      i++;
      while (i < n && content[i] !== ']') {
        const c = content[i];
        if (c === ' ' || c === '\n' || c === '\r') { i++; continue; }
        if (c === '(') {
          let depth = 1;
          let raw = '';
          i++;
          while (i < n && depth > 0) {
            const cc = content[i];
            if (cc === '\\') { raw += cc + (content[i + 1] ?? ''); i += 2; continue; }
            if (cc === '(') { depth++; }
            if (cc === ')') { depth--; if (depth === 0) { i++; break; } }
            raw += cc;
            i++;
          }
          arr.push({ type: 'str', str: unescapeLiteral(raw) });
          continue;
        }
        if (c === '<' && content[i + 1] !== '<') {
          const end = content.indexOf('>', i);
          arr.push({ type: 'hex', str: decodeHexString(content.slice(i + 1, end < 0 ? n : end)) });
          i = (end < 0 ? n : end) + 1;
          continue;
        }
        const numM = /^-?[\d.]+/.exec(content.slice(i));
        if (numM) {
          arr.push({ type: 'num', value: parseFloat(numM[0]) });
          i += numM[0].length;
          continue;
        }
        i++;
      }
      i++;
      toks.push({ type: 'arr', arr });
      continue;
    }
    if (ch === '/') {
      const m = /^\/([^\s/[\]<>()]*)/.exec(content.slice(i));
      if (m) {
        toks.push({ type: 'name', value: m[1] });
        i += m[0].length;
        continue;
      }
    }
    if (ch === ')' || ch === '>') {
      i++;
      continue;
    }
    const numM = /^-?(?:\d+\.?\d*|\.\d+)/.exec(content.slice(i));
    if (numM && /[-.\d]/.test(ch)) {
      toks.push({ type: 'num', value: parseFloat(numM[0]) });
      i += numM[0].length;
      continue;
    }
    const opM = /^[A-Za-z'"*]+/.exec(content.slice(i));
    if (opM) {
      toks.push({ type: 'op', value: opM[0] });
      i += opM[0].length;
      continue;
    }
    i++;
  }
  return toks;
}

// ── 语义解释 ─────────────────────────────────────────

interface RawLine {
  x: number;
  y: number;
  size: number;
  parts: string[];
  curX: number;
}

function interpret(content: string): { lines: RawLine[]; mediaBox?: number[] } {
  const toks = tokenize(content);
  const lines: RawLine[] = [];
  let operands: number[] = [];
  let size = 11;
  let leading = 0;
  // 文本行矩阵（简化：只关心平移）
  let lx = 0;
  let ly = 0;
  let inText = false;
  let cur: RawLine | null = null;

  const flush = () => {
    if (cur && cur.parts.join('').trim().length > 0) {
      lines.push(cur);
    }
    cur = null;
  };
  const startXLine = (x: number, y: number, text: string) => {
    if (cur && Math.abs(cur.y - y) <= Math.max(0.6, size * 0.35)) {
      // 同行：按 x 间距决定补空格
      const gap = x - cur.curX;
      if (gap > size * 0.6) {
        cur.parts.push(' ');
      }
      cur.parts.push(text);
      cur.curX = x + text.length * size * 0.5;
      cur.x = Math.min(cur.x, x);
    } else {
      flush();
      cur = { x, y, size, parts: [text], curX: x + text.length * size * 0.5 };
    }
  };

  for (let i = 0; i < toks.length; i++) {
    const tok = toks[i];
    if (tok.type === 'num') {
      operands.push(tok.value as number);
      if (operands.length > 6) {
        operands.shift();
      }
      continue;
    }
    if (tok.type === 'op') {
      const op = tok.value as string;
      switch (op) {
        case 'BT':
          inText = true;
          lx = 0; ly = 0;
          break;
        case 'ET':
          flush();
          inText = false;
          break;
        case 'Tf': {
          const s = operands[operands.length - 1];
          if (typeof s === 'number' && s > 0) { size = s; }
          break;
        }
        case 'TL':
          leading = operands[operands.length - 1] ?? 0;
          break;
        case 'Td': {
          const dx = operands[operands.length - 2] ?? 0;
          const dy = operands[operands.length - 1] ?? 0;
          lx += dx; ly += dy;
          break;
        }
        case 'TD': {
          const dx = operands[operands.length - 2] ?? 0;
          const dy = operands[operands.length - 1] ?? 0;
          lx += dx; ly += dy;
          leading = -dy;
          break;
        }
        case 'Tm': {
          const e = operands[operands.length - 2] ?? 0;
          const f = operands[operands.length - 1] ?? 0;
          // 字矩阵 [a b c d e f]：d 分量为缩放；仅当非单位缩放时按 d 近似字号
          const d = operands[operands.length - 3];
          if (typeof d === 'number' && d > 0.01 && d < 200 && Math.abs(d - 1) > 0.01) {
            size = d;
          }
          lx = e; ly = f;
          break;
        }
        case 'T*':
          lx = 0; ly -= leading;
          break;
        case 'Tj':
        case "'":
        case '"': {
          const prev = toks[i - 1];
          const text = prev && (prev.type === 'str' || prev.type === 'hex') ? prev.str ?? '' : '';
          if (op !== 'Tj') { ly -= leading; }
          if (inText) { startXLine(lx, ly, text); }
          break;
        }
        case 'TJ': {
          const prev = toks[i - 1];
          if (prev && prev.type === 'arr' && inText) {
            let text = '';
            for (const t of prev.arr ?? []) {
              if (t.type === 'str' || t.type === 'hex') {
                text += t.str ?? '';
              }
            }
            startXLine(lx, ly, text);
          }
          break;
        }
        case 'BI': {
          // 行内图像：跳到 EI
          while (i < toks.length && toks[i].type === 'op' && toks[i].value !== 'EI') { i++; }
          break;
        }
        default:
          break;
      }
      operands = [];
    }
  }
  flush();
  return { lines };
}

/** 提取 PDF 全部文本（按页） */
export function extractPdfText(bytes: Uint8Array, inflate: PdfInflate): PdfText {
  const content = latin1(bytes);
  const pages: PdfPageText[] = [];

  let idx = 0;
  while (idx < content.length) {
    const streamAt = content.indexOf('stream', idx);
    if (streamAt < 0) {
      break;
    }
    // 找到本 stream 前最近的字典段（含 MediaBox 时使用）
    const dictStart = Math.max(0, streamAt - 1024);
    const dictRegion = content.slice(dictStart, streamAt);
    const mediaM = /MediaBox\s*\[\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\]/.exec(dictRegion);
    let width = 612;
    let height = 792;
    if (mediaM) {
      width = parseFloat(mediaM[3]) - parseFloat(mediaM[1]) || width;
      height = parseFloat(mediaM[4]) - parseFloat(mediaM[2]) || height;
    }

    let dataStart = streamAt + 'stream'.length;
    if (content[dataStart] === '\r') { dataStart++; }
    if (content[dataStart] === '\n') { dataStart++; }
    const endAt = content.indexOf('endstream', dataStart);
    if (endAt < 0) {
      break;
    }
    let raw = bytes.subarray(dataStart, endAt);
    // 去掉可能的尾随 EOL
    while (raw.length > 0 && (raw[raw.length - 1] === 10 || raw[raw.length - 1] === 13)) {
      raw = raw.subarray(0, raw.length - 1);
    }

    const isFlate = /FlateDecode/.test(dictRegion);
    let contentText: string;
    if (isFlate) {
      try {
        contentText = latin1(inflate(raw));
      } catch (e) {
        contentText = ''; // 解压失败跳过该流
      }
    } else {
      contentText = content.slice(dataStart, endAt);
    }

    if (contentText && /Tj|TJ/.test(contentText)) {
      const { lines } = interpret(contentText);
      pages.push({
        width,
        height,
        lines: lines
          .map((l) => ({ x: Math.round(l.x * 10) / 10, y: Math.round(l.y * 10) / 10, size: l.size, text: l.parts.join('') }))
          .sort((a, b) => b.y - a.y || a.x - b.x)
      });
    }

    idx = endAt + 'endstream'.length;
  }
  return { pages };
}

/** 将页面行聚合为表格行（按 y 容差聚类、按 x 间隙切列） */
export function linesToRows(page: PdfPageText, yTolerance?: number): string[][] {
  if (page.lines.length === 0) {
    return [];
  }
  const sizes = page.lines.map((l) => l.size).sort((a, b) => a - b);
  const medianSize = sizes[Math.floor(sizes.length / 2)] || 11;
  const tol = yTolerance ?? Math.max(1.5, medianSize * 0.5);

  const sorted = page.lines.slice().sort((a, b) => b.y - a.y || a.x - b.x);
  const rows: PdfLine[][] = [];
  for (const line of sorted) {
    const last = rows[rows.length - 1];
    if (last && Math.abs(last[0].y - line.y) <= tol) {
      last.push(line);
    } else {
      rows.push([line]);
    }
  }

  return rows.map((row) => {
    const ordered = row.sort((a, b) => a.x - b.x);
    const cells: string[] = [];
    for (let i = 0; i < ordered.length; i++) {
      if (i > 0) {
        const gap = ordered[i].x - (ordered[i - 1].x + ordered[i - 1].text.length * ordered[i - 1].size * 0.5);
        if (gap > ordered[i].size * 1.2) {
          cells.push('\u0001'); // 列分隔标记
        } else if (gap > ordered[i].size * 0.3) {
          cells.push(' ');
        }
      }
      cells.push(ordered[i].text);
    }
    return cells.join('').split('\u0001').map((c) => c.trim());
  });
}
