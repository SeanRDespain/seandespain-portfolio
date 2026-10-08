// Pieces several views share: links, badges, timeline lines, task rows.
import { html, raw, fmt, can, icon, state, label, userName, isManager } from "./lib.js";

export function entityHref(entity) {
  if (!entity) return "#/overview";
  const map = { inquiry: "inquiry", opportunity: "opportunity", project: "project", contact: "contact" };
  return map[entity.type] ? `#/${map[entity.type]}/${entity.id}` : "#/calendar";
}

const TONES = { opportunity_won: "won", payment_recorded: "won", project_created: "won", opportunity_lost: "lost", record_archived: "lost", inquiry_received: "web" };

export function eventLine(e, { links = true } = {}) {
  const lbl = state.config.eventTypes[e.type] || e.type;
  const href = e.projectId ? `#/project/${e.projectId}` : e.opportunityId ? `#/opportunity/${e.opportunityId}` : e.inquiryId ? `#/inquiry/${e.inquiryId}` : e.contactId ? `#/contact/${e.contactId}` : null;
  const note = e.data?.note;
  const by = e.actor === "website" ? "website form" : e.actor === "system" ? "automatic" : userName(e.actor);
  return html`<li data-tone="${TONES[e.type] || ""}">
    <b>${lbl}</b> <small>${fmt.rel(e.at)} · ${by}</small>
    <p>${links && href ? html`<a href="${href}">${e.summary}</a>` : e.summary}</p>
    ${note ? html`<blockquote>${note}</blockquote>` : ""}
  </li>`;
}

export const testBadge = (r) => (r?.isTest ? html`<span class="mp-badge mp-badge--warn">Test record</span>` : "");
export const manualBadge = (r) => (r?.channel === "manual" ? html`<span class="mp-badge">Manual entry</span>` : r?.channel === "website_form" ? html`<span class="mp-badge mp-badge--open">Website form</span>` : "");

const INQ_TONE = { new: "bad", contacted: "open", converted: "won", not_a_fit: "lost", spam: "lost", closed: "lost" };
export const inquiryStatusBadge = (i) => html`<span class="mp-badge mp-badge--${INQ_TONE[i.status] || ""}${i.status === "new" ? " mp-badge--dot" : ""}">${label("inquiryStatuses", i.status)}</span>`;

export const stageBadge = (o) => html`<span class="mp-badge mp-badge--${o.stageType}">${o.stageLabel}</span>`;

const PAY = { paid: ["Paid", "won"], partial: ["Partly paid", "warn"], unpaid: ["Unpaid", "bad"], no_value: ["No value recorded", ""] };
export function paymentBadge(money) {
  if (!money) return "";
  const [l, tone] = PAY[money.status] || ["", ""];
  return html`<span class="mp-badge mp-badge--${tone}">${l}</span>`;
}

export function progress(done, total) {
  if (!total) return html`<span class="mp-muted" style="font-size:12.5px">No deliverables yet</span>`;
  return html`<span class="mp-progress" role="img" aria-label="${done} of ${total} deliverables done"><span style="width:${raw(((done / total) * 100).toFixed(0))}%"></span></span><span class="mp-mono">${done}/${total}</span>`;
}

export function taskRow(t, { showRelated = true } = {}) {
  const done = t.status === "done";
  const rel = t.relatedType && t.relatedId ? { type: t.relatedType, id: t.relatedId } : null;
  const mine = isManager() || t.assigneeId === state.me.user.id;
  return html`<li class="mp-task" data-done="${done ? "true" : "false"}">
    ${mine ? html`<button class="mp-check" type="button" data-task-toggle="${t.id}" data-done="${done ? "1" : ""}" aria-pressed="${done ? "true" : "false"}" aria-label="${done ? "Reopen" : "Mark done"}: ${t.title}">${icon.check}</button>` : html`<span></span>`}
    <span>
      <span class="mp-task__title">${t.title}</span>
      <div class="mp-task__meta">${[label("taskKinds", t.kind), showRelated && t.related ? t.related : null, t.assigneeId && t.assigneeId !== "owner" ? userName(t.assigneeId) : null, t.priority === "high" ? "High priority" : null].filter(Boolean).join(" · ")}${showRelated && rel ? html` · <a href="${entityHref(rel)}">Open</a>` : ""}</div>
    </span>
    <span class="mp-actions" style="justify-content:flex-end">
      <span class="mp-due${t.overdue ? " mp-due--overdue" : ""}">${done ? `Done ${fmt.rel(t.completedAt)}` : fmt.due(t.dueAt)}</span>
      ${isManager() && !done ? html`<button class="mp-btn mp-btn--small mp-hide-phone" data-task-edit="${t.id}">Edit</button>` : ""}
    </span>
  </li>`;
}

export function avatar(name) {
  return html`<span class="mp-avatar" aria-hidden="true">${fmt.initials(name)}</span>`;
}

export function wireTasks(el, tasks, { completeTask, editTask }) {
  el.querySelectorAll("[data-task-toggle]").forEach((b) => b.addEventListener("click", () => completeTask(b.dataset.taskToggle, b.dataset.done ? "reopen" : "complete")));
  el.querySelectorAll("[data-task-edit]").forEach((b) => b.addEventListener("click", () => editTask(tasks.find((x) => x.id === b.dataset.taskEdit))));
}

export function attribution(a) {
  if (!a) return html`<p class="mp-muted" style="margin:0;font-size:13.5px">Not captured (manual entry, or the browser blocked it).</p>`;
  const touch = (t) => {
    if (!t) return "Not captured";
    const camp = t.utm_source ? `${t.utm_source}${t.utm_medium ? ` / ${t.utm_medium}` : ""}${t.utm_campaign ? ` (${t.utm_campaign})` : ""}` : null;
    let host = null;
    try {
      host = t.referrer ? new URL(t.referrer).hostname.replace(/^www\./, "") : null;
    } catch {}
    return [camp, host ? `from ${host}` : null, t.landing_page ? `landed on ${t.landing_page}` : null].filter(Boolean).join(", ") || "Direct visit";
  };
  const pages = (a.pages || []).filter((x) => !x.startsWith("/contact"));
  return html`<dl class="mp-facts">
      <div><dt>First visit</dt><dd>${touch(a.first)}</dd></div>
      <div><dt>Latest visit</dt><dd>${touch(a.latest)}</dd></div>
    </dl>
    ${pages.length ? html`<p class="mp-sub" style="margin-top:10px">Read before reaching out: ${pages.map((x, i) => html`${i ? " → " : ""}<span class="mp-mono">${x}</span>`)}</p>` : ""}`;
}

export { can };
