// Hero kinetic type: cycles the word in [data-pipeline-word] through the
// actual stages Sean runs on every venture. Function: shows the breadth
// claim in motion instead of stating it once. Reduced-motion users get the
// full static list instead (see the noscript-equivalent markup in index.astro).
const stages = ["Concept", "Brand", "UX", "Code", "Launch", "Operate"];
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
