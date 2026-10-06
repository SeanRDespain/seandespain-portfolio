// Overview: answers, in order, "what needs me", "how is it going", "where
// is the opportunity", "what's next", and "what changed".
import { api, state, can, html, raw, mount, fmt, sparkline, barList, icon } from "./lib.js";
import { completeTask } from "./actions.js";
import { eventLine, entityHref } from "./view-shared.js";

const PERIODS = [["7d", "7 days"], ["30d", "30 days"], ["90d", "90 days"], ["12m", "12 months"]];

function delta(k) {
  if (k.change == null || k.previous == null) return "";
  if (k.change === 0) return html`<span class="mp-delta mp-delta--flat">no change</span>`;
  const up = k.change > 0;
  const good = k.betterWhen === "lower" ? !up : up;
  const shown = k.unit === "usd" ? fmt.money(Math.abs(k.change), { compact: true }) : k.unit === "ratio" ? `${Math.round(Math.abs(k.change) * 100)} pts` : k.unit === "hours" ? fmt.hours(Math.abs(k.change)) : fmt.num(Math.abs(k.change));
  return html`<span class="mp-delta mp-delta--${good ? "good" : "bad"}">${up ? "▲" : "▼"} ${shown}</span>`;
}

function value(k) {
  if (k.redacted) return "Hidden";
  if (k.value == null) return "-";
  if (k.unit === "usd") return fmt.money(k.value, { compact: true });
  if (k.unit === "ratio") return fmt.pct(k.value);
  if (k.unit === "hours") return fmt.hours(k.value);
  return fmt.num(k.value);
}

function kpiCard(k, { hero = false } = {}) {
  let meta = "";
  if (k.key === "new_opportunities") meta = html`${k.breakdown.project} project · ${k.breakdown.job} job · ${k.breakdown.inbound} reached out to you`;
  if (k.key === "awaiting_reply") meta = k.value ? html`Oldest has waited ${fmt.hours(k.oldestHours)}` : html`Nobody is waiting on you`;
  if (k.key === "response_time") meta = k.value == null ? html`No replies logged in this period yet` : html`From inquiry to your first reply`;
  if (k.key === "project_pipeline" && !k.redacted) meta = html`${k.count} open · ${fmt.money(k.weighted, { compact: true })} weighted`;
  if (k.key === "won_value" && !k.redacted) meta = html`${k.count} project${k.count === 1 ? "" : "s"} won`;
  if (k.key === "active_interviews") meta = html`${k.breakdown.screening} screening · ${k.breakdown.interviewing} interviewing · ${k.breakdown.offer} offer`;
  if (k.key === "win_rate") meta = k.decided ? html`${k.won} of ${k.decided} decided inquiries` : html`No inquiries decided yet`;
  const attn = k.key === "awaiting_reply" && k.value > 0;
  const series = Array.isArray(k.series) && k.series.some((x) => x > 0) ? sparkline(k.series, { color: k.key === "won_value" ? "#2f7d5b" : "#4f5bd5" }) : "";
  return html`<article class="mp-card mp-kpi${hero ? " mp-kpi--hero" : ""}" data-attn="${attn ? "true" : "false"}" title="${k.definition}">
    <span class="mp-kpi__label">${k.label}</span>
    <span class="mp-kpi__value">${value(k)}</span>
    <span class="mp-kpi__meta">${delta(k)}<span>${meta}</span></span>
    ${series}
  </article>`;
}

function funnelPanel(f, kind) {
  const open = f.current.filter((s) => s.type !== "lost");
  const max = Math.max(...open.map((s) => s.count), 1);
  const showValue = kind === "project" && can("finance.read");
  return html`<div class="mp-funnel">${open.map(
    (s) => html`<a class="mp-funnel__row" data-type="${s.type}" href="#/pipeline?kind=${kind}&stage=${s.stage}">
      <span>${s.label}</span>
      <span class="mp-funnel__bar"><span style="width:${raw(((s.count / max) * 100).toFixed(1))}%"></span></span>
      <span class="mp-funnel__num">${s.count}${showValue && s.value ? html` · ${fmt.money(s.value, { compact: true })}` : ""}</span>
    </a>`,
  )}</div>`;
}

export async function overview(el) {
  const period = state.period;
  mount(el, html`<div class="mp-skel" style="height:420px"></div>`);
  const data = await api(`overview?period=${period}`);
  const k = Object.fromEntries(data.kpis.map((x) => [x.key, x]));
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  const high = data.alerts.filter((a) => a.severity !== "info");

  mount(el, html`
    <header class="mp-head">
      <div>
        <p class="mp-eyebrow">${new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}</p>
        <h1>${greeting}, <em>${state.me.user.name}.</em></h1>
        <p class="mp-sub">${high.length ? `${high.length} thing${high.length > 1 ? "s" : ""} need${high.length > 1 ? "" : "s"} you.` : "Nothing urgent right now."}</p>
      </div>
      <div class="mp-seg" role="group" aria-label="Period">${PERIODS.map(([key, l]) => html`<button type="button" data-period="${key}" aria-pressed="${String(key === period)}">${l}</button>`)}</div>
    </header>

    <div class="mp-ov">
      <section class="mp-card mp-panel mp-span-5" aria-labelledby="attn-h">
        <div class="mp-panel__head"><h2 id="attn-h">Needs attention</h2><a href="#/tasks?view=overdue">All tasks</a></div>
        ${data.alerts.length
          ? html`<ul class="mp-attn">${data.alerts.slice(0, 7).map(
              (a) => html`<li><a href="${entityHref(a.entity)}" data-sev="${a.severity}"><i></i><span><b>${a.title}</b><small>${a.detail}</small></span><span class="mp-chev">${icon.chevron}</span></a></li>`,
            )}</ul>`
          : html`<div class="mp-allclear"><span>${icon.check}</span><div><b>All clear.</b><div class="mp-muted">No overdue replies, tasks, or stalled opportunities.</div></div></div>`}
      </section>

      <section class="mp-span-7" aria-label="Key numbers">
        <div class="mp-kpis">
          ${kpiCard(k.new_opportunities, { hero: true })}
          ${kpiCard(k.awaiting_reply)}
          ${kpiCard(k.response_time)}
          ${kpiCard(k.project_pipeline, { hero: true })}
          ${kpiCard(k.won_value)}
          ${kpiCard(k.active_interviews)}
        </div>
      </section>

      <section class="mp-card mp-panel mp-span-6">
        <div class="mp-panel__head"><h2>Client projects</h2><a href="#/pipeline?kind=project">Open pipeline</a></div>
        ${funnelPanel(data.funnels.project, "project")}
        <p class="mp-sub" style="margin-top:12px">${kpiInline(k.win_rate)}</p>
      </section>

      <section class="mp-card mp-panel mp-span-6">
        <div class="mp-panel__head"><h2>Job search</h2><a href="#/pipeline?kind=job">Open pipeline</a></div>
        ${funnelPanel(data.funnels.job, "job")}
      </section>

      <section class="mp-card mp-panel mp-span-7">
        <div class="mp-panel__head"><h2>Coming up</h2><a href="#/tasks">All tasks</a></div>
        ${data.upcoming.length
          ? html`<ul class="mp-list">${data.upcoming.slice(0, 8).map(
              (t) => html`<li class="mp-task">
                <button class="mp-check" type="button" data-complete="${t.id}" aria-label="Mark done: ${t.title}" aria-pressed="false">${icon.check}</button>
                <span><span class="mp-task__title">${t.relatedId ? html`<a href="${entityHref({ type: t.relatedType, id: t.relatedId })}">${t.title}</a>` : t.title}</span>
                  ${t.related ? html`<div class="mp-task__meta">${t.related}</div>` : ""}</span>
                <span class="mp-due${t.overdue ? " mp-due--overdue" : ""}">${fmt.due(t.dueAt)}</span>
              </li>`,
            )}</ul>`
          : html`<p class="mp-empty">Nothing due in the next two weeks.</p>`}
      </section>

      <section class="mp-card mp-panel mp-span-5">
        <div class="mp-panel__head"><h2>Where opportunity comes from</h2><a href="#/analytics">Analytics</a></div>
        ${barList(data.sources.map((s) => ({ label: s.label, value: s.opportunities, won: s.won })), { valueLabel: (i) => `${i.value}${i.won ? ` · ${i.won} won` : ""}`, empty: "No opportunities in this period yet." })}
        <div class="mp-panel__head" style="margin-top:18px"><h2>Work people read before reaching out</h2></div>
        ${barList(data.work.pages.map((p) => ({ label: p.label, value: p.inquiries })), { valueLabel: (i) => `${i.value} inquir${i.value === 1 ? "y" : "ies"}`, empty: "Appears once inquiries come in through the website form." })}
      </section>

      ${can("activity.read")
        ? html`<section class="mp-card mp-panel mp-span-12">
            <div class="mp-panel__head"><h2>Recent activity</h2><a href="#/activity">Full history</a></div>
            ${data.recent.length ? html`<ul class="mp-timeline">${data.recent.map(eventLine)}</ul>` : html`<p class="mp-empty">Activity appears here as things happen.</p>`}
          </section>`
        : ""}
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
  el.querySelectorAll("[data-complete]").forEach((b) =>
    b.addEventListener("click", () => {
      b.setAttribute("aria-pressed", "true");
      completeTask(b.dataset.complete);
    }),
  );
}

function kpiInline(k) {
  if (!k || k.value == null) return "Win rate shows once inquiries are won or lost.";
  return `Inquiry win rate: ${fmt.pct(k.value)} (${k.won} of ${k.decided} decided).`;
}
