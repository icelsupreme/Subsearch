// IndexedDB store of synced channels: {id, title, savedAt, videos: [{id, title, description, publishedAt, thumb}]}
// Only the start of each description is saved, to keep large libraries small. Most descriptions put their
// summary first and links, credits, and sponsor text later.
export const DESCRIPTION_LIMIT = 500;

const db = new Promise((resolve, reject) => {
  const r = indexedDB.open('subsearch', 1);
  r.onupgradeneeded = () => r.result.createObjectStore('channels', { keyPath: 'id' });
  r.onsuccess = () => resolve(r.result);
  r.onerror = () => reject(r.error);
});

export async function store(mode, fn) {
  const tx = (await db).transaction('channels', mode);
  const req = fn(tx.objectStore('channels'));
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve(req.result);
    tx.onerror = () => reject(tx.error);
  });
}
