/**
 * DocxWriter — 文档模型 → 最小合法 DOCX（纯逻辑，STORE ZIP）
 *
 * 产出文件：
 *  - [Content_Types].xml / _rels/.rels / word/_rels/document.xml.rels
 *  - word/document.xml（段落 + 样式引用 + 加粗/斜体 run）
 *  - word/styles.xml（Normal + Heading1-3 + ListParagraph 最小样式表）
 */

import { ZipWriter, type ZipSource } from '../zip/ZipCodec.ts';
import { MemoryZipSource } from '../zip/ZipCodec.ts';
import type { DocDocument, DocParagraph, ParagraphStyle } from './DocxParser.ts';

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const STYLE_IDS: Record<ParagraphStyle, string | null> = {
  normal: null,
  h1: 'Heading1',
  h2: 'Heading2',
  h3: 'Heading3',
  li: 'ListParagraph'
};

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
</Types>`;

const ROOT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;

const DOC_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`;

function stylesXml(): string {
  const heading = (id: string, name: string, size: number): string =>
    `<w:style w:type="paragraph" w:styleId="${id}"><w:name w:val="${name}"/><w:basedOn w:val="Normal"/>` +
    `<w:pPr><w:keepNext/><w:outlineLvl w:val="${parseInt(id.slice(-1), 10) - 1}"/></w:pPr>` +
    `<w:rPr><w:b/><w:sz w:val="${size}"/></w:rPr></w:style>`;
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:docDefaults><w:rPrDefault><w:rPr><w:sz w:val="22"/></w:rPr></w:rPrDefault></w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>
${heading('Heading1', 'heading 1', 40)}
${heading('Heading2', 'heading 2', 32)}
${heading('Heading3', 'heading 3', 26)}
<w:style w:type="paragraph" w:styleId="ListParagraph"><w:name w:val="List Paragraph"/><w:basedOn w:val="Normal"/><w:pPr><w:ind w:left="720"/></w:pPr></w:style>
</w:styles>`;
}

function documentXml(doc: DocDocument): string {
  const body = doc.paragraphs
    .map((p) => {
      const styleId = STYLE_IDS[p.style];
      const pPr = styleId ? `<w:pPr><w:pStyle w:val="${styleId}"/></w:pPr>` : '';
      const runs = p.runs
        .map((r) => {
          const rPr =
            r.bold || r.italic
              ? `<w:rPr>${r.bold ? '<w:b/>' : ''}${r.italic ? '<w:i/>' : ''}</w:rPr>`
              : '';
          const space = /^\s|\s$/.test(r.text) ? ' xml:space="preserve"' : '';
          return `<w:r>${rPr}<w:t${space}>${esc(r.text)}</w:t></w:r>`;
        })
        .join('');
      return `<w:p>${pPr}${runs}</w:p>`;
    })
    .join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:body>${body}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/></w:sectPr></w:body>
</w:document>`;
}

export class DocxWriter {
  private doc: DocDocument;

  constructor(doc: DocDocument) {
    this.doc = doc;
  }

  build(): Uint8Array {
    const zip = new ZipWriter();
    zip.addText('[Content_Types].xml', CONTENT_TYPES);
    zip.addText('_rels/.rels', ROOT_RELS);
    zip.addText('word/_rels/document.xml.rels', DOC_RELS);
    zip.addText('word/document.xml', documentXml(this.doc));
    zip.addText('word/styles.xml', stylesXml());
    return zip.finish();
  }

  /** 便捷：写出后立即以 ZipSource 形式打开（回读验证/转换链） */
  toSource(): ZipSource {
    return MemoryZipSource.from(this.build());
  }
}
