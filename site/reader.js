(() => {
  const id = document.querySelector('meta[name="labook-id"]')?.content;
  if (!id) return;
  const key = 'labook:recent';
  function record() {
    try {
      const stored = JSON.parse(localStorage.getItem(key) || '[]');
      const recent = Array.isArray(stored) ? stored.filter(r => r && r.id !== id) : [];
      recent.unshift({ id, at: Date.now() });
      localStorage.setItem(key, JSON.stringify(recent.slice(0, 30)));
    } catch { /* Reading remains available when browser storage is disabled. */ }
  }
  record();
  window.addEventListener('pageshow', record);
})();
