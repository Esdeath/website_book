import { parse } from 'parse5';
import { createHash } from 'node:crypto';

const attr = (node, name) => node.attrs?.find(a => a.name === name)?.value;
const children = node => node.childNodes || [];
const text = node => node.nodeName === '#text' ? node.value : children(node).map(text).join('');
const escape = s => s.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function walk(node, visit) { visit(node); for (const child of children(node)) walk(child, visit); }

// Keep original source slices, including EPUB formatting and anchors. Only replace
// the inner content of top-level reading sections, never nested sections or tables.
export function splitBook(html, bookId) {
  if (!html.includes('blocks.map(function(block)')) return null;
  const tree = parse(html, { sourceCodeLocationInfo: true });
  const blocks = [];
  let unsupported = false;
  function collect(node) {
    if ((attr(node, 'class') || '').split(/\s+/).includes('content-block')) {
      const loc = node.sourceCodeLocation;
      if (!loc?.startTag || !loc?.endTag || !attr(node, 'id')) { unsupported = true; return; }
      blocks.push(node);
      return;
    }
    for (const child of children(node)) collect(child);
  }
  collect(tree);
  if (!blocks.length || unsupported) return null;
  const assets = new Map();
  const asset = (prefix, value) => {
    const data = JSON.stringify(value);
    const hash = createHash('sha256').update(data).digest('hex').slice(0,24);
    const url = `/fragments/${prefix}-${hash}.json`;
    assets.set(url, data);
    return url;
  };
  const anchors = Object.create(null), search = [], replacements = [], sections = [];
  let initialBytes = 0;
  blocks.forEach((node, i) => {
    const loc = node.sourceCodeLocation;
    const id = attr(node, 'id');
    const content = html.slice(loc.startTag.endOffset, loc.endTag.startOffset);
    const headings = [];
    walk(node, n => {
      const anchor = attr(n, 'id');
      if (anchor && anchors[anchor] === undefined) anchors[anchor] = id;
      if (/^h[234]$/.test(n.tagName)) headings.push(n);
    });
    const title = text(headings[0] || {childNodes:[]}).trim() || attr(node, 'data-title') || `正文 ${i + 1}`;
    const plain = text(node).replace(/\s+/g, ' ').trim();
    const url = asset('chapter', { html: content });
    search.push({ id, title, text: plain });
    sections.push({ id, url });
    const eager = i < 2 && initialBytes + Buffer.byteLength(content) <= 24 * 1024;
    if (eager) initialBytes += Buffer.byteLength(content);
    let start = html.slice(loc.startOffset, loc.startTag.endOffset - 1);
    const height = Math.max(300, Math.min(100000, Math.ceil(plain.length / 35) * 34));
    const style = loc.attrs?.style;
    if (style) start = start.slice(0, style.startOffset - loc.startOffset) + start.slice(style.endOffset - loc.startOffset);
    const sizing = `${attr(node, 'style') || ''};--chapter-estimate:${height}px`;
    const inside = eager ? content : `<div class="chapter-placeholder"><p>${escape(title)}</p><button type="button" data-load-chapter>加载本章</button><span class="chapter-message" role="status"></span></div>`;
    const replacement = `${start} data-chapter-url="${url}" data-chapter-loaded="${eager}" style="${escape(sizing)}">${inside}${html.slice(loc.endTag.startOffset, loc.endOffset)}`;
    replacements.push({start:loc.startOffset,end:loc.endOffset,value:replacement});
  });
  const searchUrl = asset('search', search);
  const manifestUrl = asset('index', { anchors, sections });
  for (const edit of replacements.reverse()) html = html.slice(0, edit.start) + edit.value + html.slice(edit.end);
  const storage = html.match(/localStorage\.getItem\("([^"\n]+)"\+k\)/)?.[1] || `labook:${bookId}:`;
  html = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, script => script.includes('blocks.map(function(block)') ? '' : script);
  html = html.replace('</head>', `<meta name="labook-progressive" content="true"><meta name="labook-storage" content="${escape(storage)}"><meta name="labook-manifest" content="${manifestUrl}"><meta name="labook-search" content="${searchUrl}"></head>`);
  html = html.replace(/(<body\b[^>]*>)/i, `$1<noscript><p class="reader-fallback">章节阅读需要 JavaScript。<a href="/full/${bookId}">打开完整书籍</a></p></noscript>`);
  return { html, assets, sections, searchUrl, manifestUrl };
}
