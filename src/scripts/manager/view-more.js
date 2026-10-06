// Tasks, Money, Analytics, Activity, and Settings.
import { api, state, can, html, raw, mount, fmt, icon, barList, lineChart, columnChart, label, formSheet, toast, confirmSheet } from "./lib.js";
import { addTask } from "./actions.js";
import { taskRow, eventLine } from "./view-shared.js";
import { wireTaskButtons } from "./view-pipeline.js";

const PERIODS = [["30d", "30 days"], ["90d", "90 days"], ["12m", "12 months"]];
const periodSeg = (current) => html`<div class="mp-seg" role="group" aria-label="Period">${PERIODS.map(([k, l]) => html`<button type="button" data-p="${k}" aria-pressed="${String(k === current)}">${l}</button>`)}</div>`;
const wirePeriod = (el, base, query) =>
  el.querySelectorAll("[data-p]").forEach((b) =>
    b.addEventListener("click", () => {
      const next = new URLSearchParams(query);
      next.set("period", b.dataset.p);
      location.hash = `#/${base}?${next}`;
    }),
  );

// ---------- tasks ----------

export async function tasksView(el, query) {
  const view = query.get("view") || "open";
  mount(el, html`<div class="mp-skel" style="height:300px"></div>`);
  const { items, counts } = await api(`tasks?view=${view}`);
  const tabs = [["open", `Open (${counts.open})`], ["today", "Due today"], ["overdue", `Overdue${counts.overdue ? ` (${counts.overdue})` : ""}`], ["suggested", `Suggested${counts.suggested ? ` (${counts.suggested})` : ""}`], ["done", "Done"]];
  mount(el, html`
    <header class="mp-head">
      <div><p class="mp-eyebrow">Tasks</p><h1>Follow-ups and <em>next steps.</em></h1><p class="mp-sub">Replies, calls, interviews, proposals, invoices. Reply tasks close themselves when you log a reply.</p></div>
      ${can("tasks.write") ? html`<button class="mp-btn mp-btn--primary" data-new>${icon.plus} New task</button>` : ""}
    </header>
    <nav class="mp-tabs" aria-label="Task views">${tabs.map(([k, l]) => html`<a href="#/tasks?view=${k}" aria-current="${k === view ? "page" : "false"}">${l}</a>`)}</nav>
    <section class="mp-card mp-panel">
      ${items.length ? html`<ul class="mp-list">${items.map((t) => taskRow(t))}</ul>` : html`<p class="mp-empty">${view === "overdue" ? "Nothing overdue." : view === "suggested" ? "No suggestions waiting. When Jarvis proposes a task, it appears here for your OK." : view === "done" ? "Nothing completed yet." : "Nothing here. Nice."}</p>`}
    </section>
  `);
  el.querySelector("[data-new]")?.addEventListener("click", () => addTask());
  wireTaskButtons(el, items);
}

// ---------- money ----------

export async function moneyView(el, query) {
  const period = query.get("period") || "90d";
  mount(el, html`<div class="mp-skel" style="height:300px"></div>`);
  const m = await api(`money?period=${period}`);
  const months = m.receivedByMonth.map((x) => ({ label: x.month, short: new Date(`${x.month}-15`).toLocaleDateString("en-US", { month: "short" }), value: x.value }));
  const stat = (lbl, val, sub = "") => html`<article class="mp-card mp-kpi"><span class="mp-kpi__label">${lbl}</span><span class="mp-kpi__value">${val}</span><span class="mp-kpi__meta">${sub}</span></article>`;
  mount(el, html`
    <header class="mp-head">
      <div><p class="mp-eyebrow">Money</p><h1>Project <em>revenue.</em></h1><p class="mp-sub">${m.note} Job compensation is tracked separately and never added to revenue.</p></div>
      ${periodSeg(period)}
    </header>
    <div class="mp-kpis" style="margin-bottom:16px">
      ${stat("Won in period", fmt.money(m.period.won), m.previous ? `${fmt.money(m.previous.won)} the period before` : "")}
      ${stat("Received in period", fmt.money(m.period.received), m.previous ? `${fmt.money(m.previous.received)} the period before` : "")}
      ${stat("Invoiced, not received", fmt.money(m.outstanding), "Across all projects")}
      ${stat("Agreed, not yet invoiced", fmt.money(m.notYetInvoiced), m.averageProjectValue ? `Average project ${fmt.money(m.averageProjectValue)}` : "")}
    </div>
    <div class="mp-ov">
      <section class="mp-card mp-panel mp-span-8"><div class="mp-panel__head"><h2>Received by month</h2></div>${columnChart(months)}</section>
      <section class="mp-card mp-panel mp-span-4"><div class="mp-panel__head"><h2>Won by service</h2></div>${barList(m.byService.map((s) => ({ label: label("services", s.service), value: s.value })), { valueLabel: (i) => fmt.money(i.value, { compact: true }), empty: "No projects won in this period." })}</section>
      <section class="mp-card mp-panel mp-span-6">
        <div class="mp-panel__head"><h2>Recent payments</h2></div>
        ${m.recentPayments.length ? html`<ul class="mp-list">${m.recentPayments.map((p) => html`<li class="mp-task" style="grid-template-columns:1fr auto"><span><a class="mp-task__title" href="#/opportunity/${p.opportunityId}">${p.title}</a><div class="mp-task__meta">${p.type === "received" ? "Received" : "Invoiced"} · ${fmt.date(p.at)}</div></span><span class="mp-mono">${fmt.money(p.amount)}</span></li>`)}</ul>` : html`<p class="mp-empty">Record invoices and payments from a project's page.</p>`}
      </section>
      <section class="mp-card mp-panel mp-span-6">
        <div class="mp-panel__head"><h2>Job offers</h2></div>
        ${m.offers.length ? html`<ul class="mp-list">${m.offers.map((o) => html`<li class="mp-task" style="grid-template-columns:1fr auto"><a class="mp-task__title" href="#/opportunity/${o.id}">${o.title}</a><span class="mp-mono">${o.compensation ? fmt.money(o.compensation) : "-"}</span></li>`)}</ul>` : html`<p class="mp-empty">No offers on the table.</p>`}
      </section>
    </div>
  `);
  wirePeriod(el, "money", query);
}

// ---------- analytics ----------

export async function analyticsView(el, query) {
  const period = query.get("period") || "30d";
  mount(el, html`<div class="mp-skel" style="height:300px"></div>`);
  const a = await api(`analytics?period=${period}`);
  const g = a.ga4;
  const evName = { inquiry_submitted: "Inquiry form sent", email_clicked: "Email clicked or copied", contact_clicked: "LinkedIn clicked", resume_downloaded: "Resume downloaded", live_project_clicked: "Live project opened" };
  const cohort = (f) => f.cohort.reached.map((r) => ({ label: r.label, value: r.count }));
  mount(el, html`
    <header class="mp-head">
      <div><p class="mp-eyebrow">Analytics</p><h1>What brings <em>opportunity.</em></h1><p class="mp-sub">Website behavior comes from Google Analytics. Opportunities and outcomes come from this portal.</p></div>
      ${periodSeg(period)}
    </header>
    <div class="mp-ov">
      <section class="mp-card mp-panel mp-span-8">
        <div class="mp-panel__head"><h2>Website visits</h2>${g.connected ? html`<span class="mp-muted mp-mono">GA4 · updated ${fmt.rel(g.fetchedAt)}</span>` : ""}</div>
        ${g.connected
          ? html`<p style="margin:0 0 8px"><span style="font-family:var(--font-display);font-size:34px">${fmt.num(g.totals.sessions)}</span> <span class="mp-muted">sessions · ${fmt.num(g.totals.users)} people</span></p>${lineChart(g.daily.map((d) => ({ label: fmt.date(`${d.date}T12:00`), value: d.sessions })))}`
          : html`<p class="mp-empty"><b>${g.configured ? "Google Analytics isn't responding." : "Google Analytics isn't connected to the portal yet."}</b> ${g.error || "Tracking is already running on the site. Add the three Google settings listed in Settings to see traffic here."}</p>`}
      </section>
      <section class="mp-card mp-panel mp-span-4">
        <div class="mp-panel__head"><h2>Intent signals</h2></div>
        ${g.connected ? barList(Object.entries(g.events).map(([k, v]) => ({ label: evName[k] || k, value: v })), { empty: "No signals yet." }) : html`<p class="mp-empty">Appears once GA4 is connected.</p>`}
      </section>
      <section class="mp-card mp-panel mp-span-6">
        <div class="mp-panel__head"><h2>Opportunities by source</h2></div>
        ${a.sources.length
          ? html`<table class="mp-table"><thead><tr><th>Source</th><th class="num">Opps</th><th class="num">Won</th>${can("finance.read") ? html`<th class="num">Won value</th>` : ""}</tr></thead><tbody>${a.sources.map((s) => html`<tr><td>${s.label}</td><td class="num">${s.opportunities}</td><td class="num">${s.won}</td>${can("finance.read") ? html`<td class="num">${fmt.money(s.wonValue, { compact: true })}</td>` : ""}</tr>`)}</tbody></table>`
          : html`<p class="mp-empty">No opportunities in this period.</p>`}
      </section>
      <section class="mp-card mp-panel mp-span-6">
        <div class="mp-panel__head"><h2>Work read before reaching out</h2></div>
        ${barList(a.work.pages.map((p) => ({ label: p.label, value: p.inquiries, won: p.won })), { valueLabel: (i) => `${i.value}${i.won ? ` · ${i.won} won` : ""}`, empty: "Shows which case studies people read before sending the form." })}
        ${a.work.inquiriesWithPages ? html`<p class="mp-sub" style="margin-top:10px">Based on ${a.work.inquiriesWithPages} inquir${a.work.inquiriesWithPages === 1 ? "y" : "ies"} with browsing history.</p>` : ""}
      </section>
      ${g.connected
        ? html`<section class="mp-card mp-panel mp-span-6"><div class="mp-panel__head"><h2>Top pages</h2></div>${barList(g.pages.map((p) => ({ label: p.path, value: p.views })), { valueLabel: (i) => `${fmt.num(i.value)} views` })}</section>
               <section class="mp-card mp-panel mp-span-6"><div class="mp-panel__head"><h2>Channels</h2></div>${barList(g.channels.map((c) => ({ label: c.channel, value: c.sessions })), { valueLabel: (i) => `${fmt.num(i.value)} sessions` })}</section>`
        : ""}
      <section class="mp-card mp-panel mp-span-6"><div class="mp-panel__head"><h2>Project conversion</h2><span class="mp-muted" style="font-size:12.5px">${a.funnels.project.cohort.size} created in period</span></div>${barList(cohort(a.funnels.project), { empty: "No project opportunities in this period." })}</section>
      <section class="mp-card mp-panel mp-span-6"><div class="mp-panel__head"><h2>Job search progression</h2><span class="mp-muted" style="font-size:12.5px">${a.funnels.job.cohort.size} created in period</span></div>${barList(cohort(a.funnels.job), { empty: "No job opportunities in this period." })}</section>
    </div>
  `);
  wirePeriod(el, "analytics", query);
}

// ---------- activity ----------

export async function activityView(el) {
  mount(el, html`<div class="mp-skel" style="height:300px"></div>`);
  let { items } = await api("activity?limit=60");
  const render = () =>
    mount(el, html`
      <header class="mp-head"><div><p class="mp-eyebrow">Activity</p><h1>Everything that <em>happened.</em></h1><p class="mp-sub">Recorded automatically as inquiries arrive and work moves.</p></div></header>
      <section class="mp-card mp-panel">
        ${items.length ? html`<ul class="mp-timeline">${items.map((e) => eventLine(e))}</ul>` : html`<p class="mp-empty">Nothing yet.</p>`}
        ${items.length >= 60 ? html`<button class="mp-btn" data-more>Load older</button>` : ""}
      </section>
    `);
  render();
  el.addEventListener("click", async (e) => {
    if (!e.target.closest("[data-more]")) return;
    const older = await api(`activity?limit=60&before=${encodeURIComponent(items[items.length - 1].at)}`);
    items = items.concat(older.items);
    render();
  });
}

// ---------- settings ----------

export async function settingsView(el) {
  mount(el, html`<div class="mp-skel" style="height:300px"></div>`);
  const [integrations, keys] = await Promise.all([api("integrations"), can("apikeys.manage") ? api("api-keys") : Promise.resolve(null)]);
  const pill = (ok) => html`<span class="mp-badge mp-badge--${ok ? "won" : "warn"} mp-badge--dot">${ok ? "Connected" : "Not set up"}</span>`;
  mount(el, html`
    <header class="mp-head"><div><p class="mp-eyebrow">Settings</p><h1>Portal <em>settings.</em></h1></div></header>
    <div class="mp-ov">
      <section class="mp-card mp-panel mp-span-6">
        <div class="mp-panel__head"><h2>Your account</h2></div>
        <dl class="mp-facts">
          <div><dt>Signed in as</dt><dd>${state.me.user.name}</dd></div>
          <div><dt>Role</dt><dd>${state.me.user.role.replace("_", " ")}</dd></div>
          <div><dt>Session</dt><dd>Ends after 4 idle hours, or 12 hours at most</dd></div>
        </dl>
        <div class="mp-actions" style="margin-top:14px"><button class="mp-btn" data-signout>Sign out</button>${can("export") ? html`<a class="mp-btn" href="/api/manager/export" download>Download all data (JSON)</a>` : ""}</div>
      </section>
      <section class="mp-card mp-panel mp-span-6">
        <div class="mp-panel__head"><h2>Connections</h2></div>
        <ul class="mp-list">
          <li class="mp-task" style="grid-template-columns:1fr auto"><span><span class="mp-task__title">Google Analytics 4</span><div class="mp-task__meta">Traffic, top pages, channels. Uses ${integrations.ga4.vars.join(", ")}</div></span>${pill(integrations.ga4.configured)}</li>
          <li class="mp-task" style="grid-template-columns:1fr auto"><span><span class="mp-task__title">New-inquiry email alerts</span><div class="mp-task__meta">Optional, through Resend. Uses ${integrations.email.vars.join(", ")}</div></span>${pill(integrations.email.configured)}</li>
          <li class="mp-task" style="grid-template-columns:1fr auto"><span><span class="mp-task__title">Data storage</span><div class="mp-task__meta">${integrations.storage.provider}, private to this site</div></span>${pill(true)}</li>
          <li class="mp-task" style="grid-template-columns:1fr auto"><span><span class="mp-task__title">Jarvis</span><div class="mp-task__meta">Reads this portal through an API key below</div></span>${pill(Boolean(keys?.items?.some((k) => !k.revokedAt)))}</li>
        </ul>
      </section>
      ${keys
        ? html`<section class="mp-card mp-panel mp-span-12">
            <div class="mp-panel__head"><h2>API keys (Jarvis and other services)</h2><button data-newkey>+ New key</button></div>
            <p class="mp-sub" style="margin:0 0 10px">Each key has its own permissions and can be revoked any time. Keys are shown once; only a fingerprint is stored.</p>
            ${keys.items.length
              ? html`<ul class="mp-list">${keys.items.map((k) => html`<li class="mp-task" style="grid-template-columns:1fr auto"><span><span class="mp-task__title">${k.name}</span><div class="mp-task__meta">${k.scopes.join(", ")} · created ${fmt.date(k.createdAt)} · ${k.lastUsedAt ? `last used ${fmt.rel(k.lastUsedAt)}` : "never used"}</div></span>${k.revokedAt ? html`<span class="mp-badge mp-badge--lost">Revoked</span>` : html`<button class="mp-btn mp-btn--small mp-btn--danger" data-revoke="${k.id}" data-name="${k.name}">Revoke</button>`}</li>`)}</ul>`
              : html`<p class="mp-empty">No keys yet. Create one named "Jarvis" with read access when you connect Jarvis.</p>`}
          </section>`
        : ""}
      <section class="mp-card mp-panel mp-span-12">
        <div class="mp-panel__head"><h2>Pipelines</h2></div>
        <div class="mp-ov">${Object.entries(state.config.pipelines).map(([kind, p]) => html`<div class="mp-span-6"><b>${p.label}</b><p class="mp-sub">${p.stages.map((s) => s.label).join(" → ")}</p></div>`)}</div>
        <p class="mp-sub" style="margin-top:10px">Stages, reasons, and lists live in one configuration file (netlify/lib/model.js), so they can change without rebuilding the portal.</p>
      </section>
    </div>
  `);
  el.querySelector("[data-signout]").addEventListener("click", () => window.dispatchEvent(new Event("portal:signout")));
  el.querySelector("[data-newkey]")?.addEventListener("click", () =>
    formSheet({
      title: "New API key",
      fields: [
        { name: "name", label: "Who is it for?", required: true, value: "Jarvis", max: 60 },
        { name: "scopes", label: "What it may do", type: "checks", value: ["read", "read_financial", "suggest"], options: Object.entries(keys.scopes).filter(([k]) => ["read", "read_financial", "suggest"].includes(k)) },
      ],
      submitLabel: "Create key",
      onSubmit: async (v) => {
        const res = await api("api-keys", { method: "POST", body: v });
        setTimeout(() => showKey(res.token), 80);
      },
    }),
  );
  el.querySelectorAll("[data-revoke]").forEach((b) =>
    b.addEventListener("click", () =>
      confirmSheet({
        title: `Revoke "${b.dataset.name}"?`,
        body: "Anything using this key stops working immediately. This can't be undone.",
        confirmLabel: "Revoke key",
        onConfirm: async () => {
          await api(`api-keys/${b.dataset.revoke}`, { method: "DELETE" });
          toast("Key revoked");
          window.dispatchEvent(new Event("portal:refresh"));
        },
      }),
    ),
  );
}

function showKey(token) {
  const d = document.getElementById("sheet");
  mount(d, html`<div class="mp-form"><h2 id="sheet-title">Copy this key now</h2>
    <p class="mp-sub">It won't be shown again. In Jarvis's Netlify settings, set SEAN_PORTAL_API_BASE_URL to https://seandespain.com/api/jarvis/v1 and SEAN_PORTAL_API_KEY to this value.</p>
    <p class="mp-code">${token}</p>
    <div class="mp-form__foot"><button class="mp-btn" data-copy>Copy</button><button class="mp-btn mp-btn--primary" data-close>Done</button></div></div>`);
  d.querySelector("[data-copy]").addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(token);
      toast("Copied");
    } catch {
      toast("Select the key and copy it", "error");
    }
  });
  d.querySelector("[data-close]").addEventListener("click", () => {
    d.close();
    window.dispatchEvent(new Event("portal:refresh"));
  });
  d.showModal();
}
