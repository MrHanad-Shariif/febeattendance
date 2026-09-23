// Apply the saved theme before first paint to avoid a light/dark flash.
// Kept as an external file (not inline) so the site can run under a strict
// Content-Security-Policy with script-src 'self'.
try {
  var t = localStorage.getItem("theme");
  var dark = t ? t === "dark" : window.matchMedia("(prefers-color-scheme: dark)").matches;
  if (dark) document.documentElement.classList.add("dark");
} catch (e) {}
