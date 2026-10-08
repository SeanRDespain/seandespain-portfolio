// Calendar & Tasks: one agenda for follow-ups, interviews, client
// appointments, project deadlines, and deliverable due dates, plus a month
// view on wider screens and the plain task list.
import { api, can, html, mount, fmt, icon, isManager } from "./lib.js";
import { addTask, completeTask, editTask } from "./actions.js";
import { entityHref, taskRow, wireTasks } from "./view-shared.js";

const KIND = { follow_up: "Follow-up", reply: "Reply", interview: "Interview", appointment: "Appointment", call: "Call", other: "Task", deadline: "Deadline", deliverable: "Deliverable" };
const dayKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

export async function calendarView(el, query) {
  const view = query.get("view") || "agenda";
  const monthParam = query.get("month");
  const base = monthParam ? new Date(`${monthParam}-01T12:00`) : new Date();
  const first = new Date(base.getFullYear(), base.getMonth(), 1);
  const gridStart = new Date(first);
  gridStart.setDate(first.getDate() - first.getDay());
  mount(el, html`<div class="mp-skel" style="height:360px"></div>`);

  const head = html`<header class="mp-head">
      <div><p class="mp-eyebrow">Calendar & tasks</p><h1>What's <em>coming up.</em></h1><p class="mp-sub">Follow-ups, interviews, client appointments, deadlines, and deliverables in one place.</p></div>
      ${can("records.write") ? html`<div class="mp-actions"><button class="mp-btn" data-add="interview">${icon.calendar} Interview</button><button class="mp-btn" data-add="appointment">${icon.calendar} Appointment</button><button class="mp-btn mp-btn--primary" data-add="follow_up">${icon.plus} Task</button></div>` : ""}
    </header>
    <nav class="mp-tabs" aria-label="Views">${[["agenda", "Agenda"], ["month", "Month"], ["tasks", "All tasks"], ["done", "Done"]].map(([k, l]) => html`<a href="#/calendar?view=${k}" aria-current="${k === view ? "page" : "false"}">${l}</a>`)}</nav>`;

  if (view === "tasks" || view === "done") {
    const { items } = await api(`tasks?view=${view === "done" ? "done" : "open"}`);
    mount(el, html`${head}<section class="mp-card mp-panel">${items.length ? html`<ul class="mp-list">${items.map((t) => taskRow(t))}</ul>` : html`<p class="mp-empty">${view === "done" ? "Nothing completed yet." : "No open tasks."}</p>`}</section>`);
    wireTasks(el, items, { completeTask, editTask });
    wireAdd(el);
    return;
  }

  if (view === "month") {
    const end = new Date(gridStart);
    end.setDate(gridStart.getDate() + 42);
    const { items } = await api(`calendar?from=${gridStart.toISOString()}&to=${end.toISOString()}`);
    const byDay = {};
    for (const i of items) (byDay[dayKey(new Date(i.at))] ||= []).push(i);
    const today = dayKey(new Date());
    const prev = new Date(first.getFullYear(), first.getMonth() - 1, 1);
    const next = new Date(first.getFullYear(), first.getMonth() + 1, 1);
    const ym = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    mount(el, html`${head}
      <div class="mp-filters"><a class="mp-btn mp-btn--small" href="#/calendar?view=month&month=${ym(prev)}">←</a><b>${first.toLocaleDateString("en-US", { month: "long", year: "numeric" })}</b><a class="mp-btn mp-btn--small" href="#/calendar?view=month&month=${ym(next)}">→</a></div>
      <div class="mp-card mp-month">
        ${["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => html`<div class="mp-month__dow">${d}</div>`)}
        ${Array.from({ length: 42 }, (_, n) => {
          const d = new Date(gridStart);
          d.setDate(gridStart.getDate() + n);
          const key = dayKey(d);
          const list = byDay[key] || [];
          return html`<div class="mp-month__day${d.getMonth() !== first.getMonth() ? " is-out" : ""}${key === today ? " is-today" : ""}">
            <span class="mp-month__n">${d.getDate()}</span>
            ${list.slice(0, 3).map((i) => html`<a class="mp-month__item mp-kind--${i.kind}${i.done ? " is-done" : ""}" href="${i.related ? entityHref(i.related) : "#/calendar?view=tasks"}" title="${KIND[i.kind]}: ${i.title}">${i.title}</a>`)}
            ${list.length > 3 ? html`<span class="mp-month__more">+${list.length - 3} more</span>` : ""}
          </div>`;
        })}
      </div>`);
    wireAdd(el);
    return;
  }

  // agenda: overdue, then each of the next 30 days that has something
  const now = new Date();
  const { items } = await api(`calendar?from=${new Date(now.getTime() - 86400000).toISOString()}&to=${new Date(now.getTime() + 30 * 86400000).toISOString()}`);
  const open = items.filter((i) => !i.done);
  const overdue = open.filter((i) => i.overdue);
  const upcoming = open.filter((i) => !i.overdue);
  const groups = {};
  for (const i of upcoming) (groups[dayKey(new Date(i.at))] ||= []).push(i);
  const row = (i) => html`<li class="mp-task" style="grid-template-columns:auto 1fr auto">
      <span class="mp-kind mp-kind--${i.kind}">${KIND[i.kind] || "Task"}</span>
      <span><span class="mp-task__title">${i.related ? html`<a href="${entityHref(i.related)}">${i.title}</a>` : i.title}</span>${i.related && i.related.title !== i.title ? html`<div class="mp-task__meta">${i.related.title}</div>` : ""}</span>
      <span class="mp-actions" style="justify-content:flex-end"><span class="mp-due${i.overdue ? " mp-due--overdue" : ""}">${i.overdue ? fmt.due(i.at) : new Date(i.at).getHours() ? new Date(i.at).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }) : ""}</span>
      ${i.source === "task" ? html`<button class="mp-check" type="button" data-done-task="${i.id}" aria-label="Mark done: ${i.title}" aria-pressed="false">${icon.check}</button>` : ""}</span>
    </li>`;
  mount(el, html`${head}
    ${overdue.length ? html`<section class="mp-card mp-panel" style="margin-bottom:14px;border-color:#efc6c0"><div class="mp-panel__head"><h2 style="color:var(--mp-bad)">Overdue</h2></div><ul class="mp-list">${overdue.map(row)}</ul></section>` : ""}
    ${Object.keys(groups).length
      ? Object.entries(groups).map(([k, list]) => {
          const d = new Date(`${k}T12:00`);
          const rel = fmt.due(d.toISOString().slice(0, 10) + "T00:00:00");
          return html`<section class="mp-card mp-panel" style="margin-bottom:12px"><div class="mp-panel__head"><h2>${d.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" })}</h2><span class="mp-muted mp-mono">${rel.startsWith("Today") || rel.startsWith("Tomorrow") ? rel.split(" ")[0] : ""}</span></div><ul class="mp-list">${list.map(row)}</ul></section>`;
        })
      : html`<div class="mp-card mp-panel"><p class="mp-empty">Nothing scheduled in the next 30 days.</p></div>`}`);
  el.querySelectorAll("[data-done-task]").forEach((b) => b.addEventListener("click", () => {
    b.setAttribute("aria-pressed", "true");
    completeTask(b.dataset.doneTask);
  }));
  wireAdd(el);
}

function wireAdd(el) {
  el.querySelectorAll("[data-add]").forEach((b) => b.addEventListener("click", () => addTask({ kind: b.dataset.add, title: b.dataset.add === "interview" ? "Interview: " : b.dataset.add === "appointment" ? "Client meeting: " : "" })));
}
