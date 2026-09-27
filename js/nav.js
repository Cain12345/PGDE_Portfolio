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

  let stored = null;
  try {
    stored = localStorage.getItem("portfolio-theme");
  } catch (err) {
    /* localStorage unavailable (private window, blocked storage) — ignore */
  }
  if (stored === "light" || stored === "dark") {
    root.setAttribute("data-theme", stored);
  }

  const label = () =>
    root.getAttribute("data-theme") === "dark" ? "Switch to light theme" : "Switch to dark theme";
  button.textContent = label();

  button.addEventListener("click", () => {
    const next = root.getAttribute("data-theme") === "dark" ? "light" : "dark";
    root.setAttribute("data-theme", next);
    button.textContent = label();
    try {
      localStorage.setItem("portfolio-theme", next);
    } catch (err) {
      /* ignore write failures */
    }
  });
})();
