(() => {
  const meta = name => document.querySelector(`meta[name="${name}"]`)?.content;
  const bookId = meta('labook-id');
  if (!bookId) return;
  function record() {
    try {
      const stored = JSON.parse(localStorage.getItem('labook:recent') || '[]');
      const recent = Array.isArray(stored) ? stored.filter(r => r && r.id !== bookId) : [];
      recent.unshift({ id: bookId, at: Date.now() });
      localStorage.setItem('labook:recent', JSON.stringify(recent.slice(0, 30)));
    } catch { /* Reading works without browser storage. */ }
  }
  record();
  window.addEventListener('pageshow', record);
  if (!meta('labook-progressive')) return;

  const root = document.documentElement;
  const body = document.body;
  const $ = id => document.getElementById(id);
  const prefix = meta('labook-storage');
  const get = (key, fallback) => { try { return localStorage.getItem(prefix + key) ?? fallback; } catch { return fallback; } };
  const set = (key, value) => { try { localStorage.setItem(prefix + key, value); } catch {} };
  const last = get('last', '');
  const fullLink = document.createElement('a');
  fullLink.href = `/full/${bookId}`;
  fullLink.className = 'reader-full-link';
  fullLink.textContent = '完整书籍 · 打印';
  document.querySelector('.toc')?.append(fullLink);
  const blocks = [...document.querySelectorAll('[data-chapter-url]')];
  const byId = new Map(blocks.map(b => [b.id, b]));
  const requests = new Map();
  const queue = [];
  let running = 0, navigation = 0, jumping = false, current = '';
  let pinnedTarget = null;
  const alignTarget = () => {
    requestAnimationFrame(() => requestAnimationFrame(() => pinnedTarget?.scrollIntoView({ behavior: 'instant', block: 'start' })));
  };
  // Neighboring chapters can change height after a jump. Hold the destination
  // steady until the reader deliberately scrolls or interacts again.
  for (const event of ['wheel', 'touchstart', 'pointerdown', 'keydown']) {
    window.addEventListener(event, () => { pinnedTarget = null; }, { passive: true, capture: true });
  }
  document.addEventListener('load', event => { if (event.target.tagName === 'IMG' && pinnedTarget) alignTarget(); }, true);

  function setTheme(theme) {
    root.dataset.theme = ['light', 'warm', 'night'].includes(theme) ? theme : 'light';
    set('theme', root.dataset.theme);
    document.querySelectorAll('[data-theme-btn]').forEach(b => b.setAttribute('aria-pressed', b.dataset.themeBtn === root.dataset.theme));
  }
  function setSize(value) {
    const size = Math.max(14, Math.min(22, Number(value) || 17));
    root.style.setProperty('--fs', `${size}px`);
    if ($('fsNow')) $('fsNow').textContent = size;
    set('fs', size);
  }
  setTheme(get('theme', 'light'));
  setSize(get('fs', 17));
  document.querySelectorAll('[data-theme-btn]').forEach(b => b.addEventListener('click', () => setTheme(b.dataset.themeBtn)));
  $('fsUp')?.addEventListener('click', () => setSize(Number(get('fs', 17)) + 1));
  $('fsDown')?.addEventListener('click', () => setSize(Number(get('fs', 17)) - 1));
  $('menuBtn')?.addEventListener('click', () => { body.dataset.toc = body.dataset.toc === 'open' ? 'closed' : 'open'; });
  document.querySelectorAll('.toc-part > button').forEach(button => button.addEventListener('click', () => {
    const open = button.parentElement.dataset.open === 'false';
    button.parentElement.dataset.open = String(open);
    button.setAttribute('aria-expanded', String(open));
  }));

  function pump() {
    while (running < 3 && queue.length) {
      const task = queue.shift();
      running++;
      task().finally(() => { running--; pump(); });
    }
  }
  function loadChapter(block, priority = false) {
    if (!block || block.dataset.chapterLoaded === 'true') return Promise.resolve();
    if (requests.has(block.id)) return requests.get(block.id);
    let resolve, reject;
    const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
    requests.set(block.id, promise);
    const task = async () => {
      block.setAttribute('aria-busy', 'true');
      const message = block.querySelector('.chapter-message');
      if (message) message.textContent = '正在加载…';
      try {
        const response = await fetch(block.dataset.chapterUrl, { signal: AbortSignal.timeout(20000) });
        if (!response.ok) throw new Error(`Chapter HTTP ${response.status}`);
        const data = await response.json();
        if (typeof data.html !== 'string') throw new Error('Invalid chapter response');
        block.innerHTML = data.html;
        block.dataset.chapterLoaded = 'true';
        delete block.dataset.chapterError;
        loader.unobserve(block);
        if (pinnedTarget) alignTarget();
        resolve();
      } catch (error) {
        block.dataset.chapterError = 'true';
        if (message) message.textContent = '加载失败，请点击“加载本章”重试。';
        requests.delete(block.id);
        reject(error);
      } finally { block.removeAttribute('aria-busy'); }
    };
    priority ? queue.unshift(task) : queue.push(task);
    pump();
    return promise;
  }
  const loader = new IntersectionObserver(entries => {
    for (const entry of entries) if (entry.isIntersecting && !entry.target.dataset.chapterError) loadChapter(entry.target).catch(() => {});
  }, { rootMargin: '900px 0px' });
  blocks.filter(b => b.dataset.chapterLoaded !== 'true').forEach(b => loader.observe(b));
  document.addEventListener('click', event => {
    const button = event.target.closest('[data-load-chapter]');
    if (button) loadChapter(button.closest('[data-chapter-url]'), true).catch(() => {});
  });

  let manifestPromise;
  function manifest() {
    if (!manifestPromise) manifestPromise = fetch(meta('labook-manifest'), { signal: AbortSignal.timeout(20000) }).then(response => {
      if (!response.ok) throw new Error('Chapter index unavailable');
      return response.json();
    }).catch(error => { manifestPromise = null; throw error; });
    return manifestPromise;
  }
  const notice = document.createElement('div');
  notice.className = 'reader-notice';
  notice.hidden = true;
  notice.innerHTML = `<span role="status"></span><button type="button" hidden>重试</button><a href="/full/${bookId}">完整书籍</a>`;
  body.append(notice);
  let retry;
  notice.querySelector('button').addEventListener('click', () => retry?.());
  function showNotice(message, action) {
    notice.hidden = false;
    notice.querySelector('span').textContent = message;
    notice.querySelector('button').hidden = !action;
    retry = action;
  }
  function markCurrent(id) {
    if (!id || id === current) return;
    current = id;
    document.querySelector('.toc-item.current')?.classList.remove('current');
    const link = [...document.querySelectorAll('.toc-item')].find(a => a.getAttribute('href') === '#' + id);
    if (link) {
      link.classList.add('current');
      const part = link.closest('.toc-part');
      if (part) { part.dataset.open = 'true'; part.querySelector('button')?.setAttribute('aria-expanded', 'true'); }
    }
    set('last', id);
  }
  async function goTo(id, push = true) {
    const token = ++navigation;
    jumping = true;
    showNotice('正在打开章节…');
    try {
      let target = $(id);
      let block = target?.closest('[data-chapter-url]');
      if (!target) {
        const index = await manifest();
        block = byId.get(index.anchors[id]);
      }
      if (block) await loadChapter(block, true);
      if (token !== navigation) return;
      target = $(id);
      if (!target) throw new Error('Anchor unavailable');
      if (push) history.pushState(null, '', '#' + encodeURIComponent(id));
      pinnedTarget = target;
      target.scrollIntoView({ behavior: 'instant', block: 'start' });
      alignTarget();
      if (block) markCurrent(block.id);
      if (innerWidth <= 900) body.dataset.toc = 'closed';
      notice.hidden = true;
    } catch {
      if (token === navigation) showNotice('章节暂时无法打开，请重试。', () => goTo(id, push));
    } finally { if (token === navigation) jumping = false; }
  }
  document.addEventListener('click', event => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const link = event.target.closest('a[href^="#"]');
    if (!link || link.getAttribute('href') === '#') return;
    event.preventDefault();
    let id = link.getAttribute('href').slice(1);
    try { id = decodeURIComponent(id); } catch {}
    goTo(id);
  });
  const followHash = () => {
    if (!location.hash) return;
    let id = location.hash.slice(1);
    try { id = decodeURIComponent(id); } catch {}
    goTo(id, false);
  };
  window.addEventListener('hashchange', followHash);
  followHash();

  const observer = new IntersectionObserver(entries => {
    if (jumping) return;
    for (const entry of entries) if (entry.isIntersecting && entry.target.dataset.chapterLoaded === 'true') markCurrent(entry.target.id);
  }, { rootMargin: '-70px 0px -75% 0px' });
  blocks.forEach(block => observer.observe(block));
  let tick = false;
  function onScroll() {
    const height = root.scrollHeight - innerHeight;
    if ($('progress')) $('progress').style.width = `${height > 0 ? Math.min(100, scrollY / height * 100) : 0}%`;
    $('totop')?.classList.toggle('on', scrollY > 900);
    tick = false;
  }
  window.addEventListener('scroll', () => { if (!tick) { tick = true; requestAnimationFrame(onScroll); } }, { passive: true });
  onScroll();
  $('totop')?.addEventListener('click', () => scrollTo({top:0, behavior:matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth'}));
  const resume = $('resume');
  if (resume && byId.has(last) && !location.hash) {
    const title = byId.get(last).querySelector('h2,h3,h4,.chapter-placeholder p')?.textContent || '上次阅读的章节';
    if ($('resumeTitle')) $('resumeTitle').textContent = title.slice(0, 40);
    resume.hidden = false;
    $('resumeGo')?.addEventListener('click', () => { goTo(last); resume.hidden = true; });
    $('resumeX')?.addEventListener('click', () => { resume.hidden = true; });
  }

  // The full-text index is loaded in a worker only after a search, never on open.
  const input = $('q'), panel = $('results'), rhead = $('rhead'), rlist = $('rlist');
  let worker, timer, requestId = 0;
  function highlight(parent, value, query) {
    const lower = value.toLowerCase(), needle = query.toLowerCase();
    let from = 0, at;
    while ((at = lower.indexOf(needle, from)) !== -1) {
      parent.append(document.createTextNode(value.slice(from, at)));
      const mark = document.createElement('mark'); mark.textContent = value.slice(at, at + query.length); parent.append(mark);
      from = at + query.length;
    }
    parent.append(document.createTextNode(value.slice(from)));
  }
  function search() {
    const query = input.value.trim();
    const id = ++requestId;
    if (!query) { panel.hidden = true; return; }
    panel.hidden = false; rhead.textContent = '正在搜索全书…'; rlist.replaceChildren();
    if (!worker) {
      const url = new URL('/search-worker.js', location.origin);
      url.search = new URL(document.querySelector('script[src*="reader.js"]').src).search;
      worker = new Worker(url);
      worker.onmessage = event => {
        const result = event.data;
        if (result.id !== requestId) return;
        if (result.error) { rhead.textContent = '搜索加载失败，修改关键词可重试。'; return; }
        rhead.textContent = result.total ? `命中 ${result.total} 处 · ${result.chapters} 个章节` : `没有找到「${queryForResult}」`;
        rlist.replaceChildren();
        for (const hit of result.hits) {
          const button = document.createElement('button'); button.className = 'hit'; button.dataset.go = hit.id;
          const title = document.createElement('div'); title.className = 'hit-t'; title.textContent = `${hit.title}${hit.n > 1 ? ` · ${hit.n} 处` : ''}`;
          const snippet = document.createElement('div'); snippet.className = 'hit-s'; highlight(snippet, `…${hit.snip}…`, queryForResult);
          button.append(title, snippet); rlist.append(button);
        }
      };
      worker.onerror = () => { rhead.textContent = '搜索暂时不可用，请使用目录阅读。'; worker.terminate(); worker = null; };
    }
    queryForResult = query;
    worker.postMessage({ id, query, url: meta('labook-search') });
  }
  let queryForResult = '';
  input?.addEventListener('input', () => { requestId++; clearTimeout(timer); timer = setTimeout(search, 180); });
  rlist?.addEventListener('click', event => {
    const hit = event.target.closest('[data-go]');
    if (hit) { goTo(hit.dataset.go); if (innerWidth <= 900) panel.hidden = true; }
  });
  document.addEventListener('keydown', event => {
    if (event.metaKey || event.ctrlKey || event.altKey || ['INPUT','TEXTAREA','SELECT'].includes(document.activeElement.tagName) && document.activeElement !== input) return;
    if (event.key === '/' && document.activeElement !== input) { event.preventDefault(); input?.focus(); }
    else if (event.key === 'Escape') { if (panel) panel.hidden = true; requestId++; clearTimeout(timer); if (input) { input.value = ''; input.blur(); } body.dataset.toc = 'closed'; }
    else if ((event.key === '[' || event.key === ']') && document.activeElement !== input) {
      event.preventDefault(); const index = Math.max(0, blocks.findIndex(b => b.id === current));
      const next = Math.max(0, Math.min(blocks.length - 1, index + (event.key === ']' ? 1 : -1)));
      goTo(blocks[next].id);
    }
  });
})();
