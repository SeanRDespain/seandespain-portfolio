// Inquiries & Opportunities: inquiries, client work, employment, contacts,
// and the record page for each.
import { api, state, can, html, raw, mount, fmt, icon, label, oppType, userName } from "./lib.js";
import {
  newInquiry, setInquiryStatus, convertInquiry, newOpportunity, editOpportunity, moveStage, createProjectFrom, logInteraction, addTask,
  completeTask, editTask,
} from "./actions.js";
import { eventLine, taskRow, wireTasks, inquiryStatusBadge, stageBadge, testBadge, manualBadge, avatar, attribution } from "./view-shared.js";

const TABS = [["inquiries", "Inquiries"], ["client", "Client work"], ["employment", "Employment"], ["contacts", "Contacts"]];

function setQuery(query, base, k, val) {
  const next = new URLSearchParams(query);
  if (val) next.set(k, val);
  else next.delete(k);
  location.hash = `#/${base}?${next}`;
}

export async function inquiriesView(el, query) {
  const tab = TABS.some(([k]) => k === query.get("tab")) ? query.get("tab") : "inquiries";
  const q = query.get("q") || "";
  mount(el, html`<div class="mp-skel" style="height:360px"></div>`);
  const head = html`<header class="mp-head">
      <div><p class="mp-eyebrow">Inquiries & opportunities</p><h1>${tab === "employment" ? html`Employment <em>opportunities</em>` : tab === "client" ? html`Client <em>work</em>` : tab === "contacts" ? html`Everyone you <em>work with</em>` : html`Inquiries <em>and leads</em>`}</h1></div>
      ${can("records.write") ? html`<button class="mp-btn mp-btn--primary" data-new>${icon.plus} ${tab === "client" ? "Client opportunity" : tab === "employment" ? "Employment opportunity" : tab === "contacts" ? "Inquiry" : "Log an inquiry"}</button>` : ""}
    </header>
    <nav class="mp-tabs" aria-label="Sections">${TABS.map(([k, l]) => html`<a href="#/inquiries?tab=${k}" aria-current="${k === tab ? "page" : "false"}">${l}</a>`)}</nav>`;

  let body;
  if (tab === "inquiries") {
    const status = query.get("status") || "open";
    const type = query.get("type") || "";
    const { items } = await api(`inquiries?${new URLSearchParams({ status, ...(type ? { type } : {}), ...(q ? { q } : {}) })}`);
    body = html`<div class="mp-filters">
        <div class="mp-seg" role="group" aria-label="Status">${[["open", "Open"], ["converted", "Converted"], ["closed", "Closed"], ["all", "All"]].map(([k, l]) => html`<button type="button" data-set="status" data-val="${k}" aria-pressed="${String(k === status)}">${l}</button>`)}</div>
        <select class="mp-select" data-filter="type" aria-label="Type"><option value="">All types</option>${state.config.inquiryTypes.map(([k, l]) => html`<option value="${k}"${k === type ? raw(" selected") : ""}>${l}</option>`)}</select>
        <input class="mp-input" type="search" placeholder="Search" value="${q}" data-q aria-label="Search inquiries">
      </div>
      ${items.length
        ? html`<div class="mp-grid">${items.map((i) => html`<a class="mp-card mp-row" href="#/inquiry/${i.id}">
            <span class="mp-row__main">
              <span class="mp-row__title">${i.contactName}${i.organization ? html` <span class="mp-muted">· ${i.organization}</span>` : ""}</span>
              <span class="mp-row__meta">${inquiryStatusBadge(i)} <span class="mp-badge">${label("inquiryTypes", i.type)}</span>${i.service ? html` <span class="mp-badge">${label("services", i.service)}</span>` : ""} ${manualBadge(i)} ${testBadge(i)}</span>
              ${i.messagePreview ? html`<span class="mp-row__text">${i.messagePreview}</span>` : ""}
            </span>
            <span class="mp-row__side"><span class="mp-mono">${fmt.rel(i.createdAt)}</span><span class="mp-muted" style="font-size:12.5px">${label("sources", i.source)}</span>${i.nextFollowUpAt ? html`<span class="mp-due${Date.parse(i.nextFollowUpAt) < Date.now() ? " mp-due--overdue" : ""}">Follow up ${fmt.due(i.nextFollowUpAt)}</span>` : ""}</span>
          </a>`)}</div>`
        : html`<div class="mp-card mp-panel"><p class="mp-empty"><b>No ${status === "all" ? "" : status} inquiries.</b> Website form submissions land here automatically. Use "Log an inquiry" for ones that arrive by email or LinkedIn.</p></div>`}`;
  } else if (tab === "contacts") {
    const { items } = await api(`contacts?${new URLSearchParams(q ? { q } : {})}`);
    body = html`<div class="mp-filters"><input class="mp-input" type="search" placeholder="Search name, email, organization" value="${q}" data-q aria-label="Search contacts" style="flex:1;min-width:200px"></div>
      ${items.length
        ? html`<div class="mp-people">${items.map((c) => html`<a class="mp-card mp-person" href="#/contact/${c.id}">${avatar(c.name)}<span><b>${c.name}</b><small>${[c.title, c.company].filter(Boolean).join(" · ") || label("contactTypes", c.type)}</small><small style="margin-top:4px">${c.inquiries} inquir${c.inquiries === 1 ? "y" : "ies"} · ${c.opportunities} opportunit${c.opportunities === 1 ? "y" : "ies"}${c.lastInteractionAt ? ` · last contact ${fmt.rel(c.lastInteractionAt)}` : ""}</small></span></a>`)}</div>`
        : html`<div class="mp-card mp-panel"><p class="mp-empty">No contacts yet.</p></div>`}`;
  } else {
    const type = tab;
    const status = query.get("status") || "open";
    const { items } = await api(`opportunities?${new URLSearchParams({ type, status, ...(q ? { q } : {}) })}`);
    const t = oppType(type);
    const cols = status === "open" ? t.stages.filter((s) => s.type === "open") : null;
    const card = (o) => html`<a class="mp-card mp-opp" href="#/opportunity/${o.id}">
      <span class="mp-opp__title">${o.title}</span>
      <span class="mp-opp__sub">${[o.contactName, type === "client" ? o.organization : null].filter(Boolean).join(" · ") || label("sources", o.source)}</span>
      <span class="mp-opp__row"><span>${testBadge(o)}${o.applicationUrl ? html`<span class="mp-badge">Application link</span>` : ""}</span><span class="mp-opp__value">${o.quote ? fmt.money(o.quote.amount, { compact: true }) : ""}</span></span>
      ${o.nextTask ? html`<span class="mp-opp__next"><span>${o.nextTask.title}</span><span class="mp-due${Date.parse(o.nextTask.dueAt) < Date.now() ? " mp-due--overdue" : ""}">${fmt.due(o.nextTask.dueAt)}</span></span>` : o.nextAction ? html`<span class="mp-opp__next"><span>${o.nextAction}</span></span>` : o.stageType === "open" ? html`<span class="mp-opp__next mp-muted"><span>No next step set</span><span class="mp-due">${o.daysInStage}d here</span></span>` : html`<span class="mp-opp__next"><span>${o.stageLabel}</span><span class="mp-due">${fmt.date(o.closedAt)}</span></span>`}
    </a>`;
    body = html`<div class="mp-filters">
        <div class="mp-seg" role="group" aria-label="Status">${[["open", "Open"], ["won", type === "client" ? "Won" : "Accepted"], ["lost", type === "client" ? "Lost" : "Closed"], ["all", "All"]].map(([k, l]) => html`<button type="button" data-set="status" data-val="${k}" aria-pressed="${String(k === status)}">${l}</button>`)}</div>
        <input class="mp-input" type="search" placeholder="Search" value="${q}" data-q aria-label="Search">
      </div>
      ${!items.length
        ? html`<div class="mp-card mp-panel"><p class="mp-empty"><b>Nothing here yet.</b> ${type === "client" ? "Convert a client inquiry, or add an opportunity that came another way." : "Add roles you apply for and recruiters who reach out. They stay separate from client work."}</p></div>`
        : cols
          ? html`<div class="mp-board">${cols.map((s) => {
              const here = items.filter((o) => o.stage === s.key);
              return html`<section class="mp-col" data-empty="${here.length ? "false" : "true"}" aria-label="${s.label}"><div class="mp-col__head"><b>${s.label}</b><span>${here.length}${type === "client" && can("money.read") && here.some((o) => o.quote) ? ` · ${fmt.money(here.reduce((x, o) => x + (o.quote?.amount || 0), 0), { compact: true })}` : ""}</span></div>${here.map(card)}${here.length ? "" : html`<p class="mp-muted" style="font-size:12.5px;padding:2px 4px">${s.next}</p>`}</section>`;
            })}</div>`
          : html`<div class="mp-people">${items.map(card)}</div>`}`;
  }

  mount(el, html`${head}${body}`);
  el.querySelector("[data-new]")?.addEventListener("click", () => (tab === "client" || tab === "employment" ? newOpportunity(tab) : newInquiry()));
  el.querySelectorAll("[data-set]").forEach((b) => b.addEventListener("click", () => setQuery(query, "inquiries", b.dataset.set, b.dataset.val === "open" ? "" : b.dataset.val)));
  el.querySelectorAll("[data-filter]").forEach((s) => s.addEventListener("change", () => setQuery(query, "inquiries", s.dataset.filter, s.value)));
  let timer;
  el.querySelector("[data-q]")?.addEventListener("input", (e) => {
    clearTimeout(timer);
    timer = setTimeout(() => setQuery(query, "inquiries", "q", e.target.value.trim()), 350);
  });
}

// ---------- one inquiry ----------

export async function inquiryView(el, id) {
  mount(el, html`<div class="mp-skel" style="height:360px"></div>`);
  const { inquiry: i, contact: c, opportunity, tasks, events } = await api(`inquiries/${id}`);
  const open = i.status === "new" || i.status === "contacted";
  mount(el, html`
    <header class="mp-head">
      <div>
        <a class="mp-back" href="#/inquiries">← Inquiries</a>
        <h1>${i.contactName}${i.organization ? html` <em>· ${i.organization}</em>` : ""}</h1>
        <p class="mp-sub">${inquiryStatusBadge(i)} <span class="mp-badge">${label("inquiryTypes", i.type)}</span> ${manualBadge(i)} ${testBadge(i)} · received ${fmt.dateTime(i.createdAt)}${i.owner && i.owner !== "owner" ? ` · owner ${userName(i.owner)}` : ""}</p>
      </div>
    </header>
    ${can("records.write")
      ? html`<div class="mp-actions" style="margin-bottom:18px">
          ${c?.email ? html`<a class="mp-btn" href="mailto:${c.email}">${icon.mail} Email them</a>` : ""}
          <button class="mp-btn" data-log="email">Log reply</button>
          <button class="mp-btn" data-log="call">${icon.phone} Log call</button>
          <button class="mp-btn" data-follow>${icon.plus} Follow-up</button>
          <button class="mp-btn" data-log="note">${icon.note} Note</button>
          ${open ? html`<button class="mp-btn mp-btn--primary" data-convert="client">Convert to client work</button><button class="mp-btn mp-btn--primary" data-convert="employment">Convert to employment</button>` : ""}
          ${i.status === "new" ? html`<button class="mp-btn" data-status="contacted">Mark contacted</button>` : ""}
          ${open ? html`<button class="mp-btn" data-status="not_a_fit">Not a fit</button><button class="mp-btn" data-status="spam">Spam</button>` : ""}
          ${!open && i.status !== "converted" ? html`<button class="mp-btn" data-status="contacted">Reopen</button>` : ""}
        </div>`
      : ""}
    ${opportunity ? html`<div class="mp-card mp-panel" style="margin-bottom:16px">Converted to <a href="#/opportunity/${opportunity.id}"><b>${opportunity.title}</b></a> · ${stageBadge(opportunity)}</div>` : ""}
    <div class="mp-record">
      <div class="mp-grid">
        <section class="mp-card mp-panel"><div class="mp-panel__head"><h2>Their message</h2><span class="mp-muted" style="font-size:12.5px">Private</span></div>${i.message ? html`<p class="mp-msg">${i.message}</p>` : html`<p class="mp-empty">No message recorded.</p>`}</section>
        <section class="mp-card mp-panel"><div class="mp-panel__head"><h2>History</h2></div>${events.length ? html`<ul class="mp-timeline">${events.map((e) => eventLine(e, { links: false }))}</ul>` : html`<p class="mp-empty">No history yet.</p>`}</section>
      </div>
      <div class="mp-grid">
        <section class="mp-card mp-panel"><div class="mp-panel__head"><h2>Follow-ups</h2></div>${tasks.length ? html`<ul class="mp-list">${tasks.map((t) => taskRow({ ...t, overdue: t.status === "open" && Date.parse(t.dueAt) < Date.now() }, { showRelated: false }))}</ul>` : html`<p class="mp-empty">No follow-up scheduled.</p>`}</section>
        <section class="mp-card mp-panel"><div class="mp-panel__head"><h2>Request</h2></div>
          <dl class="mp-facts">
            <div><dt>Type</dt><dd>${label("inquiryTypes", i.type)}</dd></div>
            <div><dt>Service</dt><dd>${i.service ? label("services", i.service) : "Not given"}</dd></div>
            ${i.type === "client_work" ? html`<div><dt>Budget</dt><dd>${i.budget ? label("budgets", i.budget) : "Not given"}</dd></div><div><dt>Timeline</dt><dd>${i.timeline ? label("timelines", i.timeline) : "Not given"}</dd></div>` : ""}
            <div><dt>How they found you</dt><dd>${i.heard ? label("heardAbout", i.heard) : "Not given"}</dd></div>
            <div><dt>First reply</dt><dd>${i.firstResponseAt ? fmt.dateTime(i.firstResponseAt) : "Not yet"}</dd></div>
          </dl>
        </section>
        <section class="mp-card mp-panel"><div class="mp-panel__head"><h2>Source</h2><span class="mp-badge">${label("sources", i.source)}</span></div>${attribution(i.attribution)}</section>
        ${c ? html`<section class="mp-card mp-panel"><div class="mp-panel__head"><h2>Contact</h2><a href="#/contact/${c.id}">Open</a></div><dl class="mp-facts"><div><dt>Email</dt><dd>${c.email || "None"}</dd></div><div><dt>Phone</dt><dd>${c.phone || "None"}</dd></div></dl></section>` : ""}
      </div>
    </div>
  `);
  el.querySelectorAll("[data-log]").forEach((b) => b.addEventListener("click", () => logInteraction("inquiry", i.id, b.dataset.log)));
  el.querySelector("[data-follow]")?.addEventListener("click", () => addTask({ relatedType: "inquiry", relatedId: i.id, relatedLabel: i.contactName, title: `Follow up with ${i.contactName}` }));
  el.querySelectorAll("[data-convert]").forEach((b) => b.addEventListener("click", () => convertInquiry(i, b.dataset.convert)));
  el.querySelectorAll("[data-status]").forEach((b) => b.addEventListener("click", () => setInquiryStatus(i, b.dataset.status)));
  wireTasks(el, tasks, { completeTask, editTask });
}

// ---------- one opportunity ----------

export async function opportunityView(el, id) {
  mount(el, html`<div class="mp-skel" style="height:360px"></div>`);
  const { opportunity: o, contact: c, inquiry, project, tasks, events } = await api(`opportunities/${id}`);
  const t = oppType(o.type);
  const idx = t.stages.findIndex((s) => s.key === o.stage);
  const client = o.type === "client";
  mount(el, html`
    <header class="mp-head">
      <div>
        <a class="mp-back" href="#/inquiries?tab=${o.type}">← ${t.label}</a>
        <h1>${o.title}</h1>
        <p class="mp-sub">${stageBadge(o)} <span class="mp-badge">${client ? "Client work" : "Employment · not a sale"}</span> ${testBadge(o)} ${o.channel === "manual" ? html`<span class="mp-badge">Manual entry</span>` : ""} ${c ? html`· <a href="#/contact/${c.id}">${c.name}</a>` : ""} · ${label("sources", o.source)} · ${o.daysInStage}d in stage</p>
      </div>
      ${can("records.write") ? html`<button class="mp-btn" data-edit>Edit</button>` : ""}
    </header>
    ${can("records.write")
      ? html`<div class="mp-stepper" role="group" aria-label="Stage" style="margin-bottom:14px">${t.stages.map((s, n) => {
          const st = s.key === o.stage ? "current" : s.type !== "lost" && n < idx && o.stageType !== "lost" ? "done" : "todo";
          return html`<button class="mp-step" type="button" data-stage="${s.key}" data-state="${st}" data-type="${s.type}" ${st === "current" ? raw('aria-current="step"') : ""}>${s.label}</button>`;
        })}</div>
        <div class="mp-actions" style="margin-bottom:18px">
          <button class="mp-btn" data-log="email">${icon.mail} Log email</button>
          <button class="mp-btn" data-log="note">${icon.note} Note</button>
          <button class="mp-btn" data-task="follow_up">${icon.plus} Follow-up</button>
          ${client ? html`<button class="mp-btn" data-task="appointment">${icon.calendar} Appointment</button>` : html`<button class="mp-btn" data-task="interview">${icon.calendar} Schedule interview</button>`}
          ${client && o.stage === "won" && !o.projectId ? html`<button class="mp-btn mp-btn--primary" data-project>Start the project</button>` : ""}
        </div>`
      : ""}
    <div class="mp-record">
      <div class="mp-grid">
        ${inquiry?.message ? html`<section class="mp-card mp-panel"><div class="mp-panel__head"><h2>Original inquiry</h2><a href="#/inquiry/${inquiry.id}">Open</a></div><p class="mp-msg">${inquiry.message}</p></section>` : ""}
        <section class="mp-card mp-panel"><div class="mp-panel__head"><h2>History</h2></div>${events.length ? html`<ul class="mp-timeline">${events.map((e) => eventLine(e, { links: false }))}</ul>` : html`<p class="mp-empty">No history yet.</p>`}</section>
      </div>
      <div class="mp-grid">
        <section class="mp-card mp-panel"><div class="mp-panel__head"><h2>Next steps</h2>${o.nextHint ? html`<span class="mp-muted" style="font-size:12.5px">${o.nextHint}</span>` : ""}</div>
          ${o.nextAction ? html`<p style="margin:0 0 10px"><b>Next action:</b> ${o.nextAction}</p>` : ""}
          ${tasks.length ? html`<ul class="mp-list">${tasks.map((x) => taskRow({ ...x, overdue: x.status === "open" && Date.parse(x.dueAt) < Date.now() }, { showRelated: false }))}</ul>` : html`<p class="mp-empty">Nothing scheduled.</p>`}
        </section>
        <section class="mp-card mp-panel"><div class="mp-panel__head"><h2>Details</h2></div>
          <dl class="mp-facts">
            ${client
              ? html`<div><dt>Service</dt><dd>${o.service ? label("services", o.service) : "Not set"}</dd></div>
                     ${can("money.read") ? html`<div><dt>Quote</dt><dd>${o.quote ? fmt.money(o.quote.amount) : "Not quoted yet"}</dd></div>` : ""}
                     <div><dt>Proposal sent</dt><dd>${o.proposalSentAt ? fmt.date(o.proposalSentAt) : "Not yet"}</dd></div>
                     <div><dt>Project</dt><dd>${project ? html`<a href="#/project/${project.id}">${project.title}</a>` : "Not started"}</dd></div>`
              : html`<div><dt>Employer</dt><dd>${o.organization || "Not set"}</dd></div>
                     <div><dt>Role</dt><dd>${o.role || "Not set"}</dd></div>
                     <div><dt>Type</dt><dd>${o.employmentType ? label("employmentTypes", o.employmentType) : "Not set"}</dd></div>
                     <div><dt>Applied</dt><dd>${o.appliedAt ? fmt.date(o.appliedAt) : "Not yet"}</dd></div>
                     <div><dt>Application</dt><dd>${o.applicationUrl ? html`<a href="${o.applicationUrl}" target="_blank" rel="noopener noreferrer">Open link ↗</a>` : "No link"}</dd></div>`}
            <div><dt>Expected decision</dt><dd>${o.expectedDecisionAt ? fmt.date(o.expectedDecisionAt) : "Not set"}</dd></div>
            ${o.lossReason ? html`<div><dt>Why it closed</dt><dd>${(t.lossReasons.find(([k]) => k === o.lossReason) || [0, o.lossReason])[1]}</dd></div>` : ""}
          </dl>
        </section>
        ${inquiry ? html`<section class="mp-card mp-panel"><div class="mp-panel__head"><h2>Source</h2><span class="mp-badge">${label("sources", inquiry.source)}</span></div>${attribution(inquiry.attribution)}</section>` : ""}
      </div>
    </div>
  `);
  el.querySelector("[data-edit]")?.addEventListener("click", () => editOpportunity(o));
  el.querySelectorAll("[data-stage]").forEach((b) => b.addEventListener("click", () => b.dataset.stage !== o.stage && moveStage(o, b.dataset.stage)));
  el.querySelectorAll("[data-log]").forEach((b) => b.addEventListener("click", () => logInteraction("opportunity", o.id, b.dataset.log)));
  el.querySelectorAll("[data-task]").forEach((b) => b.addEventListener("click", () => addTask({ relatedType: "opportunity", relatedId: o.id, relatedLabel: o.title, kind: b.dataset.task, title: b.dataset.task === "interview" ? `Interview: ${o.title}` : b.dataset.task === "appointment" ? `Meeting: ${o.title}` : `Follow up: ${o.title}` })));
  el.querySelector("[data-project]")?.addEventListener("click", () => createProjectFrom(o));
  wireTasks(el, tasks, { completeTask, editTask });
}

// ---------- one contact ----------

export async function contactView(el, id) {
  mount(el, html`<div class="mp-skel" style="height:300px"></div>`);
  const { contact: c, inquiries, opportunities, projects, events } = await api(`contacts/${id}`);
  mount(el, html`
    <header class="mp-head"><div style="display:flex;gap:14px;align-items:center">${avatar(c.name)}<div><a class="mp-back" href="#/inquiries?tab=contacts">← Contacts</a><h1>${c.name}</h1><p class="mp-sub">${label("contactTypes", c.type)}${c.company ? ` · ${c.company}` : ""} ${testBadge(c)}</p></div></div></header>
    <div class="mp-actions" style="margin-bottom:18px">${c.email ? html`<a class="mp-btn" href="mailto:${c.email}">${icon.mail} ${c.email}</a>` : ""}${c.phone ? html`<a class="mp-btn" href="tel:${c.phone}">${icon.phone} ${c.phone}</a>` : ""}${c.linkedin ? html`<a class="mp-btn" href="${c.linkedin}" target="_blank" rel="noopener noreferrer">LinkedIn ↗</a>` : ""}${can("records.write") ? html`<button class="mp-btn" data-note>${icon.note} Note</button>` : ""}</div>
    <div class="mp-record">
      <div class="mp-grid"><section class="mp-card mp-panel"><div class="mp-panel__head"><h2>History</h2></div>${events.length ? html`<ul class="mp-timeline">${events.map((e) => eventLine(e))}</ul>` : html`<p class="mp-empty">No history yet.</p>`}</section></div>
      <div class="mp-grid">
        <section class="mp-card mp-panel"><div class="mp-panel__head"><h2>Inquiries</h2></div>${inquiries.length ? html`<ul class="mp-list">${inquiries.map((i) => html`<li class="mp-task" style="grid-template-columns:1fr auto"><a class="mp-task__title" href="#/inquiry/${i.id}">${label("inquiryTypes", i.type)}</a>${inquiryStatusBadge(i)}</li>`)}</ul>` : html`<p class="mp-empty">None.</p>`}</section>
        <section class="mp-card mp-panel"><div class="mp-panel__head"><h2>Opportunities</h2></div>${opportunities.length ? html`<ul class="mp-list">${opportunities.map((o) => html`<li class="mp-task" style="grid-template-columns:1fr auto"><a class="mp-task__title" href="#/opportunity/${o.id}">${o.title}</a>${stageBadge(o)}</li>`)}</ul>` : html`<p class="mp-empty">None.</p>`}</section>
        <section class="mp-card mp-panel"><div class="mp-panel__head"><h2>Projects</h2></div>${projects.length ? html`<ul class="mp-list">${projects.map((p) => html`<li class="mp-task" style="grid-template-columns:1fr auto"><a class="mp-task__title" href="#/project/${p.id}">${p.title}</a><span class="mp-badge">${label("projectStages", p.stage)}</span></li>`)}</ul>` : html`<p class="mp-empty">None.</p>`}</section>
      </div>
    </div>
  `);
  el.querySelector("[data-note]")?.addEventListener("click", () => logInteraction("contact", c.id, "note"));
}
