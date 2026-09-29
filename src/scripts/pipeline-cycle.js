// Hero kinetic type: completes "Bring me the idea. I'll handle the ___" with
// each part of a project Sean covers, so the breadth shows in motion instead
// of being stated once. Reduced-motion users get the static first word, and
// no-JS users get the full list (see the noscript markup in index.astro).
const stages = ["strategy", "brand", "design", "code", "launch", "marketing"];
const el = document.querySelector("[data-pipeline-word]");
const prefersReduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

if (el && !prefersReduced) {
  let i = 0;
  const cycle = () => {
    el.style.opacity = "0";
    el.style.transform = "translateY(6px)";
    setTimeout(() => {
      i = (i + 1) % stages.length;
      el.textContent = stages[i];
      el.style.opacity = "1";
      el.style.transform = "none";
    }, 220);
  };
  el.style.transition = `opacity 220ms var(--ease-standard, ease), transform 220ms var(--ease-standard, ease)`;
  setInterval(cycle, 1600);
}
