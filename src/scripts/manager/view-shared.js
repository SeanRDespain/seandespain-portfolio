// Small pieces several views share: timeline lines, cards, and task rows.
import { html, fmt, can, icon, state } from "./lib.js";

export function entityHref(entity) {
  if (!entity) return "#/overview";
  if (entity.type === "opportunity") return `#/opportunity/${entity.id}`;
  if (entity.type === "contact") return `#/contact/${entity.id}`;
  if (entity.type === "tasks") return "#/tasks?view=suggested";
  return "#/tasks";
}

const TONES = { opportunity_won: "won", project_completed: "won", payment_recorded: "won", opportunity_lost: "lost", form_submitted: "web" };

export function eventLine(e, { showLinks = true } = {}) {
  const label = state.config.eventTypes[e.type] || e.type;
  const href = e.opportunityId ? `#/opportunity/${e.opportunityId}` : e.contactId ? `#/contact/${e.contactId}` : null;
  const note = e.data?.note || (e.type === "form_submitted" ? e.data?.message : null);
  const by = e.actor === "website" ? "website" : e.actor === "system" ? "automatic" : e.actor?.startsWith("apikey:") ? "Jarvis" : null;
  return html`<li data-tone="${TONES[e.type] || ""}">
    <b>${label}</b> <small>${fmt.rel(e.at)}${by ? ` · ${by}` : ""}</small>
    <p>${showLinks && href ? html`<a href="${href}">${e.summary}</a>` : e.summary}</p>
    ${note ? html`<blockquote>${note}</blockquote>` : ""}
  </li>`;
}

export function stageBadge(o) {
  return html`<span class="mp-badge mp-badge--${o.stageType}">${o.stageLabel}</span>`;
}

export function flags(o) {
  return html`${o.awaitingReply ? html`<span class="mp-badge mp-badge--bad mp-badge--dot">Reply needed</span>` : ""}${o.stale ? html`<span class="mp-badge mp-badge--warn">Stalled ${o.daysInStage}d</span>` : ""}`;
}

export function oppCard(o) {
  const value = o.money ? (o.money.value ? fmt.money(o.money.value, { compact: true }) : "") : "";
  return html`<a class="mp-card mp-opp" href="#/opportunity/${o.id}">
    <span class="mp-opp__title">${o.title}</span>
    <span class="mp-opp__sub">${[o.contactName, o.company].filter(Boolean).join(" · ") || state.config.sources.find(([k]) => k === o.source)?.[1] || ""}</span>
    <span class="mp-opp__row"><span>${flags(o)}</span><span class="mp-opp__value">${value}${value && o.value?.basis === "inquiry_budget" ? "*" : ""}</span></span>
    ${o.nextTask
      ? html`<span class="mp-opp__next"><span>${o.nextTask.title}</span><span class="mp-due${Date.parse(o.nextTask.dueAt) < Date.now() ? " mp-due--overdue" : ""}">${fmt.due(o.nextTask.dueAt)}</span></span>`
      : o.stageType === "open"
        ? html`<span class="mp-opp__next mp-muted"><span>No next step set</span><span class="mp-due">${o.daysInStage}d here</span></span>`
        : ""}
  </a>`;
}

export function taskRow(t, { showRelated = true } = {}) {
  const done = t.status === "done";
  const suggested = t.status === "suggested";
  const rel = t.relatedType && t.relatedId ? { type: t.relatedType, id: t.relatedId } : null;
  return html`<li class="mp-task" data-done="${done ? "true" : "false"}">
    ${suggested
      ? html`<span class="mp-badge mp-badge--open">Suggested</span>`
      : html`<button class="mp-check" type="button" data-task-toggle="${t.id}" data-done="${done ? "1" : ""}" aria-pressed="${done ? "true" : "false"}" aria-label="${done ? "Reopen" : "Mark done"}: ${t.title}">${icon.check}</button>`}
    <span>
      <span class="mp-task__title">${t.title}</span>
      <div class="mp-task__meta">${[showRelated && t.related ? t.related : null, t.priority === "high" ? "High priority" : null, t.notes && suggested ? t.notes : null].filter(Boolean).join(" · ")}
        ${showRelated && rel ? html` <a href="${entityHref(rel)}">Open</a>` : ""}</div>
    </span>
    <span class="mp-actions" style="justify-content:flex-end">
      ${suggested && can("tasks.write")
        ? html`<button class="mp-btn mp-btn--small" data-task-approve="${t.id}">Approve</button><button class="mp-btn mp-btn--small" data-task-dismiss="${t.id}">Dismiss</button>`
        : html`<span class="mp-due${t.overdue ? " mp-due--overdue" : ""}">${done ? `Done ${fmt.rel(t.completedAt)}` : fmt.due(t.dueAt)}</span>${can("tasks.write") && !done ? html`<button class="mp-btn mp-btn--small mp-hide-phone" data-task-edit="${t.id}">Edit</button>` : ""}`}
    </span>
  </li>`;
}

export function avatar(name) {
  return html`<span class="mp-avatar" aria-hidden="true">${fmt.initials(name)}</span>`;
}
