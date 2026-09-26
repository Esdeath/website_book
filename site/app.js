'use strict';
const $ = s => document.querySelector(s);
const esc = s => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const read = (key, fallback) => { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } };
let saved = read('labook:favorites', []);
let favorites = new Set(Array.isArray(saved) ? saved.filter(x => typeof x === 'string') : []);
const params = new URLSearchParams(location.search);
let category = params.get('category') || 'all', view = ['all','favorites','recent'].includes(params.get('view')) ? params.get('view') : 'all';
let query = params.get('q') || '', sort = ['category','title','author'].includes(params.get('sort')) ? params.get('sort') : 'category';
let catalog, toastTimer;
const palettes = [['#4d526e','#ffffff'],['#c8d5d0','#314a43'],['#ddceac','#514a39'],['#767396','#ffffff'],['#bccbe0','#304363'],['#d7bfd0','#65465a'],['#a5b6ba','#263f48']];
const recent = () => { const value = read('labook:recent', []); return Array.isArray(value) ? value.filter(x => x && typeof x.id === 'string') : []; };
function toast(message) { $('#toast').textContent = message; $('#toast').hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => $('#toast').hidden = true, 2400); }
function updateURL() { const p = new URLSearchParams(); if(category !== 'all')p.set('category', category); if(view !== 'all')p.set('view', view); if(query)p.set('q', query); if(sort !== 'category')p.set('sort', sort); history.replaceState(null, '', `${location.pathname}${p.size ? '?' + p : ''}${location.hash}`); }
function render() {
  const cats = catalog.categories;
  const recentBooks = recent();
  const recentIds = recentBooks.map(b => b.id);
  const filtered = catalog.books.filter(b => (category === 'all' || b.category === category) && (view === 'all' || (view === 'favorites' ? favorites.has(b.id) : recentIds.includes(b.id))) && `${b.title} ${b.author}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  if(view === 'recent' && sort === 'category')filtered.sort((a,b) => recentIds.indexOf(a.id)-recentIds.indexOf(b.id));
  else if(sort !== 'category')filtered.sort((a,b) => a[sort].localeCompare(b[sort], 'zh-CN'));
  $('#categories').innerHTML = [{id:'all', name:'全部主题', count:catalog.books.length},...cats].map(c => `<button class="category-button ${category === c.id ? 'active' : ''}" data-category="${c.id}" aria-pressed="${category === c.id}"><span>${esc(c.name)}</span><span>${c.count}</span></button>`).join('');
  $('#category-total').textContent = `${cats.length} 个`;
  $('#favorites-count').textContent = catalog.books.filter(b => favorites.has(b.id)).length;
  document.querySelectorAll('[data-view]').forEach(el => {el.classList.toggle('active',el.dataset.view === view);el.setAttribute('aria-pressed',el.dataset.view === view);});
  const label = cats.find(c => c.id === category)?.name || '全部藏书';
  $('#library-title').firstChild.textContent = `${view === 'favorites' ? '我的收藏' : view === 'recent' ? '最近阅读' : label} `;
  $('#result-count').textContent = `${filtered.length} 本`;
  $('#view-description').textContent = view === 'favorites' ? '留住那些想读、值得重读的书' : view === 'recent' ? '接着上一次，继续往下读' : '让好思想，成为日常的一部分';
  $('#filter-label').textContent = query.trim() ? `“${query.trim()}” 找到 ${filtered.length} 本书` : category !== 'all' && view !== 'all' ? `${label} · ${filtered.length} 本` : `${filtered.length} 本书，随时翻开阅读`;
  $('#books').innerHTML = filtered.map(b => {
    const cat = cats.find(c => c.id === b.category), [bg, ink] = palettes[catalog.books.indexOf(b) % palettes.length];
    return `<article class="book-card"><a class="book-link" href="${b.url}" aria-label="阅读《${esc(b.title)}》"><div class="cover-wrap" aria-hidden="true"><div class="book-cover" style="--cover:${bg};--cover-ink:${ink}"><span class="cover-category">${esc(cat.name)}</span><span class="cover-title">${esc(b.title)}</span><span class="cover-mark">Labook 藏书</span></div></div><h3>${esc(b.title)}</h3></a><p class="book-author" title="${esc(b.author)}">${esc(b.author || '作者信息未收录')}</p><span class="book-tag">${esc(cat.name)}</span><button class="favorite" data-favorite="${b.id}" aria-pressed="${favorites.has(b.id)}" aria-label="${favorites.has(b.id)?'取消收藏':'收藏'}《${esc(b.title)}》"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3h12v18l-6-4-6 4z"/></svg></button></article>`;
  }).join('');
  $('#empty').hidden = filtered.length > 0;
  $('#empty-title').textContent = query || category !== 'all' ? '没有找到这本书' : view === 'favorites' ? '把想读的书，放在这里' : '你的阅读，从这里开始';
  $('#empty-description').textContent = query || category !== 'all' ? '试试其他关键词，或切换阅读主题。' : view === 'favorites' ? '点击书名旁的书签图标，即可加入收藏。收藏保存在当前浏览器。' : '打开任意一本书后，就可以在这里找回它。阅读记录保存在当前浏览器。';
  const last = recentBooks.map(r => ({ ...r, book:catalog.books.find(b => b.id === r.id) })).find(r => r.book);
  $('#continue').hidden = !last;
  if(last)$('#continue').innerHTML = `<div><small>接着上次读</small><strong>${esc(last.book.title)}</strong></div><a href="${last.book.url}">继续阅读 ↗</a>`;
  updateURL();
}
async function init() {
  try { const response = await fetch('/catalog.json'); if(!response.ok)throw new Error('catalog unavailable'); catalog = await response.json();
    if(!catalog.categories.some(c => c.id === category))category = 'all';
    $('#search').value = query; $('#sort').value = sort; render();
    $('#categories').addEventListener('click',e => {const button=e.target.closest('[data-category]');if(button){category=button.dataset.category;render();}});
    document.querySelectorAll('[data-view]').forEach(el => el.addEventListener('click',()=>{view=el.dataset.view;category='all';render();$('#library').scrollIntoView();}));
    $('#search').addEventListener('input',e=>{query=e.target.value;render();});
    $('#sort').addEventListener('change',e=>{sort=e.target.value;render();});
    $('#reset').addEventListener('click',()=>{category='all';view='all';query='';$('#search').value='';render();});
    $('#books').addEventListener('click',e=>{const button=e.target.closest('[data-favorite]');if(!button)return;const id=button.dataset.favorite;favorites.has(id)?favorites.delete(id):favorites.add(id);try{localStorage.setItem('labook:favorites',JSON.stringify([...favorites]));toast(favorites.has(id)?'已加入收藏':'已取消收藏');}catch{toast('浏览器无法保存收藏，本次页面内仍可使用');}render();});
    window.addEventListener('pageshow',()=>render());
    window.addEventListener('storage',()=>{const value=read('labook:favorites',[]);favorites=new Set(Array.isArray(value)?value:[]);render();});
  } catch(error) { $('#load-error').hidden=false;$('#filter-label').textContent='加载失败';console.error(error); }
}
document.addEventListener('keydown',e=>{if(e.key==='/'&&!['INPUT','TEXTAREA','SELECT'].includes(document.activeElement.tagName)){e.preventDefault();$('#search').focus();}if(e.key==='Escape'&&document.activeElement===$('#search')){$('#search').value='';query='';if(catalog)render();}});
init();

// Warm only books the reader points at; never fetch the whole shelf or book body.
const prefetched = new Set();
function prefetchBook(event) {
  if (navigator.connection?.saveData || /(^|-)2g$/.test(navigator.connection?.effectiveType || '')) return;
  const link = event.target.closest('a[href^="/read/"]');
  if (!link || prefetched.has(link.href) || prefetched.size >= 4) return;
  prefetched.add(link.href);
  const hint = document.createElement('link');
  hint.rel = 'prefetch'; hint.href = link.href; hint.as = 'document';
  document.head.append(hint);
}
document.addEventListener('pointerover', prefetchBook, {passive:true});
document.addEventListener('focusin', prefetchBook);
