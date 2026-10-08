// Overview. Managers: what needs attention, the seven numbers that describe
// the business, two separate funnels, what's coming up, and where inquiries
// come from. Collaborators: only their own assigned work.
import { api, state, can, html, raw, mount, fmt, icon, barList, columnChart, label, isManager } from "./lib.js";
import { entityHref, eventLine, progress } from "./view-shared.js";

const PERIODS = [["7d", "7 days"], ["30d", "30 days"], ["90d", "90 days"], ["12m", "12 months"]];
const KIND = { follow_up: "Follow-up", reply: "Reply", interview: "Interview", appointment: "Appointment", call: "Call", other: "Task", deadline: "Deadline", deliverable: "Deliverable" };

function attentionPanel(items) {
  return html`<section class="mp-card mp-panel mp-span-5" aria-labelledby="attn-h">
    <div class="mp-panel__head"><h2 id="attn-h">Needs attention</h2><a href="#/calendar">Calendar</a></div>
    ${items.length
      ? html`<ul class="mp-attn">${items.slice(0, 7).map((a) => html`<li><a href="${entityHref(a.entity)}" data-sev="${a.severity}"><i></i><span><b>${a.title}</b><small>${a.detail}</small></span><span class="mp-chev">${icon.chevron}</span></a></li>`)}</ul>`
      : html`<div class="mp-allclear"><span>${icon.check}</span><div><b>All clear.</b><div class="mp-muted">Nothing overdue or waiting on you.</div></div></div>`}
  </section>`;
}

function upcomingList(items) {
  if (!items.length) return html`<p class="mp-empty">Nothing scheduled in the next two weeks.</p>`;
  return html`<ul class="mp-list">${items.map(
    (i) => html`<li class="mp-task" style="grid-template-columns:auto 1fr auto">
      <span class="mp-kind mp-kind--${i.kind}">${KIND[i.kind] || "Task"}</span>
      <span><span class="mp-task__title">${i.related ? html`<a href="${entityHref(i.related)}">${i.title}</a>` : i.title}</span>${i.related && i.related.title !== i.title ? html`<div class="mp-task__meta">${i.related.title}</div>` : ""}</span>
      <span class="mp-due${i.overdue ? " mp-due--overdue" : ""}">${fmt.due(i.at)}</span>
    </li>`,
  )}</ul>`;
}

function metric(lbl, value, meta, { hero = false, attn = false, title = "" } = {}) {
  return html`<article class="mp-card mp-kpi${hero ? " mp-kpi--hero" : ""}" data-attn="${attn ? "true" : "false"}" title="${title}">
    <span class="mp-kpi__label">${lbl}</span><span class="mp-kpi__value">${value}</span><span class="mp-kpi__meta">${meta}</span>
  </article>`;
}

function change(curr, prev, { money = false } = {}) {
  if (prev == null || curr == null) return "";
  const d = curr - prev;
  if (!d) return html`<span class="mp-delta mp-delta--flat">same as before</span>`;
  return html`<span class="mp-delta mp-delta--${d > 0 ? "good" : "bad"}">${d > 0 ? "▲" : "▼"} ${money ? fmt.money(Math.abs(d), { compact: true }) : Math.abs(d)}</span>`;
}

function stackedWeeks(weeks) {
  const w = 460, h = 150, pad = { l: 26, r: 6, t: 8, b: 20 };
  const totals = weeks.map((x) => x.client_work + x.employment + x.general);
  const max = Math.max(...totals, 1);
  const bw = (w - pad.l - pad.r) / weeks.length;
  const ih = h - pad.t - pad.b;
  const colors = { client_work: "#4f5bd5", employment: "#a8691a", general: "#c9c5bc" };
  const bars = weeks.map((x, i) => {
    let y = pad.t + ih;
    return ["client_work", "employment", "general"].map((k) => {
      const bh = (x[k] / max) * ih;
      y -= bh;
      return bh ? `<rect x="${(pad.l + i * bw + bw * 0.2).toFixed(1)}" y="${y.toFixed(1)}" width="${(bw * 0.6).toFixed(1)}" height="${bh.toFixed(1)}" rx="2" fill="${colors[k]}"><title>Week of ${x.weekStart}: ${x[k]} ${k.replace("_", " ")}</title></rect>` : "";
    }).join("");
  }).join("");
  const labels = [0, weeks.length - 1].map((i) => `<text x="${(pad.l + i * bw + bw / 2).toFixed(1)}" y="${h - 5}" text-anchor="middle">${new Date(`${weeks[i].weekStart}T12:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</text>`).join("");
  return raw(`<svg class="mp-chart" viewBox="0 0 ${w} ${h}" role="img" aria-label="Inquiries per week"><line x1="${pad.l}" x2="${w - pad.r}" y1="${pad.t + ih}" y2="${pad.t + ih}" stroke="#ece8df"/><text x="${pad.l - 6}" y="${pad.t + 8}" text-anchor="end">${max}</text>${bars}${labels}</svg>`);
}

function funnel(rows) {
  const max = Math.max(...rows.map((r) => r.count), 1);
  return html`<div class="mp-funnel">${rows.map((r) => html`<div class="mp-funnel__row"><span>${r.label}</span><span class="mp-funnel__bar"><span style="width:${raw(((r.count / max) * 100).toFixed(1))}%"></span></span><span class="mp-funnel__num">${r.count}</span></div>`)}</div>`;
}

export async function overview(el) {
  mount(el, html`<div class="mp-skel" style="height:420px"></div>`);
  const data = await api(isManager() ? `overview?period=${state.period}` : "overview");
  const hour = new Date().getHours();
  const greet = `${hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening"}, `;
  if (data.role === "staff") return staffOverview(el, data, greet);

  const m = data.metrics;
  const money = can("money.read");
  const urgent = data.attention.filter((a) => a.severity !== "info").length;
  const a = data.attribution;
  mount(el, html`
    <header class="mp-head">
      <div>
        <p class="mp-eyebrow">${fmt.date(`${data.range.from}T12:00`)} to ${fmt.date(`${data.range.to}T12:00`)} · Mountain time</p>
        <h1>${greet}<em>${state.me.user.name}.</em></h1>
        <p class="mp-sub">${urgent ? `${urgent} thing${urgent > 1 ? "s" : ""} need${urgent > 1 ? "" : "s"} you.` : "Nothing urgent right now."}</p>
      </div>
      <div class="mp-seg" role="group" aria-label="Period">${PERIODS.map(([k, l]) => html`<button type="button" data-period="${k}" aria-pressed="${String(k === state.period)}">${l}</button>`)}</div>
    </header>
    <div class="mp-ov">
      ${attentionPanel(data.attention)}
      <section class="mp-span-7" aria-label="Key numbers">
        <div class="mp-kpis">
          ${metric("New client inquiries", m.new_client_inquiries.value, html`${change(m.new_client_inquiries.value, m.new_client_inquiries.previous)}<span>vs the period before</span>`, { hero: true, title: "Client-work inquiries received in the period, excluding spam" })}
          ${metric("Follow-ups due", m.follow_ups_due.value, m.follow_ups_due.overdue ? html`<span class="mp-due--overdue">${m.follow_ups_due.overdue} overdue</span>` : html`Due by end of today`, { attn: m.follow_ups_due.value > 0 })}
          ${metric("Active projects", m.active_projects.value, html`Planning, in progress, or review`)}
          ${metric("Employment", m.open_employment.value, html`${m.open_employment.interviewing} screening or interviewing · ${m.open_employment.interviews_scheduled} interview${m.open_employment.interviews_scheduled === 1 ? "" : "s"} scheduled`, { title: "Open employment opportunities. Never counted as sales." })}
          ${money ? metric("Quoted pipeline", fmt.money(m.quoted_pipeline.value.amount, { compact: true }), html`${m.quoted_pipeline.quoted} quoted${m.quoted_pipeline.unquoted ? ` · ${m.quoted_pipeline.unquoted} without a quote` : ""}`, { title: "Quotes on open client opportunities" }) : ""}
          ${money ? metric("Cash collected", fmt.money(m.cash_collected.value.amount, { compact: true }), html`${change(m.cash_collected.value.amount, m.cash_collected.previous?.amount, { money: true })}<span>Manual entries</span>`, { title: "Payments recorded in the period. Manual entries, not provider-verified." }) : ""}
          ${money ? metric("Unpaid balances", fmt.money(m.unpaid_balances.value.amount, { compact: true }), html`${m.unpaid_balances.projects} project${m.unpaid_balances.projects === 1 ? "" : "s"} · manual entries`, { attn: m.unpaid_balances.value.amount > 0, title: "Recorded project value minus payments received" }) : ""}
        </div>
      </section>

      <section class="mp-card mp-panel mp-span-7">
        <div class="mp-panel__head"><h2>Inquiries per week</h2><span class="mp-legend"><i style="background:#4f5bd5"></i>Client <i style="background:#a8691a"></i>Employment <i style="background:#c9c5bc"></i>General</span></div>
        ${stackedWeeks(data.charts.inquiriesByWeek)}
      </section>
      ${money
        ? html`<section class="mp-card mp-panel mp-span-5"><div class="mp-panel__head"><h2>Cash collected</h2><span class="mp-muted mp-mono">Manual entries</span></div>${columnChart(data.charts.cashByMonth.map((x) => ({ label: x.month, short: new Date(`${x.month}-15`).toLocaleDateString("en-US", { month: "narrow" }), value: x.amount })), { w: 380, h: 170 })}</section>`
        : ""}

      <section class="mp-card mp-panel mp-span-6"><div class="mp-panel__head"><h2>Client work funnel</h2><a href="#/inquiries?tab=client">Client work</a></div>${funnel(data.funnels.client)}<p class="mp-sub" style="margin-top:10px">Inquiries received in this period, and how far they've gone.</p></section>
      <section class="mp-card mp-panel mp-span-6"><div class="mp-panel__head"><h2>Employment funnel</h2><a href="#/inquiries?tab=employment">Employment</a></div>${funnel(data.funnels.employment)}<p class="mp-sub" style="margin-top:10px">Opportunities added in this period. Kept apart from client work.</p></section>

      <section class="mp-card mp-panel mp-span-7"><div class="mp-panel__head"><h2>Coming up</h2><a href="#/calendar">Calendar</a></div>${upcomingList(data.upcoming)}</section>
      <section class="mp-card mp-panel mp-span-5">
        <div class="mp-panel__head"><h2>Where inquiries come from</h2></div>
        ${barList(a.bySource.map((s) => ({ label: s.label, value: s.inquiries })), { empty: "No inquiries in this period yet." })}
        ${a.pagesReadFirst.length ? html`<div class="mp-panel__head" style="margin-top:16px"><h2>Pages read before reaching out</h2></div>${barList(a.pagesReadFirst.map((p) => ({ label: p.label, value: p.inquiries })))}` : ""}
        ${a.total ? html`<p class="mp-sub" style="margin-top:10px">Source captured for ${a.capturedFor} of ${a.total} website inquiries.</p>` : ""}
        ${data.traffic ? html`<div class="mp-panel__head" style="margin-top:16px"><h2>Website (GA4)</h2></div><p style="margin:0">${fmt.num(data.traffic.sessions)} sessions · ${fmt.num(data.traffic.users)} people · ${fmt.num(data.traffic.resumeDownloads)} resume downloads</p>` : ""}
      </section>

      <section class="mp-card mp-panel mp-span-12"><div class="mp-panel__head"><h2>Recent activity</h2></div>${data.recent.length ? html`<ul class="mp-timeline">${data.recent.map((e) => eventLine(e))}</ul>` : html`<p class="mp-empty">Activity appears here as inquiries arrive and work moves.</p>`}</section>
    </div>
  `);
  el.querySelectorAll("[data-period]").forEach((b) =>
    b.addEventListener("click", () => {
      state.period = b.dataset.period;
      try {
        localStorage.setItem("mp_period", state.period);
      } catch {}
      overview(el);
    }),
  );
}

function staffOverview(el, data, greet) {
  mount(el, html`
    <header class="mp-head"><div><p class="mp-eyebrow">Your work</p><h1>${greet}<em>${state.me.user.name}.</em></h1><p class="mp-sub">Projects and deliverables assigned to you.</p></div></header>
    <div class="mp-ov">
      ${attentionPanel(data.attention)}
      <section class="mp-card mp-panel mp-span-7"><div class="mp-panel__head"><h2>Coming up</h2><a href="#/calendar">Calendar</a></div>${upcomingList(data.upcoming)}</section>
      <section class="mp-span-12">
        <div class="mp-people">${data.projects.length
          ? data.projects.map((p) => html`<a class="mp-card mp-opp" href="#/project/${p.id}"><span class="mp-opp__title">${p.title}</span><span class="mp-opp__sub">${[p.clientName, p.organization].filter(Boolean).join(" · ")}</span><span class="mp-opp__row"><span class="mp-badge mp-badge--open">${label("projectStages", p.stage)}</span><span class="mp-due">${p.deadline ? `Due ${fmt.date(p.deadline)}` : ""}</span></span><span class="mp-opp__row">${progress(p.deliverables.filter((d) => d.status === "done").length, p.deliverables.length)}</span></a>`)
          : html`<div class="mp-card mp-panel"><p class="mp-empty">Nothing is assigned to you yet.</p></div>`}</div>
      </section>
    </div>
  `);
}
