import { initChannels, onlyChannel, selected, setChannels, setMatches, writeParams } from './channels.js';
import { DESCRIPTION_LIMIT, store } from './db.js';
import { clearRecent, initRecent, remember, render as renderRecent, suggest } from './recent.js';
import { toast } from './toast.js';

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
          description: s.description.slice(0, DESCRIPTION_LIMIT),
          publishedAt: s.publishedAt,
          ...(status?.privacyStatus !== 'public' && { privacy: status?.privacyStatus }),
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
      subs.push(
        ...items.map((i) => ({
          id: i.snippet.resourceId.channelId,
          title: i.snippet.title,
          thumb: i.snippet.thumbnails?.default?.url,
        })),
      );
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
  clearRecent();
  if (token) google.accounts.oauth2.revoke(token);
  token = null;
  toast('sync', 'Your data is deleted.');
  worker.postMessage({ type: 'load' });
}

function videoItem(v) {
  const li = $('video-template').content.firstElementChild.cloneNode(true);
  li.querySelector('a').href = `https://www.youtube.com/watch?v=${v.id}`;
  // The medium thumbnail URL follows from the video ID. Older saved videos still have a stored URL.
  li.querySelector('img').src = v.thumb ?? `https://i.ytimg.com/vi/${v.id}/mqdefault.jpg`;
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

const FILTERS = ['q', 'sort', 'date', 'unavailable'];
const getFilter = (id) => ($(id).type === 'checkbox' ? ($(id).checked ? '1' : '') : $(id).value);
function setFilter(id, value) {
  if ($(id).type === 'checkbox') $(id).checked = value === '1';
  else $(id).value = value;
}
let firstLoad = true;
let searchId = 0;
let total = 0;
let shown = 0;

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
    showEmpty(null);
    return;
  }
  const filters = Object.fromEntries(FILTERS.map((id) => [id, getFilter(id)]));
  setBusy(true);
  worker.postMessage({
    type: 'search',
    id: ++searchId,
    size: PAGE_SIZE,
    ...filters,
    query: filters.q,
    channels: selected(),
  });
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
    if (firstLoad) warnExpiry(data);
    firstLoad = false;
    setChannels(data.channels);
    return render();
  }
  if (data.id !== searchId) return; // an older search; a newer one is on its way
  if (data.type === 'results') {
    setBusy(false);
    total = data.total;
    shown = 0;
    const query = $('q').value.trim();
    $('count').textContent = total ? `${total.toLocaleString()} ${query ? 'results' : 'videos'}.` : '';
    setMatches(data.matches);
    showChannelHit(query);
    if (total) showEmpty(null);
    else if (selected()?.length === 0)
      showEmpty('No channels selected', 'Open the channel list and turn on at least one channel.');
    else if (query)
      showEmpty(`No videos match “${query}”`, 'Try fewer or different words, or change the date and channel filters.');
    else showEmpty('No videos to show', 'Change the filters, or sync to download your videos.');
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

// A channel whose name is exactly the search gets a card above the video results.
const normalize = (s) => s.trim().toLowerCase().replace(/s+/g, ' ');
function showChannelHit(query) {
  const q = normalize(query);
  const hits = q ? channels.filter((c) => normalize(c.title) === q) : [];
  const on = selected();
  $('channel-hits').replaceChildren(
    ...hits.map((c) => {
      const card = $('channel-hit-template').content.firstElementChild.cloneNode(true);
      const img = card.querySelector('img');
      if (c.thumb) img.src = c.thumb;
      else img.remove();
      card.querySelector('.hit-initial').textContent = c.title.trim()[0] ?? '';
      card.querySelector('.hit-name').textContent = c.title;
      card.querySelector('.hit-meta').textContent = c.latest
        ? `${c.count.toLocaleString()} videos · latest upload ${formatDate(c.latest)}`
        : `${c.count.toLocaleString()} videos`;
      card.querySelector('.hit-link').href = `https://www.youtube.com/channel/${c.id}`;
      const only = card.querySelector('.hit-only');
      only.hidden = on?.length === 1 && on[0] === c.id;
      only.addEventListener('click', () => onlyChannel(c.id));
      return card;
    }),
  );
}

// The message in the middle of the page when there's nothing to list. Pass null to hide it.
function showEmpty(title, text = '', { dots = false } = {}) {
  $('empty').hidden = !title;
  if (!title) return;
  $('empty-title').textContent = title;
  $('empty-dots').hidden = !dots;
  $('empty-text').textContent = text;
}

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
  writeParams(params);
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
  renderRecent();
  showClear();
  showSuggestion();
});

// Inline suggestion from recent searches: the rest of the match shows in muted text after the typed text.
// Tab, or the right arrow at the end of the text, accepts it.
let suggestion = null;
function showSuggestion() {
  const q = $('q');
  const atEnd = q.selectionStart === q.value.length && q.scrollWidth <= q.clientWidth;
  suggestion = document.activeElement === q && atEnd ? suggest(q.value) : null;
  $('q-ghost-typed').textContent = suggestion ? q.value : '';
  $('q-ghost-rest').textContent = suggestion ? suggestion.slice(q.value.length) : '';
}
$('q').addEventListener('keydown', (e) => {
  const q = $('q');
  if (!suggestion || e.shiftKey || e.altKey || e.ctrlKey || e.metaKey) return;
  if (e.key !== 'Tab' && !(e.key === 'ArrowRight' && q.selectionStart === q.value.length)) return;
  e.preventDefault();
  q.value = suggestion;
  q.dispatchEvent(new Event('input'));
});
for (const type of ['focus', 'blur', 'click', 'keyup']) $('q').addEventListener(type, showSuggestion);

// Our own clear button: the browser's built-in one is hidden, and Firefox has none.
const showClear = () => ($('q-clear').hidden = !$('q').value);
$('q-clear').addEventListener('click', () => {
  $('q').value = '';
  clearTimeout(timer);
  showClear();
  renderRecent();
  update();
  $('q').focus();
});
showClear();
// Opening a result counts the search as used.
$('results').addEventListener('click', (e) => {
  if (e.target.closest('a')) remember($('q').value);
});
for (const id of ['sort', 'date', 'unavailable']) $(id).addEventListener('change', update);
$('search-form')
  .querySelector('form')
  .addEventListener('submit', (e) => {
    e.preventDefault();
    clearTimeout(timer);
    remember($('q').value);
    update();
  });
initChannels(update);
initRecent((query) => {
  $('q').value = query;
  showClear();
  remember(query);
  renderRecent();
  update();
  $('q').focus();
});
$('more').addEventListener('click', () =>
  worker.postMessage({ type: 'page', id: searchId, offset: shown, size: PAGE_SIZE }),
);
$('sync').addEventListener('click', sync);
$('start').addEventListener('click', sync);
$('forget').addEventListener('click', forget);

showEmpty('Loading your videos', 'A large library can take a few seconds.', { dots: true });
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
