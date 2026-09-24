import { readdir, readFile, writeFile, mkdir, rm, cp, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const out = path.join(root, 'dist');
const hash = value => createHash('sha256').update(value).digest('hex').slice(0, 24);
const decode = s => s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&#(x[\da-f]+|\d+);/gi, (_, n) => String.fromCodePoint(n[0] === 'x' ? parseInt(n.slice(1), 16) : Number(n)));
const escape = s => s.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
await rm(out, { recursive: true, force: true });
await mkdir(path.join(out, 'media'), { recursive: true });
await mkdir(path.join(out, 'read'), { recursive: true });
await cp(path.join(root, 'site'), out, { recursive: true });
const categories = [], books = [], media = new Set();
const dirs = (await readdir(root, { withFileTypes: true })).filter(d => d.isDirectory() && /^\d{2}-/.test(d.name)).sort((a,b) => a.name.localeCompare(b.name));
for (const dir of dirs) {
  const category = { id: dir.name.slice(0, 2), name: dir.name.slice(3), count: 0 };
  categories.push(category);
  const files = (await readdir(path.join(root, dir.name))).filter(f => f.endsWith('.html')).sort((a,b) => a.localeCompare(b, 'zh-CN'));
  for (const file of files) {
    const source = `${dir.name}/${file}`;
    let html = await readFile(path.join(root, source), 'utf8');
    const id = hash(source), url = `/read/${id}.html`;
    const fullTitle = decode((html.match(/<title>([\s\S]*?)<\/title>/i)?.[1] || file.slice(0,-5)).trim());
    const parts = fullTitle.split(/\s+—+\s+/);
    const title = parts[0];
    let author = parts.slice(1).join(' — ');
    if (author === '微软用户' || file === '马斯克原理.html') author = '';
    const book = { id, title, author, category: category.id, url, source };
    books.push(book); category.count++;
    const writes = [];
    html = html.replace(/data:image\/([\w.+-]+);base64,([A-Za-z0-9+/=\r\n]+)/g, (_, mime, base64) => {
      const data = Buffer.from(base64, 'base64');
      const ext = { jpeg: 'jpg', 'svg+xml': 'svg', 'x-icon': 'ico' }[mime] || mime;
      const name = `${hash(data)}.${ext}`;
      if (!media.has(name)) { media.add(name); writes.push(writeFile(path.join(out, 'media', name), data)); }
      return `/media/${name}`;
    });
    await Promise.all(writes);
    // EPUB exports occasionally retain links to files that no longer exist.
    // Resolve available chapter anchors; keep the text for unresolved references.
    const ids = new Set([...html.matchAll(/\bid=["']([^"']+)["']/g)].map(m => m[1]));
    html = html.replace(/<a\b([^>]*?)\bhref=(["'])([^"']+)\2([^>]*)>/gi, (tag, before, quote, href, after) => {
      if (/^(?:\.\.\/)+index\.html$/.test(href) || href.startsWith('/Users/')) return `<a${before}href="/"${after}>`;
      if (/^(?:https?:|mailto:|\/|#(?!.*#))/.test(href)) return tag;
      const fragment = href.includes('#') ? href.split('#').pop() : '';
      const stem = path.basename(href.split('#')[0]).replace(/\.x?html?$/, '');
      const target = [fragment, stem, `${stem}_xhtml`, `block-${stem}`].find(value => value && ids.has(value));
      if (target) return `<a${before}href="#${escape(target)}"${after}>`;
      return `<a${before}title="请使用本页目录查阅"${after}>`;
    });
    html = html.replace(/<img\b(?![^>]*\bloading=)/gi, '<img loading="lazy" decoding="async"');
    const meta = `<meta name="labook-id" content="${id}"><link rel="icon" href="/favicon.svg"><link rel="canonical" href="https://book.labook.cn${url}"><link rel="stylesheet" href="/reader.css"><script defer src="/reader.js"></script>`;
    html = html.replace(/<\/head>/i, `${meta}</head>`);
    if (/<div class="bar"[^>]*>/.test(html)) {
      html = html.replace(/(<div class="bar"[^>]*>)/, '$1<a class="library-home" href="/" aria-label="返回书房">‹ 书房</a>');
    } else {
      html = html.replace(/(<body[^>]*>)/, '$1<a class="library-home" data-floating="true" href="/" aria-label="返回书房">‹ 返回书房</a>');
    }
    await writeFile(path.join(out, 'read', `${id}.html`), html);
  }
}
const catalog = { categories, books };
await writeFile(path.join(out, 'catalog.json'), JSON.stringify(catalog));
let index = await readFile(path.join(out, 'index.html'), 'utf8');
index = index.replace('<!-- CATALOG_FALLBACK -->', `<noscript><section class="fallback"><h2>全部书籍</h2><p>启用 JavaScript 可使用搜索、分类和收藏，也可直接选择书籍阅读。</p>${books.map(b => `<p><a href="${b.url}">${escape(b.title)}</a></p>`).join('')}</section></noscript>`);
await writeFile(path.join(out, 'index.html'), index);
await writeFile(path.join(out, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>https://book.labook.cn/</loc></url>${books.map(b => `<url><loc>https://book.labook.cn${b.url}</loc></url>`).join('')}</urlset>`);
await writeFile(path.join(out, 'robots.txt'), 'User-agent: *\nAllow: /\nSitemap: https://book.labook.cn/sitemap.xml\n');
const allFiles = await readdir(out, { recursive: true });
let count = 0, largest = 0;
for (const f of allFiles) {
  const info = await stat(path.join(out, f));
  if (!info.isFile()) continue;
  count++; largest = Math.max(largest, info.size);
  if (info.size > 25 * 1024 * 1024) throw new Error(`超过 Cloudflare 25 MiB 限制：${f}`);
}
if (count > 20000) throw new Error(`超过 Cloudflare 免费版 20,000 文件限制：${count}`);
console.log(`构建完成：${books.length} 本书，${categories.length} 个主题，${media.size} 张独立图片，${count} 个文件，最大文件 ${(largest / 1024 / 1024).toFixed(2)} MiB。`);
