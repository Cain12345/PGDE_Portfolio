// Renders the profile header and the Table of Contents grid on index.html
// from data/site.json and data/sections.json.

async function renderHome() {
  const heroEl = document.getElementById("hero");
  const tocEl = document.getElementById("toc-grid");

  try {
    const [site, sections] = await Promise.all([
      fetchJSON("data/site.json"),
      fetchJSON("data/sections.json"),
    ]);

    const deadline = new Date(site.student.submissionDate);
    const deadlineLabel = deadline.toLocaleString(undefined, {
      dateStyle: "long",
      timeStyle: "short",
    });

    heroEl.innerHTML = `
      <p class="section-hero__eyebrow">${escapeHtml(site.student.programme)}</p>
      <h1>${escapeHtml(site.student.name)}</h1>
      <p class="meta">${escapeHtml(site.student.discipline)} &middot; ${escapeHtml(site.student.institution)}</p>
      <p>${escapeHtml(site.student.introduction)}</p>
      <div class="callout">
        <strong>${escapeHtml(site.student.course)}</strong> portfolio &mdash;
        submission due ${escapeHtml(deadlineLabel)}.
      </div>
    `;

    tocEl.innerHTML = "";
    site.sectionOrder.forEach((id) => {
      const section = sections[id];
      if (!section) return;
      const card = el("a", { class: "toc-card", href: section.page }, [
        el("span", { class: "toc-card__label", text: id, "aria-hidden": "true" }),
        el("span", { class: "toc-card__title", text: section.title }),
        el("span", { class: "toc-card__summary", text: section.summary }),
      ]);
      tocEl.appendChild(card);
    });
  } catch (err) {
    showLoadError(tocEl, err);
  }
}

renderHome();
