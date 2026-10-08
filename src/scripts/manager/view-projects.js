// Projects: won client work. Managers see everything; collaborators see only
// the projects and deliverables assigned to them, without money.
import { api, can, html, mount, fmt, icon, label, isManager, state } from "./lib.js";
import { newProject, editProject, addDeliverable, updateDeliverable, recordPayment, logInteraction, addTask, completeTask, editTask } from "./actions.js";
import { eventLine, taskRow, wireTasks, testBadge, paymentBadge, progress } from "./view-shared.js";

const STATUS_TONE = { todo: "", in_progress: "open", done: "won" };

export async function projectsView(el, query) {
  const phase = query.get("phase") || "current";
  mount(el, html`<div class="mp-skel" style="height:300px"></div>`);
  const { items } = await api(`projects?phase=${phase}`);
  mount(el, html`
    <header class="mp-head">
      <div><p class="mp-eyebrow">Projects</p><h1>${isManager() ? html`Client <em>projects</em>` : html`Your <em>projects</em>`}</h1><p class="mp-sub">${items.length} ${phase === "done" ? "finished" : phase === "all" ? "total" : "current"}</p></div>
      ${can("records.write") ? html`<button class="mp-btn mp-btn--primary" data-new>${icon.plus} New project</button>` : ""}
    </header>
    <div class="mp-filters"><div class="mp-seg" role="group" aria-label="Phase">${[["current", "Current"], ["done", "Delivered / cancelled"], ["all", "All"]].map(([k, l]) => html`<button type="button" data-phase="${k}" aria-pressed="${String(k === phase)}">${l}</button>`)}</div></div>
    ${items.length
      ? html`<div class="mp-people">${items.map((p) => {
          const days = p.deadline ? Math.ceil((Date.parse(p.deadline) - Date.now()) / 86400000) : null;
          return html`<a class="mp-card mp-opp" href="#/project/${p.id}">
            <span class="mp-opp__title">${p.title}</span>
            <span class="mp-opp__sub">${[p.clientName, p.organization].filter(Boolean).join(" · ") || "No client set"} · ${p.assigneeName}</span>
            <span class="mp-opp__row"><span><span class="mp-badge mp-badge--${p.phase === "done" ? "won" : "open"}">${label("projectStages", p.stage)}</span> ${paymentBadge(p.money)} ${testBadge(p)}</span><span class="mp-opp__value">${p.money?.value != null ? fmt.money(p.money.value, { compact: true }) : ""}</span></span>
            <span class="mp-opp__row">${progress(p.progress.done, p.progress.total)}</span>
            ${p.deadline ? html`<span class="mp-opp__next"><span>Deadline</span><span class="mp-due${days < 0 && p.phase !== "done" ? " mp-due--overdue" : ""}">${fmt.date(p.deadline)}${p.phase !== "done" ? ` · ${days < 0 ? `${-days}d late` : `${days}d left`}` : ""}</span></span>` : ""}
          </a>`;
        })}</div>`
      : html`<div class="mp-card mp-panel"><p class="mp-empty"><b>No projects here.</b> ${isManager() ? "When client work is won, start its project from the opportunity." : "Nothing is assigned to you yet."}</p></div>`}
  `);
  el.querySelector("[data-new]")?.addEventListener("click", newProject);
  el.querySelectorAll("[data-phase]").forEach((b) => b.addEventListener("click", () => (location.hash = `#/projects?phase=${b.dataset.phase}`)));
}

export async function projectView(el, id) {
  mount(el, html`<div class="mp-skel" style="height:360px"></div>`);
  const data = await api(`projects/${id}`);
  const p = data.project;
  const manager = isManager();
  const m = p.money;
  mount(el, html`
    <header class="mp-head">
      <div>
        <a class="mp-back" href="#/projects">← Projects</a>
        <h1>${p.title}</h1>
        <p class="mp-sub"><span class="mp-badge mp-badge--${p.phase === "done" ? "won" : "open"}">${label("projectStages", p.stage)}</span> ${testBadge(p)} ${[p.clientName, p.organization].filter(Boolean).join(" · ")} · lead: ${p.assigneeName}${p.deadline ? ` · deadline ${fmt.date(p.deadline)}` : ""}</p>
      </div>
      ${manager && can("records.write") ? html`<button class="mp-btn" data-edit>Edit</button>` : ""}
    </header>
    ${manager && can("records.write")
      ? html`<div class="mp-actions" style="margin-bottom:18px">
          <button class="mp-btn mp-btn--primary" data-deliverable>${icon.plus} Deliverable</button>
          ${can("money.write") ? html`<button class="mp-btn" data-pay>Record payment</button>` : ""}
          <button class="mp-btn" data-task="appointment">${icon.calendar} Client appointment</button>
          <button class="mp-btn" data-note>${icon.note} Note</button>
        </div>`
      : ""}
    <div class="mp-record">
      <div class="mp-grid">
        <section class="mp-card mp-panel">
          <div class="mp-panel__head"><h2>${manager ? "Deliverables" : "Your deliverables"}</h2><span>${progress(p.progress.done, p.progress.total)}</span></div>
          ${p.deliverables.length
            ? html`<ul class="mp-list">${p.deliverables.map((d) => html`<li class="mp-dlv">
                <div class="mp-dlv__head">
                  <span><b>${d.title}</b><div class="mp-task__meta">${d.assigneeName}${d.dueAt ? ` · due ${fmt.date(d.dueAt)}` : ""}${d.completedAt ? ` · done ${fmt.rel(d.completedAt)}` : ""}</div></span>
                  <span class="mp-actions"><span class="mp-badge mp-badge--${STATUS_TONE[d.status]}">${label("deliverableStatuses", d.status)}</span>${d.status !== "done" && d.dueAt && Date.parse(d.dueAt) < Date.now() ? html`<span class="mp-badge mp-badge--bad">Overdue</span>` : ""}
                  ${manager || d.assigneeId === state.me.user.id ? html`<button class="mp-btn mp-btn--small" data-dlv="${d.id}">${manager ? "Update" : "Post update"}</button>` : ""}</span>
                </div>
                ${d.updates.length ? html`<ul class="mp-updates">${d.updates.slice(-3).reverse().map((u) => html`<li><small>${fmt.rel(u.at)}</small> ${u.text}</li>`)}</ul>` : ""}
              </li>`)}</ul>`
            : html`<p class="mp-empty">${manager ? "Break the work into deliverables and assign each one." : "No deliverables assigned to you on this project."}</p>`}
        </section>
        ${manager ? html`<section class="mp-card mp-panel"><div class="mp-panel__head"><h2>History</h2></div>${data.events.length ? html`<ul class="mp-timeline">${data.events.map((e) => eventLine(e, { links: false }))}</ul>` : html`<p class="mp-empty">No history yet.</p>`}</section>` : ""}
      </div>
      ${manager
        ? html`<div class="mp-grid">
            ${m
              ? html`<section class="mp-card mp-panel">
                  <div class="mp-panel__head"><h2>Money</h2>${paymentBadge(m)}</div>
                  <div class="mp-money">
                    <div><small>Recorded value</small><b>${m.value != null ? fmt.money(m.value) : "Not set"}</b></div>
                    <div><small>Collected</small><b>${fmt.money(m.collected)}</b>${m.balance ? html`<small>${fmt.money(m.balance)} unpaid</small>` : ""}</div>
                  </div>
                  ${p.payments.length ? html`<ul class="mp-list" style="margin-top:10px">${p.payments.slice().reverse().map((x) => html`<li class="mp-task" style="grid-template-columns:1fr auto"><span><span class="mp-task__title">${label("paymentMethods", x.method)}</span><div class="mp-task__meta">${fmt.date(x.receivedAt)} · Manual entry${x.note ? ` · ${x.note}` : ""}</div></span><span class="mp-mono">${fmt.money(x.amount)}</span></li>`)}</ul>` : ""}
                  <p class="mp-sub" style="margin-top:10px">No payment or accounting provider is connected. Payments here are manual entries.</p>
                </section>`
              : ""}
            <section class="mp-card mp-panel"><div class="mp-panel__head"><h2>Appointments & tasks</h2></div>${data.tasks.length ? html`<ul class="mp-list">${data.tasks.map((t) => taskRow({ ...t, overdue: t.status === "open" && Date.parse(t.dueAt) < Date.now() }, { showRelated: false }))}</ul>` : html`<p class="mp-empty">Nothing scheduled.</p>`}</section>
            <section class="mp-card mp-panel"><div class="mp-panel__head"><h2>Details</h2></div>
              <dl class="mp-facts">
                <div><dt>Started</dt><dd>${p.startAt ? fmt.date(p.startAt) : "Not set"}</dd></div>
                <div><dt>Deadline</dt><dd>${p.deadline ? fmt.date(p.deadline) : "Not set"}</dd></div>
                <div><dt>From opportunity</dt><dd>${data.opportunity ? html`<a href="#/opportunity/${data.opportunity.id}">${data.opportunity.title}</a>` : "Added directly"}</dd></div>
                <div><dt>Client contact</dt><dd>${data.contact ? html`<a href="#/contact/${data.contact.id}">${data.contact.name}</a>` : "None"}</dd></div>
              </dl>
            </section>
          </div>`
        : ""}
    </div>
  `);
  el.querySelector("[data-edit]")?.addEventListener("click", () => editProject(p));
  el.querySelector("[data-deliverable]")?.addEventListener("click", () => addDeliverable(p));
  el.querySelector("[data-pay]")?.addEventListener("click", () => recordPayment(p));
  el.querySelector("[data-note]")?.addEventListener("click", () => logInteraction("project", p.id, "note"));
  el.querySelector("[data-task]")?.addEventListener("click", () => addTask({ relatedType: "project", relatedId: p.id, relatedLabel: p.title, kind: "appointment", title: `Meeting: ${p.title}` }));
  el.querySelectorAll("[data-dlv]").forEach((b) => b.addEventListener("click", () => updateDeliverable(p, p.deliverables.find((d) => d.id === b.dataset.dlv))));
  if (data.tasks) wireTasks(el, data.tasks, { completeTask, editTask });
}
