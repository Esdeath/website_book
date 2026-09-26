import assert from 'node:assert/strict';
import { readFile, readdir, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { parse } from 'parse5';
const attr = (node, name) => node.attrs?.find(a => a.name === name)?.value;
function nodes(node) { return [node, ...(node.childNodes || []).flatMap(nodes)]; }
function inner(html, node) { const loc=node.sourceCodeLocation; return html.slice(loc.startTag.endOffset,loc.endTag.startOffset); }
function plain(node) { return node.nodeName === '#text' ? node.value : (node.childNodes || []).map(plain).join(''); }
const root = fileURLToPath(new URL('../dist/', import.meta.url));
const catalog = JSON.parse(await readFile(path.join(root,'catalog.json'),'utf8'));
assert(catalog.books.length > 0);
assert.equal(new Set(catalog.books.map(b=>b.id)).size,catalog.books.length);
for(const c of catalog.categories)assert.equal(c.count,catalog.books.filter(b=>b.category===c.id).length);
let imageReferences=0, progressiveBooks=0;
async function checkReferences(html) {
  for(const match of html.matchAll(/(?:src|href)=["'](\/[^"'#?]+)["']/g)){
    let file = path.join(root,match[1]);
    if (match[1] === '/') file = path.join(root,'index.html');
    else if (!path.extname(file)) file += '.html';
    await stat(file);
    if(match[1].startsWith('/media/'))imageReferences++;
  }
}
for(const book of catalog.books){
  const html=await readFile(path.join(root,book.url+'.html'),'utf8');
  assert(html.includes(`content="${book.id}"`),`${book.title}: missing reader metadata`);
  assert(html.includes('class="library-home"'),`${book.title}: missing home link`);
  assert(!/(?:src|href)=["']data:image\/[\w.+-]+;base64,/.test(html),`${book.title}: unextracted image`);
  await checkReferences(html);
  if(book.progressive){
    progressiveBooks++;
    const full = await readFile(path.join(root,'full',book.id+'.html'),'utf8');
    const originals = nodes(parse(full,{sourceCodeLocationInfo:true}));
    const initial = nodes(parse(html,{sourceCodeLocationInfo:true}));
    const chapters = initial.filter(n=>attr(n,'data-chapter-url'));
    const originalChapters = originals.filter(n=>(attr(n,'class')||'').split(/\s+/).includes('content-block'));
    const manifestUrl=attr(initial.find(n=>attr(n,'name')==='labook-manifest'),'content');
    const manifest=JSON.parse(await readFile(path.join(root,manifestUrl),'utf8'));
    const searchUrl=attr(initial.find(n=>attr(n,'name')==='labook-search'),'content');
    const search=JSON.parse(await readFile(path.join(root,searchUrl),'utf8'));
    assert.equal(chapters.length,manifest.sections.length);
    for(const original of originalChapters){
      // Every original reading block must survive either as a chapter or inside one.
      assert(manifest.anchors[attr(original,'id')],book.title+': lost original section');
    }
    for(const chapter of chapters){
      const id=attr(chapter,'id');
      const original=originals.find(n=>attr(n,'id')===id);
      assert(original,book.title+': unknown chapter');
      const payload=JSON.parse(await readFile(path.join(root,attr(chapter,'data-chapter-url')),'utf8'));
      assert.equal(payload.html,inner(full,original),book.title+': changed original chapter content');
      if(attr(chapter,'data-chapter-loaded')==='true') assert.equal(inner(html,chapter),payload.html);
      assert.equal(search.find(s=>s.id===id)?.text,plain(original).replace(/\s+/g,' ').trim(),book.title+': incomplete search index');
      for(const descendant of nodes(original)) if(attr(descendant,'id')) assert(manifest.anchors[attr(descendant,'id')],book.title+': missing anchor');
      await checkReferences(payload.html);
    }
    assert(!html.includes('blocks.map(function(block)'),book.title+': eager search index remains');
    assert(Buffer.byteLength(html)<Buffer.byteLength(full),book.title+': initial page did not shrink');
  }
}
const files=await readdir(root,{recursive:true});let count=0;
for(const f of files){const s=await stat(path.join(root,f));if(s.isFile()){count++;assert(s.size<=25*1024*1024,`${f} exceeds 25 MiB`);}}
assert(count<=20000);
console.log(`检查通过：${catalog.books.length} 本书全部可达，${progressiveBooks} 本按章节加载且正文完整，${imageReferences} 个图片引用有效，文件数量和大小符合 Cloudflare Pages 限制。`);
