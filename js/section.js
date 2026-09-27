// Renders one portfolio section page from data/sections.json + data/artifacts.json.
// The page shell only needs <main data-section="B">; everything inside is built here.
// This is the read-only public view — it never shows edit controls. Admin editing
// lives entirely in admin.html / js/admin.js and only ever touches the JSON data.

function renderResource(resource) {
  if (resource.displayMode === "link") {
    return el("a", {
      class: "resource-link",
      href: resource.url,
      target: "_blank",
      rel: "noopener",
      text: `${resource.title} ↗`,
    });
  }

  const isDirectImage = /\.(png|jpe?g|gif|svg|webp)(\?.*)?$/i.test(resource.url) && resource.provider !== "google-drive";
  const box = el("div", { class: "doc-embed" });
  box.appendChild(
    el("div", { class: "doc-embed__toolbar" }, [
      el("span", { text: resource.title }),
      el("a", { href: resource.url, target: "_blank", rel: "noopener", text: "Open in new tab" }),
    ])
  );
  if (isDirectImage) {
    box.appendChild(el("img", { src: resource.url, alt: resource.title }));
  } else {
    box.appendChild(el("iframe", { src: resource.url, title: resource.title, loading: "lazy" }));
  }
  return box;
}

function renderResources(resources) {
  const frag = document.createDocumentFragment();
  (resources || []).forEach((resource) => frag.appendChild(renderResource(resource)));
  return frag;
}

function emptyResourceHint(type) {
  const hints = {
    pdf: "No document added yet.",
    image: "No image added yet.",
    video: "No video added yet.",
  };
  return el("div", { class: "placeholder-box", text: `${hints[type] || "No resource added yet."} Add one via Admin Mode.` });
}

function renderCaption(caption, artifact) {
  if (!caption) return null;
  const wrap = el("section", { class: "caption-block", "aria-label": "Section caption" });
  const limitLabel = caption.allowAV
    ? `Max ${caption.maxWords} words, or a ${caption.maxAvMinutes}-minute audio/visual clip`
    : `Max ${caption.maxWords} words`;
  wrap.appendChild(el("div", { class: "caption-block__label", text: `Caption (${limitLabel})` }));

  const hasResources = artifact.resources && artifact.resources.length > 0;

  if (artifact.mode === "video") {
    wrap.appendChild(hasResources ? renderResources(artifact.resources) : emptyResourceHint("video"));
  } else {
    const count = countWords(artifact.body);
    wrap.appendChild(el("p", { class: "task-card__body", text: artifact.body }));
    wrap.appendChild(
      el("p", {
        class: "word-count",
        text: `${count} / ${caption.maxWords} words`,
        "data-over": String(count > caption.maxWords),
      })
    );
    if (hasResources) wrap.appendChild(renderResources(artifact.resources));
  }
  return wrap;
}

function renderTaskCard(id, artifact) {
  const card = el("article", { class: "task-card", id });
  const header = el("div", { class: "task-card__header" }, [
    el("h3", { class: "task-card__title", text: artifact.title }),
  ]);

  if (artifact.type === "text" && artifact.wordLimit) {
    const count = countWords(artifact.body);
    header.appendChild(
      el("span", {
        class: "word-count",
        text: `${count} / ${artifact.wordLimit} words`,
        "data-over": String(count > artifact.wordLimit),
      })
    );
  }
  card.appendChild(header);

  if (artifact.strategy) {
    card.appendChild(el("p", { class: "task-card__meta", text: `Strategy: ${artifact.strategy}` }));
  }
  if (artifact.tools) {
    card.appendChild(el("p", { class: "task-card__meta", text: `Tools used: ${artifact.tools.join(", ")}` }));
  }
  if (artifact.durationNote) {
    card.appendChild(el("p", { class: "task-card__meta", text: `Target length: ${artifact.durationNote}` }));
  }

  const hasResources = artifact.resources && artifact.resources.length > 0;

  if (artifact.type === "text") {
    card.appendChild(el("p", { class: "task-card__body", text: artifact.body }));
    if (hasResources) card.appendChild(renderResources(artifact.resources));
  } else {
    if (artifact.description) card.appendChild(el("p", { class: "task-card__body", text: artifact.description }));
    card.appendChild(hasResources ? renderResources(artifact.resources) : emptyResourceHint(artifact.type));
  }

  return card;
}

async function renderSection() {
  const main = document.querySelector("main[data-section]");
  if (!main) return;
  const sectionId = main.getAttribute("data-section");

  const heroEl = document.getElementById("section-hero");
  const captionEl = document.getElementById("section-caption");
  const tasksEl = document.getElementById("task-list");
  const navEl = document.getElementById("section-nav");

  try {
    const [site, sections, artifacts] = await Promise.all([
      fetchJSON("data/site.json"),
      fetchJSON("data/sections.json"),
      fetchJSON("data/artifacts.json"),
    ]);

    const section = sections[sectionId];
    if (!section) throw new Error(`Unknown section "${sectionId}"`);

    document.title = `${section.title} — ${site.student.name}`;

    heroEl.innerHTML = "";
    heroEl.appendChild(el("p", { class: "section-hero__eyebrow", text: `Section ${sectionId}` }));
    heroEl.appendChild(el("h1", { text: section.title }));
    heroEl.appendChild(el("p", { class: "section-hero__summary", text: section.summary }));

    if (section.caption) {
      const captionArtifact = artifacts[section.caption.artifactId];
      const captionNode = renderCaption(section.caption, captionArtifact);
      if (captionNode) captionEl.appendChild(captionNode);
    }

    tasksEl.innerHTML = "";
    section.tasks.forEach((taskId) => {
      const artifact = artifacts[taskId];
      if (!artifact) {
        tasksEl.appendChild(el("div", { class: "placeholder-box", text: `Missing artifact: ${taskId}` }));
        return;
      }
      tasksEl.appendChild(renderTaskCard(taskId, artifact));
    });

    const order = site.sectionOrder;
    const index = order.indexOf(sectionId);
    const prevId = index > 0 ? order[index - 1] : null;
    const nextId = index < order.length - 1 ? order[index + 1] : null;

    navEl.innerHTML = "";
    navEl.appendChild(
      prevId
        ? el("a", { href: sections[prevId].page, text: `← Section ${prevId}: ${sections[prevId].title}` })
        : el("a", { href: "index.html", text: "← Table of Contents" })
    );
    navEl.appendChild(
      nextId
        ? el("a", { href: sections[nextId].page, text: `Section ${nextId}: ${sections[nextId].title} →` })
        : el("a", { href: "index.html", text: "Table of Contents →" })
    );
  } catch (err) {
    showLoadError(tasksEl, err);
  }
}

renderSection();
