import assert from 'node:assert/strict';
import { readFile, readdir, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root = fileURLToPath(new URL('../dist/', import.meta.url));
const catalog = JSON.parse(await readFile(path.join(root,'catalog.json'),'utf8'));
assert(catalog.books.length > 0);
assert.equal(new Set(catalog.books.map(b=>b.id)).size,catalog.books.length);
for(const c of catalog.categories)assert.equal(c.count,catalog.books.filter(b=>b.category===c.id).length);
let imageReferences=0;
for(const book of catalog.books){
  const html=await readFile(path.join(root,book.url),'utf8');
  assert(html.includes(`content="${book.id}"`),`${book.title}: missing reader metadata`);
  assert(html.includes('class="library-home"'),`${book.title}: missing home link`);
  assert(!/(?:src|href)=["']data:image\/[\w.+-]+;base64,/.test(html),`${book.title}: unextracted image`);
  for(const match of html.matchAll(/(?:src|href)=["'](\/[^"'#?]+)["']/g)){
    await stat(path.join(root,match[1]));
    if(match[1].startsWith('/media/'))imageReferences++;
  }
}
const files=await readdir(root,{recursive:true});let count=0;
for(const f of files){const s=await stat(path.join(root,f));if(s.isFile()){count++;assert(s.size<=25*1024*1024,`${f} exceeds 25 MiB`);}}
assert(count<=20000);
console.log(`检查通过：${catalog.books.length} 本书全部可达，${imageReferences} 个图片引用有效，文件数量和大小符合 Cloudflare Pages 限制。`);
