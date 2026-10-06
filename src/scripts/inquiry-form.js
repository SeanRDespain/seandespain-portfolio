// The contact page inquiry form: shows the project-only questions when
// they apply, attaches attribution, submits to /api/inquiry, and only reports
// inquiry_submitted to GA4 after the server confirms the save.
import { getAttribution } from "./attribution.js";

const form = document.querySelector("[data-inquiry-form]");

if (form) {
  const status = form.querySelector("[data-inquiry-status]");
  const submit = form.querySelector("button[type=submit]");
  const projectOnly = form.querySelectorAll("[data-project-only]");
  form.elements.t.value = String(Date.now());

  const params = new URLSearchParams(location.search);
  const preset = params.get("type");
  if (preset && form.querySelector(`input[name=type][value="${preset}"]`)) form.querySelector(`input[name=type][value="${preset}"]`).checked = true;
  const result = params.get("inquiry");
  if (result === "error") showStatus("error", "That didn't send. Please try again, or email me at seandespain@gmail.com.");
  if (result === "busy") showStatus("error", "Too many messages from this connection. Please email me instead: seandespain@gmail.com.");

  function syncType() {
    const type = form.querySelector("input[name=type]:checked")?.value;
    projectOnly.forEach((el) => (el.hidden = type !== "project"));
  }
  form.addEventListener("change", (e) => {
    if (e.target.name === "type") syncType();
  });
  syncType();

  function showStatus(kind, text) {
    status.hidden = false;
    status.dataset.kind = kind;
    status.textContent = text;
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!form.reportValidity()) return;
    const data = Object.fromEntries(new FormData(form));
    data.attribution = getAttribution();
    submit.disabled = true;
    submit.textContent = "Sending…";
    status.hidden = true;
    try {
      const res = await fetch("/api/inquiry", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error?.message || "That didn't send.");
      if (typeof window.gtag === "function") window.gtag("event", "inquiry_submitted", { inquiry_type: data.type });
      form.reset();
      form.classList.add("is-sent");
      form.querySelector("[data-inquiry-sent]").hidden = false;
      form.querySelector("[data-inquiry-fields]").hidden = true;
      form.querySelector("[data-inquiry-sent]").focus();
    } catch (err) {
      showStatus("error", `${err.message} You can also email me at seandespain@gmail.com.`);
    } finally {
      submit.disabled = false;
      submit.textContent = "Send it";
    }
  });
}
