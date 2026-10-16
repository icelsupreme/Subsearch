// Runs searches off the main thread, so typing never waits for a search to finish.
import { DESCRIPTION_LIMIT, store } from './db.js';
import { isUnavailable, scorer } from './search.js';

const MAX_AGE = 30 * 864e5; // YouTube API policy: stored data must be refreshed or deleted within 30 days
let channels = [];
let hits = [];
let matches = {};

const card = ([v, c]) => ({ id: v.id, title: v.title, thumb: v.thumb, publishedAt: v.publishedAt, channel: c.title });

async function load() {
  const cutoff = Date.now() - MAX_AGE;
  const all = await store('readonly', (s) => s.getAll());
  for (const c of all) if (c.savedAt < cutoff) await store('readwrite', (s) => s.delete(c.id));
  channels = all.filter((c) => c.savedAt >= cutoff);
  // Videos saved before the description limit keep full descriptions on disk until they expire; trim them in memory.
  for (const c of channels) for (const v of c.videos) v.description = v.description.slice(0, DESCRIPTION_LIMIT);
  return {
    channels: channels.map((c) => ({
      id: c.id,
      title: c.title,
      count: c.videos.length,
      latest: c.videos[0]?.publishedAt,
    })),
    syncedAt: Math.max(0, ...channels.map((c) => c.syncedAt ?? c.savedAt)),
    // The oldest full download expires first. After that, the next sync downloads it again.
    expiresAt: Math.min(...channels.map((c) => c.savedAt)) + MAX_AGE,
  };
}

// ponytail: scans every video on each search; build an index if this gets slow with large libraries
function search({ query, sort, date, channels: on, unavailable }) {
  const only = on && new Set(on);
  const score = scorer(query);
  const after = date ? new Date(Date.now() - date * 864e5).toISOString() : '';
  hits = [];
  // Match counts cover every channel, also the ones switched off, so the channel drawer can show where matches are.
  matches = {};
  for (const c of channels) {
    const included = !only || only.has(c.id);
    if (!included && !query.trim()) continue;
    let n = 0;
    for (const v of c.videos) {
      if (v.publishedAt < after || (!unavailable && isUnavailable(v))) continue;
      const s = score(v, c.title);
      if (!s) continue;
      n++;
      if (included) hits.push([v, c, s]);
    }
    if (n) matches[c.id] = n;
  }
  const newest = (a, b) => b[0].publishedAt.localeCompare(a[0].publishedAt);
  hits.sort(
    sort === 'oldest'
      ? (a, b) => -newest(a, b)
      : sort === 'relevance' && query.trim()
        ? (a, b) => b[2] - a[2] || newest(a, b)
        : newest,
  );
  return hits.length;
}

// Messages run one at a time, in order, so a search never runs while data is still loading.
let queue = Promise.resolve();
self.onmessage = ({ data }) => {
  queue = queue.then(() => handle(data));
};

async function handle(data) {
  try {
    if (data.type === 'load') postMessage({ type: 'loaded', ...(await load()) });
    if (data.type === 'search')
      postMessage({ type: 'results', id: data.id, total: search(data), matches: data.query.trim() ? matches : null });
    if (data.type === 'search' || data.type === 'page') {
      const offset = data.offset ?? 0;
      postMessage({ type: 'page', id: data.id, offset, items: hits.slice(offset, offset + data.size).map(card) });
    }
  } catch (e) {
    postMessage({ type: 'error', message: e.message });
  }
}
