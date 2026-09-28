// Case-study chapter rail: highlights the active chapter as you scroll, and
// scroll-to's on click. This is the "build line" made literal on a project
// page: the same pipeline (problem -> thinking -> design -> build -> hard
// part -> outcome) that the homepage shows across five projects, applied to
// one. Function, not decoration: it's both navigation and a progress signal.
const rail = document.querySelector("[data-chapter-rail]");
const sections = document.querySelectorAll("[data-chapter]");
if (rail && sections.length) {
  const links = rail.querySelectorAll("a");
  const prefersReduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const setActive = (id) => {
    links.forEach((a) => a.classList.toggle("is-active", a.getAttribute("href") === `#${id}`));
  };

  const observer = new IntersectionObserver(
    (entries) => {
      const visible = entries.filter((e) => e.isIntersecting);
      if (visible.length) {
        visible.sort((a, b) => b.intersectionRatio - a.intersectionRatio);
        setActive(visible[0].target.id);
      }
    },
    { rootMargin: "-15% 0px -55% 0px", threshold: [0, 0.25, 0.5, 0.75, 1] }
  );
  sections.forEach((s) => observer.observe(s));

  rail.addEventListener("click", (e) => {
    const a = e.target.closest("a");
    if (!a) return;
    const id = a.getAttribute("href").slice(1);
    const target = document.getElementById(id);
    if (target) {
      e.preventDefault();
      target.scrollIntoView({ behavior: prefersReduced ? "auto" : "smooth", block: "start" });
      history.replaceState(null, "", `#${id}`);
    }
  });
}
