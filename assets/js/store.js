// Хранилище на устройстве: IndexedDB для картинок (готовые работы и черновики), localStorage для избранного.
const DB_NAME = 'maestro', VERSION = 1;
let dbp;
function db() {
  if (!dbp) dbp = new Promise((ok, err) => {
    const r = indexedDB.open(DB_NAME, VERSION);
    r.onupgradeneeded = () => {
      const d = r.result;
      if (!d.objectStoreNames.contains('works')) d.createObjectStore('works', { keyPath: 'id' });
      if (!d.objectStoreNames.contains('drafts')) d.createObjectStore('drafts', { keyPath: 'workId' });
    };
    r.onsuccess = () => ok(r.result); r.onerror = () => err(r.error);
  });
  return dbp;
}
async function tx(store, mode, fn) {
  const d = await db();
  return new Promise((ok, err) => {
    const t = d.transaction(store, mode), s = t.objectStore(store);
    const req = fn(s);
    t.oncomplete = () => ok(req && req.result); t.onerror = () => err(t.error);
  });
}
export const saveWork = (w) => tx('works', 'readwrite', (s) => s.put(w));
export const getWork = (id) => tx('works', 'readonly', (s) => s.get(id));
export const listWorks = async () => ((await tx('works', 'readonly', (s) => s.getAll())) || []).sort((a, b) => b.created - a.created);
export const deleteWork = (id) => tx('works', 'readwrite', (s) => s.delete(id));
export const saveDraft = (d) => tx('drafts', 'readwrite', (s) => s.put(d));
export const getDraft = (workId) => tx('drafts', 'readonly', (s) => s.get(workId));
export const listDrafts = async () => (await tx('drafts', 'readonly', (s) => s.getAll())) || [];
export const deleteDraft = (workId) => tx('drafts', 'readwrite', (s) => s.delete(workId));

const FAV = 'maestro.favs';
export const favs = () => { try { return JSON.parse(localStorage.getItem(FAV) || '[]'); } catch { return []; } };
export const toggleFav = (id) => { const f = new Set(favs()); f.has(id) ? f.delete(id) : f.add(id); try { localStorage.setItem(FAV, JSON.stringify([...f])); } catch {} return f.has(id); };
