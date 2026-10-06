/**
 * DocxParser — WordprocessingML（word/document.xml）→ 文档模型（纯逻辑）
 *
 * 支持：段落（w:p）→ 样式（w:pStyle：Heading1-3 / ListParagraph）与
 * 行内 run（w:r → w:t 文本 / w:tab 制表 / w:br 换行 / rPr 加粗斜体）。
 * 实体解码：&amp; &lt; &gt; &quot; &apos; 与十/十六进制数字实体。
 */

export type ParagraphStyle = 'normal' | 'h1' | 'h2' | 'h3' | 'li';

export interface DocRun {
  text: string;
  bold?: boolean;
  italic?: boolean;
}

export interface DocParagraph {
  style: ParagraphStyle;
  runs: DocRun[];
}

export interface DocDocument {
  paragraphs: DocParagraph[];
}

function decodeEntities(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (_m, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_m, d) => String.fromCharCode(parseInt(d, 10)))
    .replace(/&amp;/g, '&');
}

function attr(tag: string, name: string): string {
  const m = new RegExp(`${name}\\s*=\\s*["']([^"']*)["']`).exec(tag);
  return m ? m[1] : '';
}

const STYLE_MAP: Record<string, ParagraphStyle> = {
  Heading1: 'h1',
  Heading2: 'h2',
  Heading3: 'h3',
  ListParagraph: 'li'
};

/** 解析 word/document.xml（XML 字符串 → 模型） */
export function parseDocxXml(xml: string): DocDocument {
  const paragraphs: DocParagraph[] = [];
  const body = /<w:body\b[^>]*>([\s\S]*)<\/w:body>/i.exec(xml)?.[1] ?? xml;

  // 逐段扫描（容忍属性中的 > 以外的常见形态）
  const pRe = /<w:p\b[^>]*\/>|<w:p\b[^>]*>[\s\S]*?<\/w:p>/gi;
  let pm: RegExpExecArray | null;
  while ((pm = pRe.exec(body)) !== null) {
    const pTag = pm[0];
    const para: DocParagraph = { style: 'normal', runs: [] };

    // 样式
    const styleM = /<w:pStyle\b([^>]*)\/?>/.exec(pTag);
    if (styleM) {
      const val = attr(styleM[1], 'w:val');
      para.style = STYLE_MAP[val] ?? 'normal';
    }

    // 逐 run
    const rRe = /<w:r\b[^>]*\/>|<w:r\b[^>]*>[\s\S]*?<\/w:r>/gi;
    let rm: RegExpExecArray | null;
    while ((rm = rRe.exec(pTag)) !== null) {
      const rTag = rm[0];
      const bold = /<w:b\b(?![^>]*w:val="(?:0|false)")/.test(rTag);
      const italic = /<w:i\b(?![^>]*w:val="(?:0|false)")/.test(rTag);

      // run 子元素按文档顺序处理（w:t / w:tab / w:br）
      const childRe = /<w:t\b([^>]*)>([\s\S]*?)<\/w:t>|<w:tab\b[^>]*\/?>|<w:br\b[^>]*\/?>/gi;
      let cm: RegExpExecArray | null;
      while ((cm = childRe.exec(rTag)) !== null) {
        if (cm[0].startsWith('<w:t')) {
          const text = decodeEntities(cm[2] ?? '');
          if (text.length > 0 || /preserve/.test(cm[1] ?? '')) {
            para.runs.push({ text, bold, italic });
          }
        } else if (cm[0].startsWith('<w:tab')) {
          para.runs.push({ text: '\t', bold, italic });
        } else {
          para.runs.push({ text: '\n', bold, italic });
        }
      }
    }

    paragraphs.push(para);
  }
  return { paragraphs };
}

/** 模型 → 纯文本（预览用） */
export function docToPlainText(doc: DocDocument): string {
  return doc.paragraphs
    .map((p) => p.runs.map((r) => r.text).join(''))
    .join('\n');
}
