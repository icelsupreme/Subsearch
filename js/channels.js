// The channel filter: a side drawer with a checkbox per channel.
const $ = (id) => document.getElementById(id);
let channels = []; // [{id, title, count, latest}], from the worker
let excluded = new Set(); // channels switched off; empty means all channels
let matches = null; // {channelId: count} for the current search query, or null with no query
let onChange = () => {};

const formatDate = (iso) =>
  new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });

// Selected channel IDs for the search, or null for all channels.
export function selected() {
  return excluded.size ? channels.filter((c) => !excluded.has(c.id)).map((c) => c.id) : null;
}

// The URL keeps whichever list is shorter: the channels on (ch) or the channels off (xch).
export function writeParams(params) {
  const on = selected();
  if (!on) return;
  if (on.length <= excluded.size) params.set('ch', on.join(','));
  else params.set('xch', [...excluded].join(','));
}

function readParams() {
  const params = new URLSearchParams(location.search);
  const on = params.get('ch') ?? params.get('channel'); // "channel" is the older single-channel link
  if (on) {
    const keep = new Set(on.split(','));
    excluded = new Set(channels.filter((c) => !keep.has(c.id)).map((c) => c.id));
  } else if (params.get('xch')) excluded = new Set(params.get('xch').split(','));
}

function updateLabels() {
  const on = channels.length - channels.filter((c) => excluded.has(c.id)).length;
  $('channels-label').textContent = excluded.size ? `${on} of ${channels.length} channels` : 'All channels';
}

// With a search query, channels that have matching videos come first, most matches first, under their own heading.
function renderList() {
  const sort = $('channel-sort-name').checked ? 'name' : 'recent';
  const sorted = [...channels].sort((a, b) =>
    sort === 'name' ? a.title.localeCompare(b.title) : (b.latest ?? '').localeCompare(a.latest ?? ''),
  );
  const matching = matches ? sorted.filter((c) => matches[c.id]).sort((a, b) => matches[b.id] - matches[a.id]) : [];
  const rest = matches ? sorted.filter((c) => !matches[c.id]) : sorted;
  const heading = (text) => {
    const li = document.createElement('li');
    li.className = 'channel-heading px-2 pt-3 pb-1 text-xs font-semibold tracking-wide text-muted uppercase';
    li.textContent = text;
    return li;
  };
  $('channel-list').replaceChildren(
    ...(matching.length ? [heading('Channels with matches'), ...matching.map(row)] : []),
    ...(matching.length && rest.length ? [heading('Other channels')] : []),
    ...rest.map(row),
  );
  filterList();
}

function row(c) {
  const li = $('channel-template').content.firstElementChild.cloneNode(true);
  const box = li.querySelector('input');
  box.value = c.id;
  box.checked = !excluded.has(c.id);
  li.querySelector('.channel-name').textContent = c.title;
  li.querySelector('.channel-meta').textContent = c.latest
    ? `${c.count.toLocaleString()} videos · latest ${formatDate(c.latest)}`
    : `${c.count.toLocaleString()} videos`;
  const badge = li.querySelector('.channel-matches');
  badge.hidden = !matches?.[c.id];
  badge.textContent = matches?.[c.id]
    ? `${matches[c.id].toLocaleString()} ${matches[c.id] === 1 ? 'match' : 'matches'}`
    : '';
  li.querySelector('label').classList.toggle('bg-surface', !!matches?.[c.id]);
  return li;
}

export function setMatches(next) {
  matches = next;
  renderList();
}

function filterList() {
  const find = $('channel-find').value.trim().toLowerCase();
  for (const li of $('channel-list').children) {
    const name = li.querySelector('.channel-name');
    li.hidden = !!find && !name?.textContent.toLowerCase().includes(find);
  }
}

function changed() {
  updateLabels();
  onChange();
}

// Turns on one channel and turns off all others.
export function onlyChannel(id) {
  excluded = new Set(channels.filter((c) => c.id !== id).map((c) => c.id));
  renderList();
  changed();
}

export function setChannels(list) {
  const first = !channels.length;
  channels = list;
  if (first) readParams();
  const ids = new Set(list.map((c) => c.id));
  excluded = new Set([...excluded].filter((id) => ids.has(id)));
  updateLabels();
  renderList();
}

export function initChannels(handler) {
  onChange = handler;
  const drawer = $('channels-drawer');
  try {
    if (localStorage.getItem('channelSort') === 'name') $('channel-sort-name').checked = true;
  } catch {}
  $('channels-open').addEventListener('click', () => drawer.showModal());
  $('channels-close').addEventListener('click', () => drawer.close());
  $('channels-done').addEventListener('click', () => drawer.close());
  // A click on the backdrop lands on the dialog element itself.
  drawer.addEventListener('click', (e) => {
    if (e.target === drawer) drawer.close();
  });
  $('channel-find').addEventListener('input', filterList);
  for (const id of ['channel-sort-recent', 'channel-sort-name']) {
    $(id).addEventListener('change', () => {
      try {
        localStorage.setItem('channelSort', $('channel-sort-name').checked ? 'name' : 'recent');
      } catch {}
      renderList();
    });
  }
  $('channel-list').addEventListener('change', (e) => {
    if (e.target.checked) excluded.delete(e.target.value);
    else excluded.add(e.target.value);
    changed();
  });
  // "All" and "None" act on the channels the find box shows.
  const setVisible = (on) => {
    for (const li of $('channel-list').children) {
      const box = li.querySelector('input');
      if (li.hidden || !box) continue;
      box.checked = on;
      if (on) excluded.delete(box.value);
      else excluded.add(box.value);
    }
    changed();
  };
  $('channels-all').addEventListener('click', () => setVisible(true));
  $('channels-none').addEventListener('click', () => setVisible(false));
}
