// Active-link highlighting and light/dark theme toggle.
// Theme preference is a per-viewer convenience only — stored in localStorage,
// never assumed to persist or sync, and the page must render fine without it.

(function highlightActiveNavLink() {
  const current = location.pathname.split("/").pop() || "index.html";
  document.querySelectorAll(".main-nav a").forEach((link) => {
    const href = link.getAttribute("href");
    if (href === current) link.setAttribute("aria-current", "page");
  });
})();

(function initThemeToggle() {
  const root = document.documentElement;
  const button = document.getElementById("theme-toggle");
  if (!button) return;

  const SUN_ICON =
    '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" ' +
    'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="5"></circle>' +
    '<line x1="12" y1="1" x2="12" y2="3"></line><line x1="12" y1="21" x2="12" y2="23"></line>' +
    '<line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line>' +
    '<line x1="1" y1="12" x2="3" y2="12"></line><line x1="21" y1="12" x2="23" y2="12"></line>' +
    '<line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line></svg>';

  const MOON_ICON =
    '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" ' +
    'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path></svg>';

  let stored = null;
  try {
    stored = localStorage.getItem("portfolio-theme");
  } catch (err) {
    /* localStorage unavailable (private window, blocked storage) — ignore */
  }
  if (stored === "light" || stored === "dark") {
    root.setAttribute("data-theme", stored);
  }

  const prefersDark = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;

  function effectiveTheme() {
    const explicit = root.getAttribute("data-theme");
    if (explicit === "light" || explicit === "dark") return explicit;
    return prefersDark ? "dark" : "light";
  }

  function render() {
    const isDark = effectiveTheme() === "dark";
    // Icon shows the current mode; clicking flips it.
    button.innerHTML = isDark ? MOON_ICON : SUN_ICON;
    button.setAttribute("aria-label", isDark ? "Switch to light theme" : "Switch to dark theme");
  }
  render();

  button.addEventListener("click", () => {
    const next = effectiveTheme() === "dark" ? "light" : "dark";
    root.setAttribute("data-theme", next);
    render();
    try {
      localStorage.setItem("portfolio-theme", next);
    } catch (err) {
      /* ignore write failures */
    }
  });
})();
