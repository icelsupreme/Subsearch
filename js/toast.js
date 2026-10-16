// Small notices in the corner of the screen. A toast with an id updates in place instead of stacking.
const AUTO_CLOSE = 5000;
const toasts = new Map();

export function dismiss(id) {
  toasts.get(id)?.el.remove();
  toasts.delete(id);
}

// options: progress {value, max}, dots (animated "..."), error (stays until closed), sticky (stays until dismissed).
export function toast(id, text, { progress, dots, error, sticky } = {}) {
  let entry = toasts.get(id);
  if (!entry) {
    const el = document.getElementById('toast-template').content.firstElementChild.cloneNode(true);
    el.querySelector('.toast-close').addEventListener('click', () => dismiss(id));
    document.getElementById('toasts').append(el);
    entry = { el };
    toasts.set(id, entry);
  }
  const { el } = entry;
  el.querySelector('.toast-text').textContent = text;
  el.querySelector('.toast-dots').hidden = !dots;
  el.querySelector('.toast-error').toggleAttribute('hidden', !error); // SVG elements have no .hidden property
  el.classList.toggle('border-flame', !!error);
  el.classList.toggle('border-transparent', !error);
  const bar = el.querySelector('progress');
  bar.hidden = !progress;
  if (progress) Object.assign(bar, progress);
  clearTimeout(entry.timer);
  if (!error && !sticky) entry.timer = setTimeout(() => dismiss(id), AUTO_CLOSE);
}
