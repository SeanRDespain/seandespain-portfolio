// People: everyone in the business, and one person's whole relationship.
import { api, state, can, html, raw, mount, fmt, icon, label } from "./lib.js";
import { newContact, editContact, newOpportunity, logInteraction, addTask } from "./actions.js";
import { oppCard, eventLine, taskRow, avatar } from "./view-shared.js";
import { wireTaskButtons } from "./view-pipeline.js";

const STATUS = { client: ["Client", "won"], active: ["In progress", "open"], past: ["Past", "lost"], contact: ["Contact", ""] };

export async function peopleView(el, query) {
  const q = query.get("q") || "";
  const type = query.get("type") || "";
  mount(el, html`<div class="mp-skel" style="height:320px"></div>`);
  const { items } = await api(`contacts?${new URLSearchParams({ ...(q ? { q } : {}), ...(type ? { type } : {}) })}`);
  const set = (k, v) => {
    const next = new URLSearchParams(query);
    if (v) next.set(k, v);
    else next.delete(k);
    location.hash = `#/people?${next}`;
  };

  mount(el, html`
    <header class="mp-head">
      <div><p class="mp-eyebrow">People</p><h1>Clients, recruiters, <em>and everyone between.</em></h1><p class="mp-sub">${items.length} ${items.length === 1 ? "person" : "people"}</p></div>
      ${can("crm.write") ? html`<button class="mp-btn mp-btn--primary" data-new>${icon.plus} New contact</button>` : ""}
    </header>
    <div class="mp-filters">
      <input class="mp-input" type="search" placeholder="Search name, email, company" value="${q}" data-q aria-label="Search people" style="flex:1;min-width:200px">
      <select class="mp-select" data-type aria-label="Type"><option value="">Everyone</option>${state.config.contactTypes.map(([k, l]) => html`<option value="${k}"${k === type ? raw(" selected") : ""}>${l}</option>`)}</select>
    </div>
    ${items.length
      ? html`<div class="mp-people">${items.map((c) => {
          const [statusLabel, tone] = STATUS[c.status];
          return html`<a class="mp-card mp-person" href="#/contact/${c.id}">
            ${avatar(c.name)}
            <span>
              <b>${c.name}</b>
              <small>${[c.title, c.company].filter(Boolean).join(" · ") || label("contactTypes", c.type)}</small>
              <span class="mp-actions" style="margin-top:6px;gap:5px"><span class="mp-badge mp-badge--${tone}">${statusLabel}</span>${c.awaitingReply ? html`<span class="mp-badge mp-badge--bad mp-badge--dot">Reply needed</span>` : ""}</span>
              <small style="margin-top:6px">${c.nextTask ? html`Next: ${c.nextTask.title} · ${fmt.due(c.nextTask.dueAt)}` : c.lastInteractionAt ? `Last contact ${fmt.rel(c.lastInteractionAt)}` : `Added ${fmt.rel(c.createdAt)}`}</small>
            </span>
          </a>`;
        })}</div>`
      : html`<div class="mp-card mp-panel"><p class="mp-empty"><b>No one here yet.</b> People who send the website form are added automatically.</p></div>`}
  `);
  el.querySelector("[data-new]")?.addEventListener("click", newContact);
  el.querySelector("[data-type]").addEventListener("change", (e) => set("type", e.target.value));
  let t;
  el.querySelector("[data-q]").addEventListener("input", (e) => {
    clearTimeout(t);
    t = setTimeout(() => set("q", e.target.value.trim()), 350);
  });
}

export async function contactView(el, id) {
  mount(el, html`<div class="mp-skel" style="height:320px"></div>`);
  const { contact: c, opportunities, tasks, events } = await api(`contacts/${id}`);
  const [statusLabel, tone] = STATUS[c.status];
  mount(el, html`
    <header class="mp-head">
      <div style="display:flex;gap:14px;align-items:center">
        ${avatar(c.name)}
        <div>
          <a class="mp-back" href="#/people">← People</a>
          <h1>${c.name}</h1>
          <p class="mp-sub"><span class="mp-badge mp-badge--${tone}">${statusLabel}</span> ${label("contactTypes", c.type)}${c.title ? ` · ${c.title}` : ""}${c.company ? ` · ${c.company}` : ""}</p>
        </div>
      </div>
      ${can("crm.write") ? html`<button class="mp-btn" data-edit>Edit</button>` : ""}
    </header>
    <div class="mp-actions" style="margin-bottom:18px">
      ${c.email ? html`<a class="mp-btn" href="mailto:${c.email}">${icon.mail} Email</a>` : ""}
      ${c.phone ? html`<a class="mp-btn" href="tel:${c.phone}">${icon.phone} Call</a>` : ""}
      ${c.linkedin ? html`<a class="mp-btn" href="${c.linkedin}" target="_blank" rel="noopener noreferrer">LinkedIn ↗</a>` : ""}
      ${can("crm.write")
        ? html`<button class="mp-btn" data-log="email">Log reply</button><button class="mp-btn" data-log="note">${icon.note} Note</button><button class="mp-btn" data-task>${icon.plus} Task</button><button class="mp-btn" data-opp>${icon.plus} Opportunity</button>`
        : ""}
    </div>
    <div class="mp-record">
      <div class="mp-grid">
        <section class="mp-card mp-panel">
          <div class="mp-panel__head"><h2>Opportunities</h2></div>
          ${opportunities.length ? html`<div class="mp-grid">${opportunities.map(oppCard)}</div>` : html`<p class="mp-empty">None yet.</p>`}
        </section>
        <section class="mp-card mp-panel">
          <div class="mp-panel__head"><h2>History</h2></div>
          ${events.length ? html`<ul class="mp-timeline">${events.map((e) => eventLine(e))}</ul>` : html`<p class="mp-empty">No history yet.</p>`}
        </section>
      </div>
      <div class="mp-grid">
        <section class="mp-card mp-panel">
          <div class="mp-panel__head"><h2>Tasks</h2></div>
          ${tasks.length ? html`<ul class="mp-list">${tasks.map((t) => taskRow({ ...t, overdue: t.status === "open" && t.dueAt && Date.parse(t.dueAt) < Date.now() }, { showRelated: false }))}</ul>` : html`<p class="mp-empty">Nothing open.</p>`}
        </section>
        <section class="mp-card mp-panel">
          <div class="mp-panel__head"><h2>Contact</h2></div>
          <dl class="mp-facts">
            <div><dt>Email</dt><dd>${c.email || "None"}</dd></div>
            <div><dt>Phone</dt><dd>${c.phone || "None"}</dd></div>
            <div><dt>First came from</dt><dd>${c.firstSource ? label("sources", c.firstSource) : "Added by hand"}</dd></div>
            <div><dt>Last contact</dt><dd>${c.lastInteractionAt ? fmt.rel(c.lastInteractionAt) : "None logged"}</dd></div>
          </dl>
          ${c.notes ? html`<p class="mp-msg" style="margin-top:12px">${c.notes}</p>` : ""}
        </section>
      </div>
    </div>
  `);
  el.querySelector("[data-edit]")?.addEventListener("click", () => editContact(c));
  el.querySelectorAll("[data-log]").forEach((b) => b.addEventListener("click", () => logInteraction({ contactId: c.id, type: b.dataset.log })));
  el.querySelector("[data-task]")?.addEventListener("click", () => addTask({ relatedType: "contact", relatedId: c.id, relatedLabel: c.name }));
  el.querySelector("[data-opp]")?.addEventListener("click", () => newOpportunity({ kind: ["recruiter", "hiring_manager"].includes(c.type) ? "job" : "project", contactId: c.id, contactName: c.name }));
  wireTaskButtons(el, tasks);
}
