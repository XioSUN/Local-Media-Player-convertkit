/**
 * HtmlText — XHTML/HTML → 纯文本（EPUB 章节抽取用，纯逻辑）。
 *
 * 设计取舍：正则级轻量实现（不建 DOM），满足 EPUB 内容 xhtml 的结构化良好输入；
 * 块级标签断行、行内标签剥除、实体解码（命名 + 十进制 + 十六进制）。
 */

const BLOCK_TAGS = '(?:p|div|section|article|h[1-6]|li|ul|ol|table|tr|blockquote|pre|header|footer|title)';

/** 命名实体 → 字符（EPUB 常见集） */
const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  mdash: '—',
  ndash: '–',
  hellip: '…',
  lsquo: '\u2018',
  rsquo: '\u2019',
  ldquo: '\u201C',
  rdquo: '\u201D',
  copy: '©',
  reg: '®',
  trade: '™'
};

export function decodeEntities(s: string): string {
  return s.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (whole: string, body: string): string => {
    if (body.startsWith('#x') || body.startsWith('#X')) {
      const code = parseInt(body.slice(2), 16);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : whole;
    }
    if (body.startsWith('#')) {
      const code = parseInt(body.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : whole;
    }
    const named = NAMED_ENTITIES[body];
    return named !== undefined ? named : whole;
  });
}

/** 提取 <title>（无则取首个 h1-h3 文本） */
export function htmlTitle(html: string): string {
  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  if (title !== null && title[1].trim().length > 0) {
    return decodeEntities(title[1].trim());
  }
  const h = /<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>/i.exec(html);
  if (h !== null) {
    return decodeEntities(h[1].replace(/<[^>]+>/g, '').trim());
  }
  return '';
}

/** XHTML → 纯文本（多段落，\n\n 分段） */
export function htmlToText(html: string): string {
  let s = html;
  // 去声明/注释/head（title 已单独取）
  s = s.replace(/<\?xml[\s\S]*?\?>/gi, '');
  s = s.replace(/<!--[\s\S]*?-->/g, '');
  s = s.replace(/<head[\s\S]*?<\/head>/gi, '');
  // 块级标签 → 换行
  s = s.replace(new RegExp(`</${BLOCK_TAGS}>`, 'gi'), '\n\n');
  s = s.replace(new RegExp(`<${BLOCK_TAGS}[^>]*>`, 'gi'), '');
  s = s.replace(/<br\s*\/?>/gi, '\n');
  // 剩余标签剥除
  s = s.replace(/<[^>]+>/g, '');
  s = decodeEntities(s);
  // 空白归整：行内空白压缩、去行首尾、>2 连空行收敛
  s = s.replace(/[ \t]+/g, ' ');
  const lines = s.split('\n').map((l: string): string => l.trim());
  const out: string[] = [];
  let blanks = 0;
  for (const line of lines) {
    if (line.length === 0) {
      blanks += 1;
      if (blanks <= 1) {
        out.push('');
      }
    } else {
      blanks = 0;
      out.push(line);
    }
  }
  while (out.length > 0 && out[out.length - 1] === '') {
    out.pop();
  }
  let start = 0;
  while (start < out.length && out[start] === '') {
    start += 1;
  }
  return out.slice(start).join('\n');
}
