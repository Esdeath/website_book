let indexPromise;
self.onmessage = async ({data:{id, query, url}}) => {
  try {
    if (!indexPromise) indexPromise = fetch(url, { signal: AbortSignal.timeout(30000) }).then(response => {
      if (!response.ok) throw new Error('Search index unavailable');
      return response.json();
    }).then(entries => entries.map(entry => ({...entry, lower:entry.text.toLowerCase()}))).catch(error => {indexPromise = null; throw error;});
    const index = await indexPromise;
    const needle = query.toLowerCase();
    if (!needle) {self.postMessage({id,total:0,chapters:0,hits:[]});return;}
    let total = 0, chapters = 0;
    const hits = [];
    for (const entry of index) {
      let from = 0, count = 0, first = -1, at;
      while ((at = entry.lower.indexOf(needle, from)) !== -1) {
        if (first === -1) first = at;
        count++; from = at + needle.length;
      }
      if (count) {
        total += count; chapters++;
        if (hits.length < 60) hits.push({id:entry.id,title:entry.title,n:count,snip:entry.text.slice(Math.max(0, first - 30),first + query.length + 40)});
      }
    }
    self.postMessage({id,total,chapters,hits});
  } catch {self.postMessage({id,error:true});}
};
