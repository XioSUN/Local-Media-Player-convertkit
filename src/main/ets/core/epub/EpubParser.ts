/**
 * EpubParser — EPUB（ZIP 容器）→ 章节文本（纯逻辑）。
 *
 * 解析链：META-INF/container.xml → 根 OPF → manifest(id→href) + spine(阅读序)
 * → 逐章 xhtml 抽文本（HtmlText）。兼容 EPUB 2/3 的公共子集。
 */

import { type ZipSource } from '../zip/ZipCodec.ts';
import { htmlToText, htmlTitle } from '../html/HtmlText.ts';

export interface EpubChapter {
  title: string;
  text: string;
}

export interface EpubBook {
  title: string;
  chapters: EpubChapter[];
}

function dirname(path: string): string {
  const i = path.lastIndexOf('/');
  return i > 0 ? path.slice(0, i) : '';
}

/** href 相对 OPF 目录解析 + URL 解码（%20 等） */
function resolveHrefopf(opfDir: string, href: string): string {
  let h = href;
  try {
    h = decodeURIComponent(href);
  } catch (_) {
    h = href;
  }
  if (h.startsWith('/')) {
    return h.slice(1);
  }
  return opfDir.length > 0 ? `${opfDir}/${h}` : h;
}

function attr(tag: string, name: string): string {
  const m = new RegExp(`${name}\\s*=\\s*"([^"]*)"`).exec(tag);
  return m !== null ? m[1] : '';
}

export function parseEpub(source: ZipSource): EpubBook {
  const container = source.readText('META-INF/container.xml');
  if (container === null) {
    throw new Error('parseEpub: 缺少 META-INF/container.xml（不是有效的 EPUB）');
  }
  const rootfileMatch = /<rootfile\s[^>]*>/i.exec(container);
  if (rootfileMatch === null) {
    throw new Error('parseEpub: container.xml 缺少 rootfile');
  }
  const opfPath = attr(rootfileMatch[0], 'full-path');
  if (opfPath.length === 0) {
    throw new Error('parseEpub: container.xml rootfile 缺少 full-path');
  }
  const opf = source.readText(opfPath);
  if (opf === null) {
    throw new Error(`parseEpub: 找不到 OPF（${opfPath}）`);
  }
  const opfDir = dirname(opfPath);

  // 元数据书名
  let title = '';
  const titleMatch = /<dc:title[^>]*>([\s\S]*?)<\/dc:title>/i.exec(opf);
  if (titleMatch !== null) {
    title = titleMatch[1].replace(/<[^>]+>/g, '').trim();
  }

  // manifest：id → href
  const hrefById = new Map<string, string>();
  for (const m of opf.matchAll(/<item\s[^>]*>/gi)) {
    const tag = m[0];
    const id = attr(tag, 'id');
    const href = attr(tag, 'href');
    const mediaType = attr(tag, 'media-type');
    if (id.length > 0 && href.length > 0 && mediaType === 'application/xhtml+xml') {
      hrefById.set(id, href);
    }
  }

  // spine：阅读顺序
  const spine = opf.slice(opf.search(/<spine/i));
  const order: string[] = [];
  for (const m of spine.matchAll(/<itemref\s[^>]*>/gi)) {
    const idref = attr(m[0], 'idref');
    if (idref.length > 0) {
      order.push(idref);
    }
  }
  if (order.length === 0) {
    throw new Error('parseEpub: spine 为空（无可读章节）');
  }

  const chapters: EpubChapter[] = [];
  for (const idref of order) {
    const href = hrefById.get(idref);
    if (href === undefined) {
      continue;
    }
    const html = source.readText(resolveHrefopf(opfDir, href));
    if (html === null) {
      continue;
    }
    const text = htmlToText(html);
    if (text.trim().length === 0) {
      continue; // 封面/版权占位章
    }
    chapters.push({ title: htmlTitle(html), text });
  }
  if (chapters.length === 0) {
    throw new Error('parseEpub: 没有可读章节内容');
  }
  return { title, chapters };
}
