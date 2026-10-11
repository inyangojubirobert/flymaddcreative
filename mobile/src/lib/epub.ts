import { strFromU8, unzipSync } from 'fflate';

import { bytesToBase64 } from './base64';

// Minimal EPUB reader core: reading order from the OPF spine, one section
// rendered at a time as a self-contained HTML page. Everything that could
// run or fetch is removed (scripts, styles, links, frames, forms, event
// handlers, remote images); images inside the book are inlined as data URIs.
// The page is shown with JavaScript disabled (native WebView) or in a fully
// sandboxed iframe (web), so even a hostile file can't run code.

export type EpubBook = { title: string | null; sections: string[]; bytes: Uint8Array };

const attr = (tag: string, name: string) => {
  const match = new RegExp(`\\s${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, 'i').exec(tag);
  return match ? (match[2] ?? match[3]) : null;
};

const decodeHref = (href: string) => { try { return decodeURIComponent(href); } catch { return href; } };

function resolve(fromFile: string, href: string) {
  const parts = fromFile.split('/').slice(0, -1);
  for (const piece of decodeHref(href.split('#')[0]).split('/')) {
    if (piece === '..') parts.pop();
    else if (piece && piece !== '.') parts.push(piece);
  }
  return parts.join('/');
}

function read(bytes: Uint8Array, names: Set<string>) {
  return unzipSync(bytes, { filter: (f) => names.has(f.name) });
}

export function openEpub(bytes: Uint8Array): EpubBook {
  const head = read(bytes, new Set(['mimetype', 'META-INF/container.xml']));
  if (!head['META-INF/container.xml']) throw new Error('This e-book file is damaged.');
  const opfPath = attr(/<rootfile\b[^>]*>/i.exec(strFromU8(head['META-INF/container.xml']))?.[0] || '', 'full-path');
  if (!opfPath) throw new Error('This e-book file is damaged.');
  const opf = strFromU8(read(bytes, new Set([opfPath]))[opfPath] || new Uint8Array());
  const manifest: Record<string, { href: string; type: string }> = {};
  for (const [tag] of opf.matchAll(/<(?:opf:)?item\b[^>]*>/gi)) {
    const id = attr(tag, 'id');
    const href = attr(tag, 'href');
    if (id && href) manifest[id] = { href: resolve(opfPath, href), type: attr(tag, 'media-type') || '' };
  }
  const sections = [...opf.matchAll(/<(?:opf:)?itemref\b[^>]*>/gi)]
    .map(([tag]) => manifest[attr(tag, 'idref') || ''])
    .filter((item) => item && /x?html/i.test(item.type))
    .map((item) => item.href);
  if (!sections.length) throw new Error('This e-book has no readable sections.');
  const title = /<dc:title[^>]*>([\s\S]*?)<\/dc:title>/i.exec(opf)?.[1]?.replace(/<[^>]+>/g, '').trim() || null;
  return { title, sections, bytes };
}

const IMAGE_TYPES: Record<string, string> = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp' };
const KEEP = new Set(['p', 'br', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'em', 'i', 'b', 'strong', 'u', 's', 'blockquote', 'ul', 'ol', 'li',
  'span', 'div', 'section', 'article', 'aside', 'header', 'footer', 'figure', 'figcaption', 'small', 'sup', 'sub', 'hr', 'pre', 'code',
  'table', 'thead', 'tbody', 'tfoot', 'tr', 'td', 'th', 'caption', 'dl', 'dt', 'dd', 'img', 'cite', 'q', 'abbr', 'mark']);

/** One section as a complete, inert HTML page. */
export function sectionHtml(book: EpubBook, index: number, options: { watermark: string; dark: boolean }) {
  const path = book.sections[index];
  const raw = strFromU8(read(book.bytes, new Set([path]))[path] || new Uint8Array());
  let body = /<body[^>]*>([\s\S]*)<\/body>/i.exec(raw)?.[1] ?? raw;

  // SVG cover pages: keep just the image.
  body = body.replace(/<svg\b[\s\S]*?<\/svg\s*>/gi, (svg) => {
    const image = /<image\b[^>]*>/i.exec(svg)?.[0];
    const href = image ? attr(image, 'xlink:href') || attr(image, 'href') : null;
    return href ? `<img src="${href}">` : '';
  });
  body = body
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(script|style|head|title|iframe|object|embed|form|math|video|audio|noscript|template|button|input|select|textarea)\b[\s\S]*?<\/\1\s*>/gi, '');

  const images = new Map<string, string>();
  const wanted = new Set<string>();
  body.replace(/<img\b[^>]*>/gi, (tag) => { const src = attr(tag, 'src'); if (src && !/^[a-z]+:/i.test(src)) wanted.add(resolve(path, src)); return tag; });
  if (wanted.size) {
    const files = read(book.bytes, wanted);
    for (const [name, data] of Object.entries(files)) {
      const type = IMAGE_TYPES[name.split('.').pop()?.toLowerCase() || ''];
      if (type) images.set(name, `data:${type};base64,${bytesToBase64(data)}`);
    }
  }

  body = body.replace(/<\/?([a-zA-Z][a-zA-Z0-9:-]*)\b[^>]*>/g, (tag, name: string) => {
    const lower = name.toLowerCase();
    if (!KEEP.has(lower)) return '';
    if (tag.startsWith('</')) return `</${lower}>`;
    if (lower === 'img') {
      const src = attr(tag, 'src');
      const data = src && !/^[a-z]+:/i.test(src) ? images.get(resolve(path, src)) : null;
      const alt = (attr(tag, 'alt') || '').replace(/[<>"&]/g, '');
      return data ? `<img src="${data}" alt="${alt}">` : '';
    }
    if (lower === 'td' || lower === 'th') {
      const span = ['colspan', 'rowspan'].map((a) => { const v = attr(tag, a); return v && /^\d{1,2}$/.test(v) ? ` ${a}="${v}"` : ''; }).join('');
      return `<${lower}${span}>`;
    }
    return `<${lower}>`;
  });

  return page(body, options);
}

/** Wraps sanitised body HTML in the reader page (styles + watermark). */
function page(body: string, options: { watermark: string; dark: boolean }) {
  const fg = options.dark ? '#e5e7eb' : '#1f2937';
  const bg = options.dark ? '#0f172a' : '#fffdf8';
  const mark = options.watermark.replace(/[<>&"]/g, '');
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<style>
html,body{margin:0;background:${bg};color:${fg};-webkit-user-select:none;user-select:none}
body{font-family:Georgia,'Times New Roman',serif;font-size:19px;line-height:1.6;padding:20px 20px 64px;max-width:720px;margin:0 auto;word-wrap:break-word}
img{max-width:100%;height:auto;display:block;margin:12px auto}
h1,h2,h3{line-height:1.25}
table{border-collapse:collapse;max-width:100%}td,th{border:1px solid #9ca3af;padding:4px}
pre{white-space:pre-wrap}
.wm{position:fixed;bottom:8px;left:0;right:0;text-align:center;font:12px sans-serif;opacity:.45;pointer-events:none}
</style></head><body>${body}<div class="wm">${mark}</div></body></html>`;
}

/** A preview section from the server (already text-only) as a page. */
export function previewHtml(section: string, dark: boolean) {
  return page(section, { watermark: 'Preview', dark });
}
