// Reveal-on-scroll: adds .is-visible to [data-reveal] elements once, when they
// enter the viewport. Pure opacity/transform (see tokens.css), no layout cost.
// Respects prefers-reduced-motion by doing nothing (CSS already shows content).
// On the homepage's first load, it waits for the opening sequence (intro.js)
// to open the night before the hero copy rises in.
const prefersReduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

function start() {
  if (!prefersReduced && "IntersectionObserver" in window) {
    const els = document.querySelectorAll("[data-reveal]");
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            const delay = entry.target.dataset.revealDelay || 0;
            entry.target.style.transitionDelay = `${delay}ms`;
            entry.target.classList.add("is-visible");
            observer.unobserve(entry.target);
          }
        }
      },
      { threshold: 0.15, rootMargin: "0px 0px -8% 0px" }
    );
    els.forEach((el) => observer.observe(el));
  } else {
    document.querySelectorAll("[data-reveal]").forEach((el) => el.classList.add("is-visible"));
  }
}

if (document.documentElement.classList.contains("intro-active")) {
  let started = false;
  const go = () => {
    if (started) return;
    started = true;
    start();
  };
  document.addEventListener("intro:done", go, { once: true });
  setTimeout(go, 5000);
} else {
  start();
}
