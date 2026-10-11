// EPUB checks for digital e-books (server side, at upload registration).
//
// An EPUB is a zip: mimetype "application/epub+zip", META-INF/container.xml
// pointing to the OPF package, whose spine lists the reading order. We check
// it is a real, unprotected EPUB and keep the first sections as a sanitised,
// text-only preview (no scripts, styles, images, links or attributes).
// The full book is rendered by the app's reader from the licensed download.

import { strFromU8, unzipSync } from 'fflate';

export const EPUB_MAX_SECTIONS = 1000;
const PREVIEW_SECTIONS = 10;
const PREVIEW_SECTION_CHARS = 20000;

// Font obfuscation is listed in encryption.xml but is not DRM.
const FONT_OBFUSCATION = ['http://www.idpf.org/2008/embedding', 'http://ns.adobe.com/pdf/enc#RC'];

const attr = (tag, name) => {
  const match = new RegExp(`\\s${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, 'i').exec(tag);
  return match ? (match[2] ?? match[3]) : null;
};

const decodeHref = (href) => { try { return decodeURIComponent(href); } catch { return href; } };

/** Resolves an href relative to a file inside the zip ("OEBPS/text/ch1.xhtml"). */
export function resolveZipPath(fromFile, href) {
  const parts = fromFile.split('/').slice(0, -1);
  for (const piece of decodeHref(href.split('#')[0]).split('/')) {
    if (piece === '..') parts.pop();
    else if (piece && piece !== '.') parts.push(piece);
  }
  return parts.join('/');
}

const SAFE_TEXT_TAGS = new Set(['p', 'br', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'em', 'i', 'b', 'strong', 'u', 'blockquote',
  'ul', 'ol', 'li', 'span', 'div', 'section', 'small', 'sup', 'sub', 'hr', 'pre', 'code', 'table', 'tr', 'td', 'th', 'tbody', 'thead']);

/** Text-only HTML: allowed formatting tags without any attributes; everything else removed. */
export function sanitizePreviewHtml(xhtml) {
  const body = /<body[^>]*>([\s\S]*)<\/body>/i.exec(xhtml)?.[1] ?? xhtml;
  return body
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(script|style|head|title|iframe|object|embed|form|svg|math|video|audio|noscript|template)\b[\s\S]*?<\/\1\s*>/gi, '')
    .replace(/<\/?([a-zA-Z][a-zA-Z0-9:-]*)\b[^>]*>/g, (tag, name) => {
      const lower = name.toLowerCase();
      if (!SAFE_TEXT_TAGS.has(lower)) return '';
      if (lower === 'br' || lower === 'hr') return `<${lower}>`;
      return tag.startsWith('</') ? `</${lower}>` : `<${lower}>`;
    })
    .replace(/<(script|style)\b/gi, '')
    .trim()
    .slice(0, PREVIEW_SECTION_CHARS);
}

/**
 * Checks an EPUB file. Returns { ok: true, sections, title, preview } or
 * { ok: false, reason }.
 */
export function inspectEpub(bytes) {
  let entries;
  try {
    entries = unzipSync(bytes, { filter: (f) => ['mimetype', 'META-INF/container.xml', 'META-INF/encryption.xml'].includes(f.name) });
  } catch {
    return { ok: false, reason: 'This file is not a valid EPUB (not a zip archive)' };
  }
  if (!entries.mimetype || strFromU8(entries.mimetype).trim() !== 'application/epub+zip') {
    return { ok: false, reason: 'This file is not a valid EPUB (missing mimetype)' };
  }
  if (entries['META-INF/encryption.xml']) {
    const algorithms = [...strFromU8(entries['META-INF/encryption.xml']).matchAll(/Algorithm\s*=\s*"([^"]+)"/g)].map((m) => m[1]);
    if (algorithms.some((a) => !FONT_OBFUSCATION.includes(a) && !/xmldsig|xmlenc#(sha|rsa)/i.test(a))) {
      return { ok: false, reason: 'This EPUB is DRM-protected. Upload a DRM-free EPUB you own the rights to.' };
    }
  }
  const container = entries['META-INF/container.xml'] ? strFromU8(entries['META-INF/container.xml']) : '';
  const opfPath = attr(/<rootfile\b[^>]*>/i.exec(container)?.[0] || '', 'full-path');
  if (!opfPath) return { ok: false, reason: 'This EPUB has no package document' };

  const opfEntries = unzipSync(bytes, { filter: (f) => f.name === opfPath });
  if (!opfEntries[opfPath]) return { ok: false, reason: 'This EPUB is missing its package document' };
  const opf = strFromU8(opfEntries[opfPath]);

  const manifest = {};
  for (const [tag] of opf.matchAll(/<(?:opf:)?item\b[^>]*>/gi)) {
    const id = attr(tag, 'id');
    const href = attr(tag, 'href');
    if (id && href) manifest[id] = { href: resolveZipPath(opfPath, href), type: attr(tag, 'media-type') || '' };
  }
  const spine = [...opf.matchAll(/<(?:opf:)?itemref\b[^>]*>/gi)]
    .map(([tag]) => manifest[attr(tag, 'idref')])
    .filter((item) => item && /x?html/i.test(item.type));
  if (!spine.length) return { ok: false, reason: 'This EPUB has no readable sections' };
  if (spine.length > EPUB_MAX_SECTIONS) return { ok: false, reason: `EPUBs can have at most ${EPUB_MAX_SECTIONS} sections` };

  const wanted = new Set(spine.slice(0, PREVIEW_SECTIONS).map((s) => s.href));
  const docs = unzipSync(bytes, { filter: (f) => wanted.has(f.name) });
  const preview = spine.slice(0, PREVIEW_SECTIONS)
    .map((s) => (docs[s.href] ? sanitizePreviewHtml(strFromU8(docs[s.href])) : ''))
    .filter((html) => html.replace(/<[^>]+>/g, '').trim().length > 0);

  const title = /<dc:title[^>]*>([\s\S]*?)<\/dc:title>/i.exec(opf)?.[1]?.replace(/<[^>]+>/g, '').trim() || null;
  return { ok: true, sections: spine.length, title, preview };
}
