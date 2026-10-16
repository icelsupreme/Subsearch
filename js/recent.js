// Recent searches, kept in this browser's local storage. A search counts once you press Enter or open a result.
const KEY = 'recentSearches';
const LIMIT = 8;
const $ = (id) => document.getElementById(id);
let onPick = () => {};

function load() {
  try {
    return JSON.parse(localStorage.getItem(KEY)) ?? [];
  } catch {
    return [];
  }
}

function save(list) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {}
  render();
}

export function remember(query) {
  const q = query.trim();
  if (q) save([q, ...load().filter((x) => x.toLowerCase() !== q.toLowerCase())].slice(0, LIMIT));
}

export function clearRecent() {
  save([]);
}

// The chips show only while the search box is empty. The same list feeds the box's suggestions (a native datalist).
export function render() {
  const list = load();
  $('q-suggestions').replaceChildren(...list.map((q) => new Option(q)));
  $('recent').hidden = !list.length || !!$('q').value.trim();
  $('recent-list').replaceChildren(
    ...list.map((q) => {
      const li = $('recent-template').content.firstElementChild.cloneNode(true);
      li.querySelector('.recent-pick').textContent = q;
      li.querySelector('.recent-pick').addEventListener('click', () => onPick(q));
      li.querySelector('.recent-remove').setAttribute('aria-label', `Remove "${q}" from recent searches`);
      li.querySelector('.recent-remove').addEventListener('click', () => save(load().filter((x) => x !== q)));
      return li;
    }),
  );
}

export function initRecent(pick) {
  onPick = pick;
  $('recent-clear').addEventListener('click', clearRecent);
  render();
}
