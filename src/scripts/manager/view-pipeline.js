// Pipeline board and the opportunity record.
import { api, state, can, html, raw, mount, fmt, icon, pipeline, label } from "./lib.js";
import { newOpportunity, editOpportunity, moveStage, logInteraction, addTask, recordPayment, completeTask, editTask } from "./actions.js";
import { oppCard, stageBadge, flags, eventLine, taskRow } from "./view-shared.js";

export async function pipelineView(el, query) {
  const kind = query.get("kind") === "job" ? "job" : "project";
  const status = query.get("status") || "open";
  const q = query.get("q") || "";
  const source = query.get("source") || "";
  const focusStage = query.get("stage") || "";
  const p = pipeline(kind);
  const params = new URLSearchParams({ kind, status, ...(q ? { q } : {}), ...(source ? { source } : {}) });
  mount(el, html`<div class="mp-skel" style="height:360px"></div>`);
  const { items } = await api(`opportunities?${params}`);
  const set = (k, v) => {
    const next = new URLSearchParams(query);
    if (v) next.set(k, v);
    else next.delete(k);
    next.delete("stage");
    location.hash = `#/pipeline?${next}`;
  };

  const columns = status === "open" ? p.stages.filter((s) => s.type === "open" || (kind === "project" && s.key === "active")) : null;
  const total = can("finance.read") ? items.reduce((a, o) => a + (o.money?.value || 0), 0) : null;

  mount(el, html`
    <header class="mp-head">
      <div>
        <p class="mp-eyebrow">Pipeline</p>
        <h1>${kind === "project" ? html`Client <em>projects</em>` : html`Job <em>opportunities</em>`}</h1>
        <p class="mp-sub">${items.length} ${status === "all" ? "total" : status}${total ? html` · ${fmt.money(total, { compact: true })} ${kind === "project" ? "value" : "in compensation"}` : ""}${kind === "project" && items.some((o) => o.value?.basis === "inquiry_budget") ? " · * estimate from the inquiry's budget" : ""}</p>
      </div>
      ${can("crm.write") ? html`<button class="mp-btn mp-btn--primary" data-new>${icon.plus} New ${kind === "project" ? "project" : "opportunity"}</button>` : ""}
    </header>
    <nav class="mp-tabs" aria-label="Pipeline">
      <a href="#/pipeline?kind=project" aria-current="${kind === "project" ? "page" : "false"}">Client projects</a>
      <a href="#/pipeline?kind=job" aria-current="${kind === "job" ? "page" : "false"}">Job opportunities</a>
    </nav>
    <div class="mp-filters">
      <div class="mp-seg" role="group" aria-label="Status">${[["open", "Open"], ["won", kind === "project" ? "Won" : "Accepted"], ["lost", "Lost"], ["all", "All"]].map(([k, l]) => html`<button type="button" data-status="${k}" aria-pressed="${String(k === status)}">${l}</button>`)}</div>
      <input class="mp-input" type="search" placeholder="Filter by name or company" value="${q}" data-q aria-label="Filter">
      <select class="mp-select" data-source aria-label="Source"><option value="">All sources</option>${state.config.sources.map(([k, l]) => html`<option value="${k}"${k === source ? raw(" selected") : ""}>${l}</option>`)}</select>
    </div>
    ${!items.length
      ? html`<div class="mp-card mp-panel"><p class="mp-empty"><b>Nothing here yet.</b> ${kind === "project" ? "Website inquiries land here automatically. Add one you got by email or a referral with New project." : "Add roles you apply for, and recruiters who reach out, to see your job search in one place."}</p></div>`
      : columns
        ? html`<div class="mp-board">${columns.map((s) => {
            const here = items.filter((o) => o.stage === s.key);
            return html`<section class="mp-col" aria-label="${s.label}" data-empty="${here.length ? "false" : "true"}" ${focusStage === s.key ? raw('data-focus="true"') : ""}>
              <div class="mp-col__head"><b>${s.label}</b><span>${here.length}${can("finance.read") && here.length ? ` · ${fmt.money(here.reduce((a, o) => a + (o.money?.value || 0), 0), { compact: true })}` : ""}</span></div>
              ${here.map(oppCard)}
              ${!here.length ? html`<p class="mp-muted" style="font-size:12.5px;padding:2px 4px">${s.next || "Empty"}</p>` : ""}
            </section>`;
          })}</div>`
        : html`<div class="mp-people">${items.map(oppCard)}</div>`}
  `);

  el.querySelector("[data-new]")?.addEventListener("click", () => newOpportunity({ kind }));
  el.querySelectorAll("[data-status]").forEach((b) => b.addEventListener("click", () => set("status", b.dataset.status === "open" ? "" : b.dataset.status)));
  el.querySelector("[data-source]").addEventListener("change", (e) => set("source", e.target.value));
  let t;
  el.querySelector("[data-q]").addEventListener("input", (e) => {
    clearTimeout(t);
    t = setTimeout(() => set("q", e.target.value.trim()), 350);
  });
  el.querySelector("[data-focus]")?.scrollIntoView({ block: "nearest", inline: "center" });
}

function money(o) {
  if (!o.money) return "";
  const isProject = o.kind === "project";
  return html`<section class="mp-card mp-panel">
    <div class="mp-panel__head"><h2>${isProject ? "Money" : "Compensation"}</h2>${isProject && can("finance.write") && o.stageType !== "lost" ? html`<button data-pay>Record money</button>` : ""}</div>
    <div class="mp-money">
      <div><small>${isProject ? (o.value?.final != null ? "Agreed value" : "Estimated value") : o.value?.final != null ? "Offered" : "Expected"}</small><b>${fmt.money(o.money.value)}</b>${o.value?.basis === "inquiry_budget" && o.value?.final == null ? html`<small>From their budget range</small>` : ""}</div>
      ${isProject ? html`<div><small>Received</small><b>${fmt.money(o.money.received)}</b>${o.money.outstanding ? html`<small>${fmt.money(o.money.outstanding)} invoiced, not received</small>` : ""}</div>` : ""}
    </div>
    ${isProject && o.payments?.length
      ? html`<ul class="mp-list" style="margin-top:10px">${o.payments.slice().reverse().map((p) => html`<li class="mp-task" style="grid-template-columns:1fr auto"><span><span class="mp-task__title">${p.type === "received" ? "Payment received" : "Invoice sent"}</span><div class="mp-task__meta">${fmt.date(p.at)}${p.note ? ` · ${p.note}` : ""}</div></span><span class="mp-mono">${fmt.money(p.amount)}</span></li>`)}</ul>`
      : ""}
  </section>`;
}

export async function opportunityView(el, id) {
  mount(el, html`<div class="mp-skel" style="height:360px"></div>`);
  const { opportunity: o, contact, tasks, events } = await api(`opportunities/${id}`);
  const p = pipeline(o.kind);
  const idx = p.stages.findIndex((s) => s.key === o.stage);
  const a = o.attribution;
  const pages = (a?.pages || []).filter((x) => !x.startsWith("/contact"));
  const touch = (t) => {
    if (!t) return "-";
    const campaign = t.utm_source ? `${t.utm_source}${t.utm_medium ? ` / ${t.utm_medium}` : ""}${t.utm_campaign ? ` (${t.utm_campaign})` : ""}` : null;
    const parts = [campaign, t.referrer ? `from ${hostOf(t.referrer)}` : null, t.landing_page ? `landed on ${t.landing_page}` : null];
    return parts.filter(Boolean).join(", ") || "Direct";
  };

  mount(el, html`
    <header class="mp-head">
      <div>
        <a class="mp-back" href="#/pipeline?kind=${o.kind}">← ${p.label}</a>
        <h1>${o.title}</h1>
        <p class="mp-sub">${stageBadge(o)} ${flags(o)} ${contact ? html`· <a href="#/contact/${contact.id}">${contact.name}</a>` : ""}${o.company ? ` · ${o.company}` : ""} · ${label("sources", o.source)} · ${o.direction === "inbound" ? "they reached out" : "I reached out"} · ${fmt.rel(o.createdAt)}</p>
      </div>
      ${can("crm.write") ? html`<button class="mp-btn" data-edit>Edit</button>` : ""}
    </header>

    ${can("crm.write")
      ? html`<div class="mp-stepper" role="group" aria-label="Stage" style="margin-bottom:14px">${p.stages.map((s, i) => {
          const st = s.key === o.stage ? "current" : s.type !== "lost" && i < idx && o.stageType !== "lost" ? "done" : "todo";
          return html`<button class="mp-step" type="button" data-stage="${s.key}" data-state="${st}" data-type="${s.type}" ${st === "current" ? raw('aria-current="step"') : ""}>${s.label}</button>`;
        })}</div>
        <div class="mp-actions" style="margin-bottom:18px">
          <button class="mp-btn" data-log="email">${icon.mail} Log reply</button>
          <button class="mp-btn" data-log="call">${icon.phone} Log call</button>
          <button class="mp-btn" data-log="note">${icon.note} Note</button>
          <button class="mp-btn" data-task>${icon.plus} Task</button>
        </div>`
      : ""}

    <div class="mp-record">
      <div class="mp-grid">
        ${o.summary ? html`<section class="mp-card mp-panel"><div class="mp-panel__head"><h2>${o.direction === "inbound" && o.attribution ? "Their message" : "Summary"}</h2></div><p class="mp-msg">${o.summary}</p></section>` : ""}
        <section class="mp-card mp-panel">
          <div class="mp-panel__head"><h2>History</h2></div>
          ${events.length ? html`<ul class="mp-timeline">${events.map((e) => eventLine(e, { showLinks: false }))}</ul>` : html`<p class="mp-empty">No history yet.</p>`}
        </section>
      </div>
      <div class="mp-grid">
        <section class="mp-card mp-panel">
          <div class="mp-panel__head"><h2>Next steps</h2>${o.nextHint ? html`<span class="mp-muted" style="font-size:12.5px">${o.nextHint}</span>` : ""}</div>
          ${tasks.length ? html`<ul class="mp-list">${tasks.map((t) => taskRow({ ...t, overdue: t.status === "open" && t.dueAt && Date.parse(t.dueAt) < Date.now() }, { showRelated: false }))}</ul>` : html`<p class="mp-empty">No tasks. ${o.stageType === "open" ? "Add the next step so it doesn't stall." : ""}</p>`}
        </section>
        ${money(o)}
        <section class="mp-card mp-panel">
          <div class="mp-panel__head"><h2>Details</h2></div>
          <dl class="mp-facts">
            ${o.kind === "project"
              ? html`<div><dt>Service</dt><dd>${o.service ? label("services", o.service) : "Not set"}</dd></div>
                     <div><dt>Budget they gave</dt><dd>${o.budget ? label("budgets", o.budget) : "Not given"}</dd></div>
                     <div><dt>Timeline</dt><dd>${o.timeline ? label("timelines", o.timeline) : "Not given"}</dd></div>
                     <div><dt>Delivery due</dt><dd>${o.dueAt ? fmt.date(o.dueAt) : "Not set"}</dd></div>`
              : html`<div><dt>Type</dt><dd>${o.employment ? label("employment", o.employment) : "Not set"}</dd></div>
                     <div><dt>Posting</dt><dd>${o.link ? html`<a href="${o.link}" target="_blank" rel="noopener noreferrer">Open ↗</a>` : "None"}</dd></div>`}
            <div><dt>Expected decision</dt><dd>${o.expectedCloseAt ? fmt.date(o.expectedCloseAt) : "Not set"}</dd></div>
            <div><dt>In this stage</dt><dd>${o.daysInStage} day${o.daysInStage === 1 ? "" : "s"}</dd></div>
            ${o.lossReason ? html`<div><dt>Why it closed</dt><dd>${(p.lossReasons.find(([k]) => k === o.lossReason) || [, o.lossReason])[1]}</dd></div>` : ""}
          </dl>
        </section>
        ${a
          ? html`<section class="mp-card mp-panel">
              <div class="mp-panel__head"><h2>How they found you</h2></div>
              <dl class="mp-facts">
                <div><dt>First visit</dt><dd>${touch(a.first)}</dd></div>
                <div><dt>Latest visit</dt><dd>${touch(a.latest)}</dd></div>
              </dl>
              ${pages.length ? html`<p class="mp-sub" style="margin-top:12px">Read before reaching out:</p><p style="margin:4px 0 0;font-size:13.5px">${pages.map((x, i) => html`${i ? " → " : ""}<span class="mp-mono">${x}</span>`)}</p>` : ""}
            </section>`
          : ""}
      </div>
    </div>
  `);

  el.querySelector("[data-edit]")?.addEventListener("click", () => editOpportunity(o));
  el.querySelectorAll("[data-stage]").forEach((b) => b.addEventListener("click", () => b.dataset.stage !== o.stage && moveStage(o, b.dataset.stage)));
  el.querySelectorAll("[data-log]").forEach((b) => b.addEventListener("click", () => logInteraction({ opportunityId: o.id, type: b.dataset.log })));
  el.querySelector("[data-task]")?.addEventListener("click", () => addTask({ relatedType: "opportunity", relatedId: o.id, relatedLabel: o.title }));
  el.querySelector("[data-pay]")?.addEventListener("click", () => recordPayment(o));
  wireTaskButtons(el, tasks);
}

export function wireTaskButtons(el, tasks) {
  el.querySelectorAll("[data-task-toggle]").forEach((b) => b.addEventListener("click", () => completeTask(b.dataset.taskToggle, b.dataset.done ? "reopen" : "complete")));
  el.querySelectorAll("[data-task-approve]").forEach((b) => b.addEventListener("click", () => completeTask(b.dataset.taskApprove, "approve")));
  el.querySelectorAll("[data-task-dismiss]").forEach((b) => b.addEventListener("click", () => completeTask(b.dataset.taskDismiss, "dismiss")));
  el.querySelectorAll("[data-task-edit]").forEach((b) => b.addEventListener("click", () => editTask(tasks.find((x) => x.id === b.dataset.taskEdit))));
}

function hostOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}
