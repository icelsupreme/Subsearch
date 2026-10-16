// Applies the saved theme before the page paints, so it never shows the wrong colors first.
try {
  const theme = localStorage.getItem('theme');
  if (theme) document.documentElement.dataset.theme = theme;
} catch {}
