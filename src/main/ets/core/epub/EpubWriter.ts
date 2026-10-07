/**
 * EpubWriter — 章节文本 → 最小合法 EPUB 2.0.1（纯逻辑，STORE ZIP）。
 *
 * 产出：mimetype（首条、不压缩）/ META-INF/container.xml / OEBPS/content.opf /
 * OEBPS/toc.ncx / OEBPS/chapN.xhtml。
 * 确定性输出：bookid 由书名哈希派生，章节文件名按序号——round-trip 测试友好。
 */

import { ZipWriter } from '../zip/ZipCodec.ts';
import { type EpubBook } from './EpubParser.ts';

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** 书名 → 稳定伪 UUID（确定性，避免测试输出抖动） */
function stableUuid(title: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x1000193;
  for (let i = 0; i < title.length; i++) {
    h1 = ((h1 ^ title.charCodeAt(i)) * 0x01000193) >>> 0;
    h2 = ((h2 + title.charCodeAt(i) * 31) ^ (h2 << 5)) >>> 0;
  }
  const hex = (n: number, width: number): string => n.toString(16).padStart(width, '0');
  return `${hex(h1, 8)}-${hex(h2 & 0xffff, 4)}-${hex((h1 >>> 8) & 0xffff, 4)}-${hex(h2 & 0xffff, 4)}-${hex(h1 ^ h2, 12).slice(0, 12)}`;
}

function chapterXhtml(title: string, text: string): string {
  const paras = text
    .split('\n')
    .map((l: string): string => l.trim())
    .filter((l: string): boolean => l.length > 0)
    .map((l: string): string => `    <p>${esc(l)}</p>`)
    .join('\n');
  const heading = title.length > 0 ? `    <h2>${esc(title)}</h2>\n` : '';
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.1//EN" "http://www.w3.org/TR/xhtml11/DTD/xhtml11.dtd">
<html xmlns="http://www.w3.org/1999/xhtml">
  <head>
    <title>${esc(title.length > 0 ? title : 'Chapter')}</title>
  </head>
  <body>
${heading}${paras}
  </body>
</html>
`;
}

export function writeEpub(book: EpubBook): Uint8Array {
  const zip = new ZipWriter();
  const title = book.title.length > 0 ? book.title : 'Unnamed';
  const uuid = stableUuid(title);
  const n = book.chapters.length;

  // EPUB 规范：mimetype 必须为首条目且不压缩（STORE 满足）
  zip.addText('mimetype', 'application/epub+zip');
  zip.addText(
    'META-INF/container.xml',
    `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>
`
  );

  const manifestItems: string[] = ['    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>'];
  const spineRefs: string[] = [];
  const navPoints: string[] = [];
  for (let i = 0; i < n; i++) {
    const id = `c${i + 1}`;
    const ch = book.chapters[i];
    manifestItems.push(`    <item id="${id}" href="chap${i + 1}.xhtml" media-type="application/xhtml+xml"/>`);
    spineRefs.push(`    <itemref idref="${id}"/>`);
    const label = ch.title.length > 0 ? ch.title : `第 ${i + 1} 章`;
    navPoints.push(`    <navPoint id="nav${i + 1}" playOrder="${i + 1}">
      <navLabel><text>${esc(label)}</text></navLabel>
      <content src="chap${i + 1}.xhtml"/>
    </navPoint>`);
    zip.addText(`OEBPS/chap${i + 1}.xhtml`, chapterXhtml(ch.title, ch.text));
  }

  zip.addText(
    'OEBPS/content.opf',
    `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" unique-identifier="bookid" version="2.0.1">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:opf="http://www.idpf.org/2007/opf">
    <dc:title>${esc(title)}</dc:title>
    <dc:language>zh</dc:language>
    <dc:identifier id="bookid">urn:uuid:${uuid}</dc:identifier>
  </metadata>
  <manifest>
${manifestItems.join('\n')}
  </manifest>
  <spine toc="ncx">
${spineRefs.join('\n')}
  </spine>
</package>
`
  );

  zip.addText(
    'OEBPS/toc.ncx',
    `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE ncx PUBLIC "-//NISO//DTD ncx 2005-1//EN" "http://www.daisy.org/z3986/2005/ncx-2005-1.dtd">
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
  <head>
    <meta name="dtb:uid" content="urn:uuid:${uuid}"/>
  </head>
  <docTitle><text>${esc(title)}</text></docTitle>
  <navMap>
${navPoints.join('\n')}
  </navMap>
</ncx>
`
  );

  return zip.finish();
}
