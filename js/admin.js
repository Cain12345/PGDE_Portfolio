// Admin panel: a forms-based editor over the JSON content layer.
//
// IMPORTANT — read before changing the auth logic:
// This site has no backend. The password check below only hides/shows DOM
// elements in this browser tab; it cannot prevent someone with devtools from
// bypassing it, and the content it "protects" is already public JSON. Treat
// it as a convenience lock against accidental edits, never as real security.
//
// Source of truth = the JSON files in data/. Edits here are drafted to
// localStorage (per-browser, per-device only) until you either click
// Download (then replace the file yourself) or click "Push to GitHub"
// (which commits it directly via the GitHub REST API, see below).
//
// GitHub push: this calls api.github.com straight from the browser using a
// Personal Access Token you provide — there is still no backend, the token
// just grants this browser write access to one repo. That token sits in
// localStorage on this device. Unlike the admin password, this is a REAL
// credential: anyone who gets it can push to your repo. Use a fine-grained
// PAT scoped to only this repository with "Contents: Read and write" and
// nothing else, and use "Forget token" below when you're done on a shared
// machine.

const DRAFT_KEY = "portfolio-admin-draft";
const AUTH_CACHE_KEY = "portfolio-admin-authcache";
const SESSION_KEY = "portfolio-admin-active";
const LAST_EXPORTED_KEY = "portfolio-admin-last-exported";
const GITHUB_CONFIG_KEY = "portfolio-admin-github-config";

let draft = null;
let effectiveHash = null;
let statusMessage = "";

// lastExported is a snapshot of what's actually sitting in data/*.json on
// disk, as far as this browser knows (updated only when a Download button
// is clicked). Diffing draft against it tells us which file(s) are out of
// sync with what you last published, so the panel can point at exactly the
// right file instead of a generic "export something" reminder.
let lastExported = null;

// Result of the most recent GitHub push, so the commit link survives the
// full re-render that happens right after a successful push (renderPanel()
// rebuilds the DOM from scratch, which would otherwise wipe a one-off write).
let lastPushResult = null;

/* ---------------------------------------------------------------------- */
/* Crypto / auth helpers                                                   */
/* ---------------------------------------------------------------------- */

async function hashHex(text) {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function getCachedHash() {
  try {
    return localStorage.getItem(AUTH_CACHE_KEY);
  } catch (err) {
    return null;
  }
}

function setCachedHash(hash) {
  try {
    localStorage.setItem(AUTH_CACHE_KEY, hash);
  } catch (err) {
    /* ignore */
  }
}

function isAuthed() {
  try {
    return sessionStorage.getItem(SESSION_KEY) === "1";
  } catch (err) {
    return false;
  }
}

function setAuthed() {
  try {
    sessionStorage.setItem(SESSION_KEY, "1");
  } catch (err) {
    /* ignore */
  }
}

function clearAuthed() {
  try {
    sessionStorage.removeItem(SESSION_KEY);
  } catch (err) {
    /* ignore */
  }
}

/* ---------------------------------------------------------------------- */
/* Data loading / persistence                                              */
/* ---------------------------------------------------------------------- */

async function loadAdminConfig() {
  try {
    return await fetchJSON("data/admin-config.json");
  } catch (err) {
    return { passwordHash: null };
  }
}

async function loadDraft() {
  try {
    const cached = localStorage.getItem(DRAFT_KEY);
    if (cached) return JSON.parse(cached);
  } catch (err) {
    /* fall through to fresh fetch */
  }
  const [site, sections, artifacts] = await Promise.all([
    fetchJSON("data/site.json"),
    fetchJSON("data/sections.json"),
    fetchJSON("data/artifacts.json"),
  ]);
  const fresh = { site, sections, artifacts };
  persistDraft(fresh);
  return fresh;
}

function persistDraft(data) {
  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify(data));
  } catch (err) {
    statusMessage = "Could not save draft to this browser's storage (it may be full or blocked).";
  }
}

function saveDraft() {
  persistDraft(draft);
  const dirty = computeDirtyFiles();
  statusMessage = dirty.length
    ? `Saved in this browser. Not yet published: ${dirty.join(", ")} — see "Publish" below.`
    : "Saved in this browser.";
  renderPanel();
}

async function discardDraft() {
  if (!confirm("Discard all local edits and reload from the live JSON files?")) return;
  try {
    localStorage.removeItem(DRAFT_KEY);
  } catch (err) {
    /* ignore */
  }
  draft = await loadDraft();
  // draft now IS what's on disk, so the content files are back in sync —
  // reset the baseline to match (password baseline is untouched; it still
  // reflects whatever data/admin-config.json actually contains).
  lastExported.site = deepClone(draft.site);
  lastExported.sections = deepClone(draft.sections);
  lastExported.artifacts = deepClone(draft.artifacts);
  persistLastExported();
  statusMessage = "Local draft discarded — reloaded from the live JSON files.";
  renderPanel();
}

/* ---------------------------------------------------------------------- */
/* "Which file needs replacing" tracking                                   */
/* ---------------------------------------------------------------------- */

function loadLastExported() {
  try {
    const raw = localStorage.getItem(LAST_EXPORTED_KEY);
    if (raw) return JSON.parse(raw);
  } catch (err) {
    /* ignore */
  }
  return null;
}

function persistLastExported() {
  try {
    localStorage.setItem(LAST_EXPORTED_KEY, JSON.stringify(lastExported));
  } catch (err) {
    /* ignore */
  }
}

// Called once per session, right after draft + the on-disk admin-config are
// both known. If no baseline is cached yet, assume the freshly loaded draft
// matches what's on disk (true on a first visit) and the password baseline
// is whatever data/admin-config.json actually contains right now.
function setupExportBaseline(publishedPasswordHash) {
  const stored = loadLastExported();
  if (stored) {
    lastExported = stored;
    return;
  }
  lastExported = {
    site: deepClone(draft.site),
    sections: deepClone(draft.sections),
    artifacts: deepClone(draft.artifacts),
    passwordHash: publishedPasswordHash,
  };
  persistLastExported();
}

function computeDirtyFiles() {
  const dirty = [];
  if (JSON.stringify(draft.site) !== JSON.stringify(lastExported.site)) dirty.push("site.json");
  if (JSON.stringify(draft.sections) !== JSON.stringify(lastExported.sections)) dirty.push("sections.json");
  if (JSON.stringify(draft.artifacts) !== JSON.stringify(lastExported.artifacts)) dirty.push("artifacts.json");
  if (effectiveHash !== lastExported.passwordHash) dirty.push("admin-config.json");
  return dirty;
}

function downloadJSON(filename, data) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = el("a", { href: url, download: filename });
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

/* ---------------------------------------------------------------------- */
/* URL / resource helpers                                                  */
/* ---------------------------------------------------------------------- */

function isValidUrl(value) {
  try {
    new URL(value);
    return true;
  } catch (err) {
    return false;
  }
}

function detectProvider(url) {
  if (/drive\.google\.com|docs\.google\.com/i.test(url)) return "google-drive";
  if (/youtube\.com|youtu\.be/i.test(url)) return "youtube";
  return "other";
}

function suggestEmbedUrl(url) {
  const driveView = url.match(/^https:\/\/drive\.google\.com\/file\/d\/([^/]+)\/(view|edit)/i);
  if (driveView) return `https://drive.google.com/file/d/${driveView[1]}/preview`;

  const youtuBe = url.match(/^https:\/\/youtu\.be\/([^?&]+)/i);
  if (youtuBe) return `https://www.youtube.com/embed/${youtuBe[1]}`;

  const youtubeWatch = url.match(/^https:\/\/(?:www\.)?youtube\.com\/watch\?(?:.*&)?v=([^&]+)/i);
  if (youtubeWatch) return `https://www.youtube.com/embed/${youtubeWatch[1]}`;

  return null;
}

function slugify(title) {
  const base = (title || "task")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return base || "task";
}

function uniqueId(base, existingKeys) {
  if (!existingKeys[base]) return base;
  let n = 2;
  while (existingKeys[`${base}-${n}`]) n++;
  return `${base}-${n}`;
}

function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

/* ---------------------------------------------------------------------- */
/* Resource editor (used by task forms and caption forms)                  */
/* ---------------------------------------------------------------------- */

function buildResourceEditor(resources) {
  // Mutates and returns the same array reference passed in; caller decides
  // when to commit it (on the parent form's Save).
  const wrap = el("div", { class: "field" });
  wrap.appendChild(el("label", { text: "Resources / links" }));
  const list = el("div", {});
  wrap.appendChild(list);

  function renderRows() {
    list.innerHTML = "";
    if (resources.length === 0) {
      list.appendChild(el("p", { class: "field-hint", text: "No resources yet." }));
    }
    resources.forEach((resource, index) => {
      const row = el("div", { class: "resource-row" });

      const titleInput = el("input", { type: "text", value: resource.title || "", placeholder: "Title" });
      titleInput.addEventListener("input", () => (resource.title = titleInput.value));

      const urlInput = el("input", { type: "url", value: resource.url || "", placeholder: "https://drive.google.com/…" });
      const hint = el("p", { class: "field-hint" });
      const applySuggestion = (suggested) => {
        urlInput.value = suggested;
        resource.url = suggested;
        resource.provider = detectProvider(suggested);
        hint.textContent = "";
      };
      const refreshHint = () => {
        const value = urlInput.value.trim();
        resource.url = value;
        if (!value) {
          hint.textContent = "";
          return;
        }
        if (!isValidUrl(value)) {
          hint.innerHTML = "";
          hint.appendChild(el("span", { class: "field-error", text: "Not a valid URL." }));
          return;
        }
        resource.provider = detectProvider(value);
        const suggestion = suggestEmbedUrl(value);
        hint.innerHTML = "";
        if (suggestion && suggestion !== value) {
          const btn = el("button", { type: "button", class: "btn", text: "Use embeddable link instead" });
          btn.addEventListener("click", () => applySuggestion(suggestion));
          hint.appendChild(el("span", { text: "This looks like a share link, not an embed link. " }));
          hint.appendChild(btn);
        } else if (resource.provider === "google-drive") {
          hint.appendChild(
            el("span", {
              text:
                "Google Drive link detected — sharing must be set to “Anyone with the link” (Share → General access). " +
                "If it still shows “you need access” for other people, open the link in an incognito/private window " +
                "(logged out of any Google account) to check: if it fails there too, your account is likely an institutional " +
                "Workspace account that silently restricts “Anyone with the link” to people in your organization only — " +
                "ask IT to allow external sharing, or host the file from a personal Google account instead.",
            })
          );
        }
      };
      urlInput.addEventListener("input", refreshHint);
      refreshHint();

      const displaySelect = el("select", {});
      ["embed", "link"].forEach((mode) => {
        const opt = el("option", { value: mode, text: mode === "embed" ? "Embed inline" : "Link only" });
        if (resource.displayMode === mode) opt.setAttribute("selected", "selected");
        displaySelect.appendChild(opt);
      });
      displaySelect.addEventListener("change", () => (resource.displayMode = displaySelect.value));

      const providerBadge = el("span", { class: "badge", text: resource.provider || "other" });

      const removeBtn = el("button", { type: "button", class: "btn btn-danger", text: "Remove" });
      removeBtn.addEventListener("click", () => {
        resources.splice(index, 1);
        renderRows();
      });

      row.appendChild(titleInput);
      row.appendChild(urlInput);
      row.appendChild(providerBadge);
      row.appendChild(displaySelect);
      row.appendChild(removeBtn);
      list.appendChild(row);
      list.appendChild(hint);
    });
  }

  const addBtn = el("button", { type: "button", class: "btn", text: "+ Add resource" });
  addBtn.addEventListener("click", () => {
    resources.push({ id: `res-${Date.now()}`, title: "", url: "", provider: "other", displayMode: "embed" });
    renderRows();
  });

  renderRows();
  wrap.appendChild(addBtn);
  return wrap;
}

/* ---------------------------------------------------------------------- */
/* Task edit form                                                          */
/* ---------------------------------------------------------------------- */

function buildTaskEditForm(taskId, onDone) {
  const original = draft.artifacts[taskId];
  const working = deepClone(original);
  working.resources = working.resources || [];

  const form = el("div", { class: "task-edit-form" });

  const titleField = el("div", { class: "field" }, [
    el("label", { text: "Title", for: `${taskId}-title` }),
    el("input", { type: "text", id: `${taskId}-title`, value: working.title || "" }),
  ]);
  const titleInput = titleField.querySelector("input");
  titleInput.addEventListener("input", () => (working.title = titleInput.value));
  form.appendChild(titleField);

  if (working.type === "text") {
    const limitField = el("div", { class: "field" }, [
      el("label", { text: "Word limit (blank = none)" }),
      el("input", { type: "number", min: "0", value: working.wordLimit ?? "" }),
    ]);
    const limitInput = limitField.querySelector("input");
    limitInput.addEventListener("input", () => {
      working.wordLimit = limitInput.value === "" ? null : Number(limitInput.value);
    });
    form.appendChild(limitField);

    const bodyField = el("div", { class: "field" }, [
      el("label", { text: "Response text" }),
      el("textarea", { text: working.body || "" }),
    ]);
    const bodyInput = bodyField.querySelector("textarea");
    bodyInput.addEventListener("input", () => (working.body = bodyInput.value));
    form.appendChild(bodyField);
  } else {
    const descField = el("div", { class: "field" }, [
      el("label", { text: "Description" }),
      el("textarea", { text: working.description || "" }),
    ]);
    const descInput = descField.querySelector("textarea");
    descInput.addEventListener("input", () => (working.description = descInput.value));
    form.appendChild(descField);

    if (working.type === "pdf") {
      const strategyField = el("div", { class: "field" }, [
        el("label", { text: "Strategy (optional)" }),
        el("input", { type: "text", value: working.strategy || "" }),
      ]);
      const strategyInput = strategyField.querySelector("input");
      strategyInput.addEventListener("input", () => (working.strategy = strategyInput.value));
      form.appendChild(strategyField);
    }

    if (working.type === "video") {
      const durationField = el("div", { class: "field" }, [
        el("label", { text: "Target length" }),
        el("input", { type: "text", value: working.durationNote || "" }),
      ]);
      const durationInput = durationField.querySelector("input");
      durationInput.addEventListener("input", () => (working.durationNote = durationInput.value));
      form.appendChild(durationField);
    }
  }

  form.appendChild(buildResourceEditor(working.resources));

  const actions = el("div", { class: "btn-row" });
  const saveBtn = el("button", { type: "button", class: "btn btn-primary", text: "Save task" });
  const cancelBtn = el("button", { type: "button", class: "btn", text: "Cancel" });
  const deleteBtn = el("button", { type: "button", class: "btn btn-danger", text: "Delete task" });

  saveBtn.addEventListener("click", () => {
    draft.artifacts[taskId] = working;
    saveDraft();
    onDone();
  });
  cancelBtn.addEventListener("click", () => onDone());
  deleteBtn.addEventListener("click", () => {
    if (!confirm(`Delete "${original.title}"? This removes it from the section and the JSON data.`)) return;
    const section = draft.sections[original.sectionId];
    section.tasks = section.tasks.filter((id) => id !== taskId);
    delete draft.artifacts[taskId];
    saveDraft();
    onDone();
  });

  actions.appendChild(saveBtn);
  actions.appendChild(cancelBtn);
  actions.appendChild(deleteBtn);
  form.appendChild(actions);

  return form;
}

/* ---------------------------------------------------------------------- */
/* Section group (tasks + caption)                                         */
/* ---------------------------------------------------------------------- */

const expandedTasks = new Set();
const expandedSections = new Set();

function buildTaskList(sectionId) {
  const section = draft.sections[sectionId];
  const listWrap = el("div", {});

  section.tasks.forEach((taskId, index) => {
    const artifact = draft.artifacts[taskId];
    if (!artifact) return;

    const row = el("div", { class: "task-row" });
    row.appendChild(el("span", { class: "task-row__title", text: artifact.title }));
    row.appendChild(el("span", { class: "task-row__type badge", text: artifact.type }));

    const actions = el("div", { class: "task-row__actions" });
    const upBtn = el("button", { type: "button", class: "btn", text: "↑" });
    upBtn.disabled = index === 0;
    upBtn.addEventListener("click", () => {
      [section.tasks[index - 1], section.tasks[index]] = [section.tasks[index], section.tasks[index - 1]];
      saveDraft();
    });
    const downBtn = el("button", { type: "button", class: "btn", text: "↓" });
    downBtn.disabled = index === section.tasks.length - 1;
    downBtn.addEventListener("click", () => {
      [section.tasks[index + 1], section.tasks[index]] = [section.tasks[index], section.tasks[index + 1]];
      saveDraft();
    });
    const editBtn = el("button", { type: "button", class: "btn", text: expandedTasks.has(taskId) ? "Close" : "Edit" });
    editBtn.addEventListener("click", () => {
      if (expandedTasks.has(taskId)) expandedTasks.delete(taskId);
      else expandedTasks.add(taskId);
      renderPanel();
    });

    actions.appendChild(upBtn);
    actions.appendChild(downBtn);
    actions.appendChild(editBtn);
    row.appendChild(actions);
    listWrap.appendChild(row);

    if (expandedTasks.has(taskId)) {
      listWrap.appendChild(
        buildTaskEditForm(taskId, () => {
          expandedTasks.delete(taskId);
          renderPanel();
        })
      );
    }
  });

  return listWrap;
}

function buildAddTaskForm(sectionId) {
  const wrap = el("div", { class: "task-edit-form" });
  const titleInput = el("input", { type: "text", placeholder: "New task title" });
  const typeSelect = el("select", {});
  ["text", "pdf", "image", "video"].forEach((t) => typeSelect.appendChild(el("option", { value: t, text: t })));

  const addBtn = el("button", { type: "button", class: "btn btn-primary", text: "+ Add task" });
  addBtn.addEventListener("click", () => {
    const title = titleInput.value.trim();
    if (!title) {
      statusMessage = "Enter a title before adding a task.";
      renderPanel();
      return;
    }
    const type = typeSelect.value;
    const id = uniqueId(slugify(title), draft.artifacts);
    const base = { sectionId, title, type, resources: [] };
    if (type === "text") Object.assign(base, { wordLimit: null, wordCount: 0, body: "" });
    if (type === "pdf") Object.assign(base, { description: "" });
    if (type === "image") Object.assign(base, { description: "" });
    if (type === "video") Object.assign(base, { durationNote: "", description: "" });

    draft.artifacts[id] = base;
    draft.sections[sectionId].tasks.push(id);
    saveDraft();
  });

  wrap.appendChild(el("div", { class: "field" }, [el("label", { text: "Add a task to this section" }), titleInput]));
  wrap.appendChild(el("div", { class: "field" }, [el("label", { text: "Type" }), typeSelect]));
  wrap.appendChild(addBtn);
  return wrap;
}

function buildCaptionEditor(sectionId) {
  const section = draft.sections[sectionId];
  if (!section.caption) return null;
  const artifact = draft.artifacts[section.caption.artifactId];
  if (!artifact) return null;
  const working = deepClone(artifact);
  working.resources = working.resources || [];

  const box = el("div", { class: "task-edit-form" });
  box.appendChild(el("h4", { text: "Caption" }));

  const modeSelect = el("select", {});
  ["text", "video"].forEach((m) => {
    const opt = el("option", { value: m, text: m === "text" ? "Text" : "Audio/visual clip" });
    if (working.mode === m) opt.setAttribute("selected", "selected");
    modeSelect.appendChild(opt);
  });
  modeSelect.addEventListener("change", () => {
    working.mode = modeSelect.value;
  });
  box.appendChild(el("div", { class: "field" }, [el("label", { text: "Format" }), modeSelect]));

  const bodyField = el("div", { class: "field" }, [
    el("label", { text: `Caption text (max ${section.caption.maxWords} words)` }),
    el("textarea", { text: working.body || "" }),
  ]);
  const bodyInput = bodyField.querySelector("textarea");
  bodyInput.addEventListener("input", () => (working.body = bodyInput.value));
  box.appendChild(bodyField);

  box.appendChild(buildResourceEditor(working.resources));

  const actions = el("div", { class: "btn-row" });
  const saveBtn = el("button", { type: "button", class: "btn btn-primary", text: "Save caption" });
  saveBtn.addEventListener("click", () => {
    draft.artifacts[section.caption.artifactId] = working;
    saveDraft();
  });
  actions.appendChild(saveBtn);
  box.appendChild(actions);

  return box;
}

function buildSectionGroup(sectionId) {
  const section = draft.sections[sectionId];
  const details = el("details", { class: "admin-section-group", open: expandedSections.has(sectionId) ? "open" : null });
  details.addEventListener("toggle", () => {
    if (details.open) expandedSections.add(sectionId);
    else expandedSections.delete(sectionId);
  });
  details.appendChild(el("summary", {}, [el("span", { text: `Section ${sectionId} — ${section.title}` })]));

  const body = el("div", { class: "admin-section-group__body" });

  const titleField = el("div", { class: "field" }, [el("label", { text: "Title" }), el("input", { type: "text", value: section.title })]);
  const titleInput = titleField.querySelector("input");
  const summaryField = el("div", { class: "field" }, [el("label", { text: "Summary" }), el("textarea", { text: section.summary })]);
  const summaryInput = summaryField.querySelector("textarea");
  const saveHeaderBtn = el("button", { type: "button", class: "btn", text: "Save section info" });
  saveHeaderBtn.addEventListener("click", () => {
    section.title = titleInput.value;
    section.summary = summaryInput.value;
    saveDraft();
  });

  body.appendChild(titleField);
  body.appendChild(summaryField);
  body.appendChild(saveHeaderBtn);

  const captionEditor = buildCaptionEditor(sectionId);
  if (captionEditor) body.appendChild(captionEditor);

  body.appendChild(el("h4", { text: "Tasks" }));
  body.appendChild(buildTaskList(sectionId));
  body.appendChild(buildAddTaskForm(sectionId));

  details.appendChild(body);
  return details;
}

/* ---------------------------------------------------------------------- */
/* Site info + export + password change                                    */
/* ---------------------------------------------------------------------- */

function buildSiteInfoForm() {
  const student = draft.site.student;
  const wrap = el("div", { class: "admin-section-group" });
  wrap.appendChild(el("div", {}, [el("span", { text: "Profile" })]));
  const body = el("div", { class: "admin-section-group__body" });

  const fields = [
    ["name", "Name", "text"],
    ["photo", "Photo URL (shown above the introduction on the home page)", "url"],
    ["discipline", "Subject specialization", "text"],
    ["institution", "Institution", "text"],
    ["course", "Course", "text"],
    ["programme", "Programme", "text"],
    ["introduction", "Introduction", "textarea"],
  ];

  const inputs = {};
  fields.forEach(([key, label, type]) => {
    const inputEl = type === "textarea" ? el("textarea", { text: student[key] || "" }) : el("input", { type, value: student[key] || "" });
    inputs[key] = inputEl;
    body.appendChild(el("div", { class: "field" }, [el("label", { text: label }), inputEl]));
    if (key === "photo") {
      body.appendChild(
        el("p", { class: "field-hint", text: "Any image URL works — a Google Drive share link, or a path like assets/images/photo.jpg. Leave blank to show no photo." })
      );
    }
  });

  const saveBtn = el("button", { type: "button", class: "btn btn-primary", text: "Save profile" });
  saveBtn.addEventListener("click", () => {
    fields.forEach(([key]) => (student[key] = inputs[key].value));
    saveDraft();
  });
  body.appendChild(saveBtn);

  wrap.appendChild(body);
  return wrap;
}

// Marks one file as published (draft now matches what you just downloaded)
// and persists the new baseline, so its "Needs export" badge clears.
function markExported(fileKey) {
  if (fileKey === "passwordHash") lastExported.passwordHash = effectiveHash;
  else lastExported[fileKey] = deepClone(draft[fileKey]);
  persistLastExported();
}

/* ---------------------------------------------------------------------- */
/* GitHub push (Contents API, called directly from the browser)            */
/* ---------------------------------------------------------------------- */

function loadGithubConfig() {
  try {
    const raw = localStorage.getItem(GITHUB_CONFIG_KEY);
    if (raw) return JSON.parse(raw);
  } catch (err) {
    /* ignore */
  }
  return { repo: "", branch: "main", token: "" };
}

function saveGithubConfig(cfg) {
  try {
    localStorage.setItem(GITHUB_CONFIG_KEY, JSON.stringify(cfg));
  } catch (err) {
    /* ignore */
  }
}

async function githubApi(path, options = {}) {
  const cfg = loadGithubConfig();
  return fetch(`https://api.github.com/repos/${cfg.repo}/${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${cfg.token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      ...(options.headers || {}),
    },
  });
}

async function testGithubConnection() {
  const cfg = loadGithubConfig();
  if (!cfg.repo || !cfg.token) throw new Error("Enter a repo (owner/name) and a token first.");
  const res = await fetch(`https://api.github.com/repos/${cfg.repo}`, {
    headers: {
      Authorization: `Bearer ${cfg.token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });
  if (res.status === 404) throw new Error(`Repo "${cfg.repo}" not found, or this token can't see it.`);
  if (res.status === 401) throw new Error("Token rejected (401) — it may be invalid, expired, or revoked.");
  if (!res.ok) throw new Error(`GitHub returned ${res.status} checking the repo.`);
  const info = await res.json();
  // NOTE: `permissions.push` reflects whether YOUR ACCOUNT has push access to
  // the repo — it does NOT confirm a fine-grained token's own Contents scope.
  // A token can fail this check as a hard "no", but passing it is not proof
  // a push will actually succeed; the real test is attempting one.
  if (info.permissions && !info.permissions.push) {
    throw new Error(`Connected, but your account does not have push access to ${cfg.repo} at all.`);
  }
  return info;
}

// Creates or updates one file in the repo via a single commit. GitHub's
// Contents API needs the current file's blob sha to update it (a plain
// create would conflict), so this reads it first.
async function pushFileToGithub(filePath, data, commitMessage) {
  const cfg = loadGithubConfig();
  if (!cfg.repo || !cfg.token) {
    throw new Error("Set your GitHub repo and token in “Push to GitHub” settings first.");
  }
  const branch = cfg.branch || "main";
  const content = utf8ToBase64(JSON.stringify(data, null, 2) + "\n");

  let sha;
  const getRes = await githubApi(`contents/${filePath}?ref=${encodeURIComponent(branch)}`);
  if (getRes.ok) {
    sha = (await getRes.json()).sha;
  } else if (getRes.status !== 404) {
    const body = await getRes.json().catch(() => ({}));
    throw new Error(`Could not read current ${filePath} (${getRes.status}): ${body.message || getRes.statusText}`);
  }

  const putRes = await githubApi(`contents/${filePath}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message: commitMessage, content, branch, ...(sha ? { sha } : {}) }),
  });
  if (!putRes.ok) {
    const body = await putRes.json().catch(() => ({}));
    throw new Error(`GitHub rejected the push for ${filePath} (${putRes.status}): ${body.message || putRes.statusText}`);
  }
  return putRes.json();
}

function buildGithubSettingsForm() {
  const cfg = loadGithubConfig();
  const wrap = el("div", { class: "admin-section-group" });
  wrap.appendChild(el("div", {}, [el("span", { text: "Push to GitHub" })]));
  const body = el("div", { class: "admin-section-group__body" });

  body.appendChild(
    el("div", { class: "admin-banner" }, [
      el("strong", { text: "This token is a real credential" }),
      el("span", {
        text:
          "It's stored only in this browser's localStorage and used to call GitHub's API directly — never written into any file that gets committed. " +
          "Use a fine-grained Personal Access Token scoped to ONLY this repository with “Contents: Read and write” permission, nothing broader. " +
          "Anyone with access to this browser profile could read it from storage, so forget it below when you're done on a shared machine.",
      }),
    ])
  );

  const repoInput = el("input", { type: "text", placeholder: "owner/repo, e.g. Cain12345/PGDE_Portfolio", value: cfg.repo });
  const branchInput = el("input", { type: "text", placeholder: "main", value: cfg.branch || "main" });
  const tokenInput = el("input", { type: "password", placeholder: "GitHub personal access token", value: cfg.token });
  const statusEl = el("p", { class: "field-hint" });

  body.appendChild(el("div", { class: "field" }, [el("label", { text: "Repository (owner/repo)" }), repoInput]));
  body.appendChild(el("div", { class: "field" }, [el("label", { text: "Branch" }), branchInput]));
  body.appendChild(el("div", { class: "field" }, [el("label", { text: "Personal access token" }), tokenInput]));
  body.appendChild(statusEl);

  const btnRow = el("div", { class: "btn-row" });
  const saveBtn = el("button", { type: "button", class: "btn btn-primary", text: "Save settings" });
  saveBtn.addEventListener("click", () => {
    if (!/^[^/\s]+\/[^/\s]+$/.test(repoInput.value.trim())) {
      statusEl.textContent = 'Repository should look like "owner/repo".';
      return;
    }
    saveGithubConfig({ repo: repoInput.value.trim(), branch: branchInput.value.trim() || "main", token: tokenInput.value });
    statusEl.textContent = "Saved for this browser.";
  });

  const testBtn = el("button", { type: "button", class: "btn", text: "Test connection" });
  testBtn.addEventListener("click", async () => {
    saveGithubConfig({ repo: repoInput.value.trim(), branch: branchInput.value.trim() || "main", token: tokenInput.value });
    statusEl.textContent = "Checking…";
    try {
      const info = await testGithubConnection();
      statusEl.textContent =
        `Connected to ${info.full_name}. Your account has push access — but for a fine-grained token, ` +
        `that alone doesn't guarantee the token's own Contents permission is set to "Read and write." ` +
        `A real push is the only full test.`;
    } catch (err) {
      statusEl.textContent = `Failed: ${err.message}`;
    }
  });

  const forgetBtn = el("button", { type: "button", class: "btn btn-danger", text: "Forget token" });
  forgetBtn.addEventListener("click", () => {
    saveGithubConfig({ repo: repoInput.value.trim(), branch: branchInput.value.trim() || "main", token: "" });
    tokenInput.value = "";
    statusEl.textContent = "Token cleared from this browser.";
  });

  btnRow.appendChild(saveBtn);
  btnRow.appendChild(testBtn);
  btnRow.appendChild(forgetBtn);
  body.appendChild(btnRow);

  wrap.appendChild(body);
  return wrap;
}

function buildExportSection() {
  const wrap = el("div", { class: "admin-section-group", id: "publish-section" });
  const dirty = computeDirtyFiles();
  const cfg = loadGithubConfig();
  const githubReady = Boolean(cfg.repo && cfg.token);
  wrap.appendChild(
    el("div", {}, [
      el("span", { text: "Publish" }),
      el("span", { class: "badge", text: dirty.length ? `${dirty.length} to export` : "All published" }),
    ])
  );
  const body = el("div", { class: "admin-section-group__body" });

  body.appendChild(
    el("p", {
      class: "field-hint",
      text: githubReady
        ? "“Push to GitHub” commits straight to your repo. “Download” is a manual fallback — replace the file in data/ yourself."
        : "Set up “Push to GitHub” below to publish with one click, or use Download and replace the file in data/ manually.",
    })
  );

  const pushStatusEl = el("p", { class: "field-hint" });
  if (lastPushResult) {
    pushStatusEl.appendChild(el("span", { text: `Committed ${lastPushResult.filename}: ` }));
    pushStatusEl.appendChild(
      el("a", { href: lastPushResult.url, target: "_blank", rel: "noopener", text: lastPushResult.sha.slice(0, 7) })
    );
  }

  const grid = el("div", { class: "export-grid" });
  const fileSpecs = [
    { filename: "site.json", key: "site", getData: () => draft.site },
    { filename: "sections.json", key: "sections", getData: () => draft.sections },
    { filename: "artifacts.json", key: "artifacts", getData: () => draft.artifacts },
    {
      filename: "admin-config.json",
      key: "passwordHash",
      getData: () => ({ passwordHash: effectiveHash, note: "SHA-256 hex digest — not secret, only gates the Admin UI." }),
    },
  ];

  async function pushOne(filename, key, getData) {
    const result = await pushFileToGithub(`data/${filename}`, getData(), `Update ${filename} via Admin panel`);
    markExported(key);
    return result;
  }

  fileSpecs.forEach(({ filename, key, getData }) => {
    const isDirty = dirty.includes(filename);
    const card = el("div", { class: `export-card${isDirty ? " export-card--dirty" : ""}` });
    card.appendChild(el("p", { text: filename }));
    card.appendChild(
      el("p", { class: `badge${isDirty ? " badge--warning" : ""}`, text: isDirty ? "Needs export" : "Up to date" })
    );

    const cardBtnRow = el("div", { class: "btn-row" });

    const pushBtn = el("button", {
      type: "button",
      class: `btn${isDirty ? " btn-primary" : ""}`,
      text: "Push to GitHub",
      disabled: githubReady ? null : "disabled",
    });
    pushBtn.addEventListener("click", async () => {
      pushBtn.disabled = true;
      pushBtn.textContent = "Pushing…";
      try {
        const result = await pushOne(filename, key, getData);
        lastPushResult = { filename, sha: result.commit.sha, url: result.commit.html_url };
        statusMessage = `Pushed ${filename} to ${cfg.repo}.`;
        renderPanel();
      } catch (err) {
        pushBtn.disabled = false;
        pushBtn.textContent = "Push to GitHub";
        pushStatusEl.textContent = `Failed to push ${filename}: ${err.message}`;
      }
    });
    cardBtnRow.appendChild(pushBtn);

    const downloadBtn = el("button", { type: "button", class: "btn", text: "Download" });
    downloadBtn.addEventListener("click", () => {
      downloadJSON(filename, getData());
      markExported(key);
      statusMessage = `Downloaded ${filename}. Replace it in data/${filename} to publish this change.`;
      renderPanel();
    });
    cardBtnRow.appendChild(downloadBtn);

    card.appendChild(cardBtnRow);
    grid.appendChild(card);
  });
  body.appendChild(grid);
  body.appendChild(pushStatusEl);

  const btnRow = el("div", { class: "btn-row" });
  if (dirty.length && githubReady) {
    const pushAllBtn = el("button", { type: "button", class: "btn btn-primary", text: `Push all ${dirty.length} changed file(s) to GitHub` });
    pushAllBtn.addEventListener("click", async () => {
      pushAllBtn.disabled = true;
      pushAllBtn.textContent = "Pushing…";
      const results = [];
      for (const { filename, key, getData } of fileSpecs) {
        if (!dirty.includes(filename)) continue;
        try {
          await pushOne(filename, key, getData);
          results.push(`${filename}: pushed`);
        } catch (err) {
          results.push(`${filename}: FAILED (${err.message})`);
        }
      }
      statusMessage = `Push to ${cfg.repo} finished — ${results.join("; ")}`;
      renderPanel();
    });
    btnRow.appendChild(pushAllBtn);
  }
  if (dirty.length) {
    const downloadAllBtn = el("button", { type: "button", class: "btn", text: `Download all ${dirty.length} changed file(s)` });
    downloadAllBtn.addEventListener("click", () => {
      fileSpecs.forEach(({ filename, key, getData }) => {
        if (!dirty.includes(filename)) return;
        downloadJSON(filename, getData());
        markExported(key);
      });
      statusMessage = "Downloaded all changed files. Replace them in data/ to publish.";
      renderPanel();
    });
    btnRow.appendChild(downloadAllBtn);
  }
  const discardBtn = el("button", { type: "button", class: "btn btn-danger", text: "Discard local draft & reload from live JSON" });
  discardBtn.addEventListener("click", discardDraft);
  btnRow.appendChild(discardBtn);
  body.appendChild(btnRow);

  wrap.appendChild(body);
  return wrap;
}

function buildPasswordForm() {
  const wrap = el("div", { class: "admin-section-group" });
  wrap.appendChild(el("div", {}, [el("span", { text: "Change admin password" })]));
  const body = el("div", { class: "admin-section-group__body" });

  const current = el("input", { type: "password" });
  const next = el("input", { type: "password" });
  const confirmInput = el("input", { type: "password" });
  const errorEl = el("p", { class: "field-error" });

  body.appendChild(el("div", { class: "field" }, [el("label", { text: "Current password" }), current]));
  body.appendChild(el("div", { class: "field" }, [el("label", { text: "New password" }), next]));
  body.appendChild(el("div", { class: "field" }, [el("label", { text: "Confirm new password" }), confirmInput]));
  body.appendChild(errorEl);

  const btn = el("button", { type: "button", class: "btn btn-primary", text: "Update password" });
  btn.addEventListener("click", async () => {
    const currentHash = await hashHex(current.value);
    if (currentHash !== effectiveHash) {
      errorEl.textContent = "Current password is incorrect.";
      return;
    }
    if (next.value.length < 6) {
      errorEl.textContent = "New password must be at least 6 characters.";
      return;
    }
    if (next.value !== confirmInput.value) {
      errorEl.textContent = "New passwords do not match.";
      return;
    }
    effectiveHash = await hashHex(next.value);
    setCachedHash(effectiveHash);
    statusMessage = "Password updated for this browser.";
    renderPanel();
  });
  body.appendChild(btn);

  wrap.appendChild(body);
  return wrap;
}

/* ---------------------------------------------------------------------- */
/* Panel / gate rendering                                                  */
/* ---------------------------------------------------------------------- */

function renderPanel() {
  const root = document.getElementById("admin-root");
  root.innerHTML = "";

  root.appendChild(
    el("div", { class: "admin-banner" }, [
      el("strong", { text: "Not secure authentication" }),
      el("span", {
        text:
          "This password lock only hides edit controls in your browser — it cannot stop someone using devtools, and it doesn't protect the content itself (the JSON is already public). Treat it as a convenience against accidental edits.",
      }),
    ])
  );

  const header = el("div", { class: "admin-panel__header" });
  header.appendChild(el("h1", { text: "Admin Panel" }));
  const exitBtn = el("a", { class: "btn", href: "index.html", text: "Exit Admin Mode" });
  exitBtn.addEventListener("click", clearAuthed);
  header.appendChild(exitBtn);
  root.appendChild(header);

  const dirtyFiles = computeDirtyFiles();
  if (dirtyFiles.length) {
    const banner = el("div", { class: "admin-banner admin-banner--dirty" }, [
      el("strong", { text: "Unpublished changes" }),
      el("span", { text: `These files differ from what's in data/ right now: ` }),
    ]);
    dirtyFiles.forEach((name, i) => {
      if (i > 0) banner.appendChild(el("span", { text: ", " }));
      banner.appendChild(el("code", { text: name }));
    });
    banner.appendChild(el("span", { text: ". " }));
    banner.appendChild(el("a", { href: "#publish-section", text: "Jump to Publish ↓" }));
    root.appendChild(banner);
  }

  if (statusMessage) {
    root.appendChild(el("p", { class: "field-hint", text: statusMessage }));
  }

  root.appendChild(buildSiteInfoForm());

  draft.site.sectionOrder.forEach((sectionId) => {
    root.appendChild(buildSectionGroup(sectionId));
  });

  root.appendChild(buildGithubSettingsForm());
  root.appendChild(buildExportSection());
  root.appendChild(buildPasswordForm());
}

function renderGate(mode, publishedPasswordHash) {
  const root = document.getElementById("admin-root");
  root.innerHTML = "";

  const wrap = el("div", { class: "admin-gate" });
  wrap.appendChild(el("h1", { text: mode === "setup" ? "Set Up Admin Access" : "Admin Login" }));
  wrap.appendChild(
    el("p", { class: "field-hint" , text:
      "This is a convenience lock for editing this static site's own JSON content, not a real authentication system — do not reuse a password you use elsewhere."
    })
  );

  const errorEl = el("p", { class: "field-error" });

  if (mode === "setup") {
    const p1 = el("input", { type: "password", placeholder: "Choose a password" });
    const p2 = el("input", { type: "password", placeholder: "Confirm password" });
    const btn = el("button", { type: "button", class: "btn btn-primary", text: "Set password & enter" });
    btn.addEventListener("click", async () => {
      if (p1.value.length < 6) {
        errorEl.textContent = "Use at least 6 characters.";
        return;
      }
      if (p1.value !== p2.value) {
        errorEl.textContent = "Passwords do not match.";
        return;
      }
      effectiveHash = await hashHex(p1.value);
      setCachedHash(effectiveHash);
      setAuthed();
      draft = await loadDraft();
      setupExportBaseline(publishedPasswordHash);
      statusMessage = "Admin password set for this browser.";
      renderPanel();
    });
    wrap.appendChild(el("div", { class: "field" }, [el("label", { text: "New password" }), p1]));
    wrap.appendChild(el("div", { class: "field" }, [el("label", { text: "Confirm password" }), p2]));
    wrap.appendChild(errorEl);
    wrap.appendChild(btn);
  } else {
    const pw = el("input", { type: "password", placeholder: "Password" });
    const btn = el("button", { type: "button", class: "btn btn-primary", text: "Enter Admin Mode" });
    const attempt = async () => {
      const hash = await hashHex(pw.value);
      if (hash === effectiveHash) {
        setAuthed();
        draft = await loadDraft();
        setupExportBaseline(publishedPasswordHash);
        renderPanel();
      } else {
        errorEl.textContent = "Incorrect password.";
      }
    };
    btn.addEventListener("click", attempt);
    pw.addEventListener("keydown", (e) => {
      if (e.key === "Enter") attempt();
    });
    wrap.appendChild(el("div", { class: "field" }, [el("label", { text: "Password" }), pw]));
    wrap.appendChild(errorEl);
    wrap.appendChild(btn);
  }

  root.appendChild(wrap);
}

/* ---------------------------------------------------------------------- */
/* Init                                                                     */
/* ---------------------------------------------------------------------- */

async function initAdmin() {
  const root = document.getElementById("admin-root");
  root.innerHTML = "<p>Loading…</p>";

  const config = await loadAdminConfig();
  const cached = getCachedHash();
  effectiveHash = config.passwordHash || cached || null;

  if (isAuthed() && effectiveHash) {
    draft = await loadDraft();
    setupExportBaseline(config.passwordHash);
    renderPanel();
  } else {
    clearAuthed();
    renderGate(effectiveHash ? "login" : "setup", config.passwordHash);
  }
}

initAdmin();
