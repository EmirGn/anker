// Allowlist HTML sanitizer for card fields (imported Anki decks contain HTML).
import { markdownLite } from '@anker/core';

const ALLOWED = new Set([
  'b', 'strong', 'i', 'em', 'u', 's', 'br', 'p', 'div', 'span', 'sub', 'sup', 'small', 'big', 'ul', 'ol', 'li',
  'img', 'a', 'code', 'pre', 'ruby', 'rt', 'rp', 'h1', 'h2', 'h3', 'h4', 'blockquote', 'hr', 'table', 'thead',
  'tbody', 'tr', 'td', 'th', 'mark', 'font', 'center',
]);
const SAFE_URL = /^(https?:|data:image\/(png|jpe?g|gif|webp|svg\+xml);|\/|\.\/)/i;
const COLOR = /^(#[0-9a-f]{3,8}|rgba?\([\d\s.,%]+\)|[a-z]+)$/i;

function clean(node: Node, doc: Document): Node | null {
  if (node.nodeType === Node.TEXT_NODE) return doc.createTextNode(node.textContent ?? '');
  if (node.nodeType !== Node.ELEMENT_NODE) return null;
  const el = node as Element;
  const tag = el.tagName.toLowerCase();
  if (tag === 'script' || tag === 'style' || tag === 'iframe' || tag === 'object') return null;
  const kids = [...el.childNodes].map((c) => clean(c, doc)).filter(Boolean) as Node[];
  if (!ALLOWED.has(tag)) {
    const frag = doc.createDocumentFragment();
    kids.forEach((k) => frag.appendChild(k));
    return frag;
  }
  const out = doc.createElement(tag === 'font' ? 'span' : tag === 'center' ? 'div' : tag);
  if (tag === 'img') {
    const src = el.getAttribute('src') ?? '';
    if (!SAFE_URL.test(src)) return null;
    out.setAttribute('src', src);
    out.setAttribute('alt', el.getAttribute('alt') ?? '');
    out.setAttribute('loading', 'lazy');
  }
  if (tag === 'a') {
    const href = el.getAttribute('href') ?? '';
    if (/^https?:/i.test(href)) {
      out.setAttribute('href', href);
      out.setAttribute('target', '_blank');
      out.setAttribute('rel', 'noopener noreferrer');
    }
  }
  const cls = el.getAttribute('class');
  if (cls && /^[\w\s-]+$/.test(cls)) out.setAttribute('class', cls);
  const color = tag === 'font' ? el.getAttribute('color') : /(?:^|;)\s*color:\s*([^;]+)/i.exec(el.getAttribute('style') ?? '')?.[1]?.trim();
  if (color && COLOR.test(color)) (out as HTMLElement).style.color = color;
  if (tag === 'center') (out as HTMLElement).style.textAlign = 'center';
  kids.forEach((k) => out.appendChild(k));
  return out;
}

const cache = new Map<string, string>();

/** Field text (light HTML or **markdown**) → safe HTML string. */
export function renderField(raw: string | undefined | null): string {
  if (!raw) return '';
  const hit = cache.get(raw);
  if (hit !== undefined) return hit;
  const html = /<[a-z][\s\S]*>/i.test(raw) ? raw : markdownLite(raw);
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
  const container = doc.createElement('div');
  [...doc.body.childNodes].forEach((n) => {
    const c = clean(n, doc);
    if (c) container.appendChild(c);
  });
  const out = container.innerHTML;
  if (cache.size > 2000) cache.clear();
  cache.set(raw, out);
  return out;
}
