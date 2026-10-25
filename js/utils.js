// Shared helpers for fetching JSON content and safe DOM rendering.
// NOTE: fetch() of local JSON files requires the page to be served over
// http(s) (e.g. `python -m http.server` or an editor "Live Server"),
// not opened directly as a file:// URL — browsers block fetch() on file://.

async function fetchJSON(path) {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`Failed to load ${path}: ${res.status}`);
  return res.json();
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str ?? "";
  return div.innerHTML;
}

function countWords(text) {
  if (!text) return 0;
  const trimmed = text.trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).length;
}

function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === null || value === undefined) continue;
    if (key === "html") node.innerHTML = value;
    else if (key === "text") node.textContent = value;
    else node.setAttribute(key, value);
  }
  for (const child of [].concat(children)) {
    if (child) node.appendChild(child);
  }
  return node;
}

// A Google Drive "share" link (.../file/d/ID/view) is an HTML page, not an
// image file, so it can't be used directly as an <img src>. This converts a
// share link into Drive's thumbnail endpoint, which does serve a real image.
// Any other URL (local path, direct image link, etc.) passes through unchanged.
function toDirectImageUrl(url) {
  if (!url) return url;
  const match = url.match(/drive\.google\.com\/(?:file\/d\/|open\?id=)([^/?&]+)/i);
  if (match) return `https://drive.google.com/thumbnail?id=${match[1]}&sz=w1000`;
  return url;
}

// Base64-encodes text safely for UTF-8 content (plain btoa() mangles anything
// outside Latin-1, e.g. accented names, em dashes). Used when posting file
// content to the GitHub Contents API, which requires base64.
function utf8ToBase64(str) {
  const bytes = new TextEncoder().encode(str);
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

function showLoadError(container, err) {
  container.innerHTML = `
    <div class="placeholder-box" role="alert">
      Could not load portfolio data (${escapeHtml(err.message)}).<br>
      If you opened this file directly from disk, start a local server instead —
      e.g. run <code>python -m http.server</code> in the project folder and open
      <code>http://localhost:8000/</code>.
    </div>`;
  console.error(err);
}
