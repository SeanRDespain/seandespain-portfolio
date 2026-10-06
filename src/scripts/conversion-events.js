// The few visitor actions worth measuring in GA4, named exactly as Jarvis's
// analytics registry expects for seandespain.com. Only intent signals, never
// personal data, and no generic button-click tracking.
//   email_clicked         an email link or "Copy my email"
//   contact_clicked       LinkedIn (the other way people reach out)
//   resume_downloaded     the PDF or Word resume
//   live_project_clicked  a "Live site" / "App Store" link on a case study
// inquiry_submitted is sent by the inquiry form itself after a real save.
function send(name, params) {
  if (typeof window.gtag === "function") window.gtag("event", name, params);
}

document.addEventListener(
  "click",
  (e) => {
    const el = e.target.closest("a, button");
    if (!el) return;
    const where = location.pathname;
    if (el.matches("[data-copy-email]")) return send("email_clicked", { method: "copy", page_path: where });
    const href = el.getAttribute("href") || "";
    if (href.startsWith("mailto:")) return send("email_clicked", { method: "mailto", page_path: where });
    if (href.includes("linkedin.com/")) return send("contact_clicked", { method: "linkedin", page_path: where });
    if (href.startsWith("/resume/")) return send("resume_downloaded", { file_format: href.split(".").pop(), page_path: where });
    if (el.dataset.liveProject) return send("live_project_clicked", { project: el.dataset.liveProject, page_path: where });
  },
  { capture: true },
);
