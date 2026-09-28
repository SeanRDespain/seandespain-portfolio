// Capabilities page: clicking a capability highlights the real projects that
// prove it (data-projects="peace-life jarvis"), so the capability -> evidence
// relationship is something you click through, not just read.
const chips = document.querySelectorAll("[data-capability]");
const projectRows = document.querySelectorAll("[data-project-row]");

if (chips.length && projectRows.length) {
  chips.forEach((chip) => {
    chip.addEventListener("click", () => {
      const isActive = chip.classList.contains("is-active");
      chips.forEach((c) => c.classList.remove("is-active"));
      projectRows.forEach((r) => r.classList.remove("is-match", "is-dim"));

      if (isActive) return; // toggle off: clear filter

      chip.classList.add("is-active");
      const slugs = (chip.dataset.projects || "").split(/\s+/).filter(Boolean);
      projectRows.forEach((row) => {
        if (slugs.includes(row.dataset.projectRow)) {
          row.classList.add("is-match");
        } else {
          row.classList.add("is-dim");
        }
      });
    });
  });
}
