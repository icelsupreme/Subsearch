import { store } from './db.js';
import { dismiss, toast } from './toast.js';

const CLIENT_ID = '1001205093961-u7jg9fcc5b5iob45c6flotph82k5vl99.apps.googleusercontent.com';
const API = 'https://www.googleapis.com/youtube/v3/';
const PAGE_SIZE = 48;
const $ = (id) => document.getElementById(id);
const worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
let channels = []; // [{id, title, count}], from the worker
let token;

function signIn() {
  return new Promise((resolve, reject) => {
    google.accounts.oauth2
      .initTokenClient({
        client_id: CLIENT_ID,
        scope: 'https://www.googleapis.com/auth/youtube.readonly',
        callback: (r) => (r.error ? reject(new Error(r.error)) : resolve(r.access_token)),
        error_callback: (e) => reject(new Error(e.message || e.type)),
      })
      .requestAccessToken();
  });
}

async function api(path, params) {
  const r = await fetch(`${API + path}?${new URLSearchParams(params)}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const j = await r.json();
  if (!r.ok)
    throw Object.assign(new Error(j.error?.message || r.statusText), {
      status: r.status,
      reason: j.error?.errors?.[0]?.reason,
    });
  return j;
}

async function* pages(path, params) {
  let pageToken;
  do {
    const j = await api(path, { ...params, maxResults: 50, ...(pageToken && { pageToken }) });
    yield j.items;
    pageToken = j.nextPageToken;
  } while (pageToken);
}

// Downloads only videos newer than the newest saved one. Uploads playlists list newest first.
async function syncChannel(sub, old) {
  const known = new Set(old?.videos.map((v) => v.id));
  const fresh = [];
  try {
    outer: for await (const items of pages('playlistItems', {
      part: 'snippet,status',
      playlistId: `UU${sub.id.slice(2)}`,
    })) {
      for (const { snippet: s, status } of items) {
        if (known.has(s.resourceId.videoId)) break outer;
        fresh.push({
          id: s.resourceId.videoId,
          title: s.title,
          description: s.description,
          publishedAt: s.publishedAt,
          thumb: s.thumbnails?.medium?.url,
          privacy: status?.privacyStatus,
        });
      }
    }
  } catch (e) {
    if (e.status !== 404) throw e; // 404: channel has no uploads
  }
  const c = {
    ...sub,
    savedAt: old?.savedAt ?? Date.now(),
    syncedAt: Date.now(),
    videos: [...fresh, ...(old?.videos ?? [])],
  };
  await store('readwrite', (s) => s.put(c));
  return c;
}

// aria-disabled instead of disabled: a disabled button drops keyboard focus.
function setSyncing(syncing) {
  for (const id of ['sync', 'start']) $(id).setAttribute('aria-disabled', syncing);
}

async function sync() {
  if ($('sync').getAttribute('aria-disabled') === 'true') return;
  setSyncing(true);
  try {
    token = await signIn();
    toast('sync', 'Getting your subscriptions', { dots: true, sticky: true });
    const subs = [];
    for await (const items of pages('subscriptions', { part: 'snippet', mine: true })) {
      subs.push(...items.map((i) => ({ id: i.snippet.resourceId.channelId, title: i.snippet.title })));
    }
    const ids = new Set(subs.map((s) => s.id));
    for (const id of await store('readonly', (s) => s.getAllKeys())) {
      if (!ids.has(id)) await store('readwrite', (s) => s.delete(id));
    }

    const queue = [...subs];
    let done = 0;
    const download = async () => {
      while (queue.length) {
        const sub = queue.shift();
        try {
          await syncChannel(sub, await store('readonly', (s) => s.get(sub.id)));
          done++;
          toast('sync', `Syncing channel ${done} of ${subs.length}`, {
            dots: true,
            sticky: true,
            progress: { value: done, max: subs.length },
          });
        } catch (e) {
          queue.length = 0;
          throw e;
        }
      }
    };
    await Promise.all(Array.from({ length: 4 }, download));
    toast('sync', `Sync done: ${subs.length} channels.`);
  } catch (e) {
    toast(
      'sync',
      e.reason === 'quotaExceeded'
        ? 'The daily YouTube limit for this site is used up. Synced channels are saved. Try again tomorrow.'
        : e.status === 401
          ? 'Your Google sign-in expired. Synced channels are saved. To continue, click Sync.'
          : e.message === 'access_denied'
            ? "Sign-in was canceled, or Google didn't allow it. Synced channels are saved."
            : `Error: ${e.message}`,
      { error: true },
    );
  } finally {
    setSyncing(false);
    worker.postMessage({ type: 'load' });
  }
}

async function forget() {
  if (!confirm('Delete all saved data from this browser and sign out?')) return;
  await store('readwrite', (s) => s.clear());
  if (token) google.accounts.oauth2.revoke(token);
  token = null;
  toast('sync', 'Your data is deleted.');
  worker.postMessage({ type: 'load' });
}

function videoItem(v) {
  const li = $('video-template').content.firstElementChild.cloneNode(true);
  li.querySelector('a').href = `https://www.youtube.com/watch?v=${v.id}`;
  if (v.thumb) li.querySelector('img').src = v.thumb;
  li.querySelector('.video-title').textContent = v.title;
  li.querySelector('.video-title').title = v.title;
  const date = new Date(v.publishedAt).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
  li.querySelector('.video-meta').textContent = `${v.channel} · ${date}`;
  return li;
}

const FILTERS = ['q', 'sort', 'date', 'channel', 'unavailable'];
const getFilter = (id) => ($(id).type === 'checkbox' ? ($(id).checked ? '1' : '') : $(id).value);
function setFilter(id, value) {
  if ($(id).type === 'checkbox') $(id).checked = value === '1';
  else $(id).value = value;
}
let firstLoad = true;
let searchId = 0;
let total = 0;
let shown = 0;

function fillChannels() {
  const select = $('channel');
  const current = select.value || new URLSearchParams(location.search).get('channel') || '';
  const sorted = [...channels].sort((a, b) => a.title.localeCompare(b.title));
  select.replaceChildren(select.options[0], ...sorted.map((c) => new Option(`${c.title} (${c.count})`, c.id)));
  select.value = current;
  if (select.selectedIndex < 0) select.value = '';
}

const formatDate = (time) =>
  new Date(time).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });

function showSyncInfo({ syncedAt, expiresAt }) {
  $('sync-info').hidden = !syncedAt;
  $('sync-info').textContent = syncedAt
    ? `Last synced ${formatDate(syncedAt)}. Saved videos expire ${formatDate(expiresAt)}.`
    : '';
}

function warnExpiry({ syncedAt, expiresAt }) {
  if (syncedAt && expiresAt - Date.now() < 3 * 864e5) {
    toast('expiry', `Some saved videos expire ${formatDate(expiresAt)}. Sync to keep them.`, { sticky: true });
  }
}

function render() {
  const hasData = channels.length > 0;
  $('intro').hidden = hasData;
  $('search-form').hidden = !hasData;
  $('forget').hidden = !hasData;
  $('sync').hidden = !hasData;
  if (!hasData) {
    $('count').textContent = '';
    $('results').replaceChildren();
    $('more').hidden = true;
    return;
  }
  const filters = Object.fromEntries(FILTERS.map((id) => [id, getFilter(id)]));
  setBusy(true);
  worker.postMessage({ type: 'search', id: ++searchId, size: PAGE_SIZE, ...filters, query: filters.q });
}

worker.onmessage = ({ data }) => {
  if (data.type === 'error')
    return toast(
      'load',
      `This browser doesn't allow saving data, so Subsearch can't work here. Error: ${data.message}`,
      {
        error: true,
      },
    );
  if (data.type === 'loaded') {
    channels = data.channels;
    showSyncInfo(data);
    if (firstLoad) {
      clearTimeout(loadingTimer);
      dismiss('load');
      warnExpiry(data);
    }
    firstLoad = false;
    fillChannels();
    return render();
  }
  if (data.id !== searchId) return; // an older search; a newer one is on its way
  if (data.type === 'results') {
    setBusy(false);
    total = data.total;
    shown = 0;
    const n = total.toLocaleString();
    $('count').textContent = total ? `${n} ${$('q').value.trim() ? 'results' : 'videos'}.` : 'No results.';
    $('results').replaceChildren();
  }
  if (data.type === 'page') {
    const items = data.items.map(videoItem);
    $('results').append(...items);
    // After "Show more", move focus to the first new video, since the button can disappear.
    if (data.offset && items.length) items[0].querySelector('a').focus();
    shown += data.items.length;
    $('more').hidden = shown >= total;
  }
};

// Shows "Searching..." and dims old results from the first keystroke until the new results arrive.
function setBusy(busy) {
  $('searching').hidden = !busy;
  $('count').hidden = busy;
  $('results').classList.toggle('opacity-50', busy);
}

function update() {
  const params = new URLSearchParams();
  for (const id of FILTERS) {
    const value = getFilter(id);
    if (value && !(id === 'sort' && value === 'relevance')) params.set(id, value);
  }
  history.replaceState(null, '', params.size ? `?${params}` : location.pathname);
  const query = $('q').value.trim();
  document.title = query ? `${query} · Subsearch` : 'Subsearch: search your YouTube subscriptions';
  render();
}

const params = new URLSearchParams(location.search);
for (const id of FILTERS) if (params.has(id)) setFilter(id, params.get(id));

let timer;
$('q').addEventListener('input', () => {
  setBusy(true);
  clearTimeout(timer);
  timer = setTimeout(update, 300);
});
for (const id of ['sort', 'date', 'channel', 'unavailable']) $(id).addEventListener('change', update);
$('search-form')
  .querySelector('form')
  .addEventListener('submit', (e) => {
    e.preventDefault();
    clearTimeout(timer);
    update();
  });
$('more').addEventListener('click', () =>
  worker.postMessage({ type: 'page', id: searchId, offset: shown, size: PAGE_SIZE }),
);
$('sync').addEventListener('click', sync);
$('start').addEventListener('click', sync);
$('forget').addEventListener('click', forget);

// Only show "Loading" if loading is slow, so a quick load doesn't flash a toast.
const loadingTimer = setTimeout(() => toast('load', 'Loading your videos', { dots: true, sticky: true }), 400);
worker.postMessage({ type: 'load' });

const THEMES = ['system', 'light', 'dark'];
function showTheme() {
  const theme = document.documentElement.dataset.theme || 'system';
  for (const icon of $('theme').querySelectorAll('[data-theme-icon]'))
    icon.toggleAttribute('hidden', icon.dataset.themeIcon !== theme); // SVG has no .hidden property
  $('theme').title = `Theme: ${theme}. Click to change.`;
  $('theme').setAttribute('aria-label', $('theme').title);
}
$('theme').addEventListener('click', () => {
  const current = document.documentElement.dataset.theme || 'system';
  const next = THEMES[(THEMES.indexOf(current) + 1) % THEMES.length];
  if (next === 'system') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = next;
  try {
    if (next === 'system') localStorage.removeItem('theme');
    else localStorage.setItem('theme', next);
  } catch {}
  showTheme();
});
showTheme();

$('share').addEventListener('click', async () => {
  const label = $('share').querySelector('span');
  try {
    await navigator.clipboard.writeText(location.href);
    label.textContent = 'Link copied';
  } catch {
    label.textContent = "Couldn't copy the link";
  }
  setTimeout(() => (label.textContent = 'Share'), 2000);
});
