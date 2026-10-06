// Business metrics for seandespain.com: the handful of numbers that answer
// "is opportunity coming in, am I responding, what is it worth, and which
// work brings it in", plus the alerts that say what needs attention.
//
// Everything is computed from the CRM records at request time. A personal
// pipeline is small, so there are no rollup tables to keep in sync.
import { PIPELINES, SOURCES, WORK_PAGES, BUDGETS, labelOf, stageOf, stagesOfType, EVENT_TYPES } from "./model.js";

const DAY = 86_400_000;

export function parsePeriod(key = "30d", now = Date.now()) {
  const map = { "7d": 7, "30d": 30, "90d": 90, "12m": 365 };
  if (key === "all") return { key, from: 0, to: now, prevFrom: null, prevTo: null, days: null };
  const days = map[key] || 30;
  const from = now - days * DAY;
  return { key: map[key] ? key : "30d", from, to: now, prevFrom: from - days * DAY, prevTo: from, days };
}

const t = (iso) => (iso ? Date.parse(iso) : NaN);
const within = (iso, from, to) => {
  const ms = t(iso);
  return ms >= from && ms < to;
};
const qualified = (o) => o.lossReason !== "not_genuine";
export const oppValue = (o) => o.value?.final ?? o.value?.estimate ?? 0;
const stageType = (o) => stageOf(o.kind, o.stage)?.type;
const median = (arr) => {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const sum = (arr) => arr.reduce((a, b) => a + b, 0);

function kpi(key, label, value, previous, { unit = "count", betterWhen = "higher", definition, ...extra } = {}) {
  const change = previous == null || value == null ? null : value - previous;
  return { key, label, value, previous: previous ?? null, change, changePct: change != null && previous ? change / previous : null, unit, betterWhen, definition, ...extra };
}

function weeklySeries(items, at, weeks = 12, now = Date.now()) {
  const out = Array(weeks).fill(0);
  for (const it of items) {
    const age = Math.floor((now - t(at(it))) / (7 * DAY));
    if (age >= 0 && age < weeks) out[weeks - 1 - age] += 1;
  }
  return out;
}

function monthlySeries(entries, months = 12, now = new Date()) {
  const out = [];
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    out.push({ month: d.toISOString().slice(0, 7), value: 0 });
  }
  for (const { at, amount } of entries) {
    const slot = out.find((m) => m.month === at.slice(0, 7));
    if (slot) slot.value += amount;
  }
  return out;
}

// ---- KPIs ----

export function computeKpis(state, period) {
  const opps = Object.values(state.opps);
  const tasks = Object.values(state.tasks);
  const now = period.to;
  const hasPrev = period.prevFrom != null;

  const created = (from, to) => opps.filter((o) => qualified(o) && within(o.createdAt, from, to));
  const newNow = created(period.from, period.to);
  const newPrev = hasPrev ? created(period.prevFrom, period.prevTo) : null;

  const replyTasks = tasks.filter((x) => x.kind === "reply");
  const waiting = replyTasks.filter((x) => x.status === "open");
  const oldestWait = waiting.length ? Math.max(...waiting.map((x) => now - t(x.createdAt))) / 3600e3 : null;
  const responseHours = (from, to) =>
    median(replyTasks.filter((x) => x.status === "done" && within(x.createdAt, from, to)).map((x) => (t(x.completedAt) - t(x.createdAt)) / 3600e3));
  const respNow = responseHours(period.from, period.to);
  const respPrev = hasPrev ? responseHours(period.prevFrom, period.prevTo) : null;

  const openProjects = opps.filter((o) => o.kind === "project" && stageType(o) === "open");
  const pipelineValue = sum(openProjects.map(oppValue));
  const weighted = sum(openProjects.map((o) => oppValue(o) * (stageOf(o.kind, o.stage)?.probability ?? 0)));

  const won = (from, to) => opps.filter((o) => o.kind === "project" && o.wonAt && within(o.wonAt, from, to));
  const wonNow = won(period.from, period.to);
  const wonPrev = hasPrev ? won(period.prevFrom, period.prevTo) : null;

  const interviewing = opps.filter((o) => o.kind === "job" && ["screening", "interviewing", "offer"].includes(o.stage));

  const decided = (from, to) =>
    opps.filter((o) => o.kind === "project" && o.direction === "inbound" && qualified(o) && ((o.wonAt && within(o.wonAt, from, to)) || (stageType(o) === "lost" && within(o.closedAt, from, to))));
  const decNow = decided(period.from, period.to);
  const decPrev = hasPrev ? decided(period.prevFrom, period.prevTo) : null;
  const rate = (list) => (list && list.length ? list.filter((o) => o.wonAt).length / list.length : null);

  return [
    kpi("new_opportunities", "New opportunities", newNow.length, newPrev?.length, {
      definition: "Project inquiries and job opportunities created in the period, excluding spam.",
      breakdown: { project: newNow.filter((o) => o.kind === "project").length, job: newNow.filter((o) => o.kind === "job").length, inbound: newNow.filter((o) => o.direction === "inbound").length },
      series: weeklySeries(opps.filter(qualified), (o) => o.createdAt, 12, now),
    }),
    kpi("awaiting_reply", "Awaiting your reply", waiting.length, null, {
      betterWhen: "lower",
      definition: "Inquiries and messages with an open Reply task.",
      oldestHours: oldestWait != null ? Math.round(oldestWait) : null,
    }),
    kpi("response_time", "Median reply time", respNow != null ? Math.round(respNow * 10) / 10 : null, respPrev != null ? Math.round(respPrev * 10) / 10 : null, {
      unit: "hours", betterWhen: "lower",
      definition: "Median hours from an inquiry arriving to your first reply, for inquiries received in the period.",
    }),
    kpi("project_pipeline", "Open project pipeline", pipelineValue, null, {
      unit: "usd", financial: true,
      definition: "Estimated value of client projects not yet won or lost.",
      count: openProjects.length, weighted: Math.round(weighted),
    }),
    kpi("won_value", "Won project value", sum(wonNow.map(oppValue)), wonPrev ? sum(wonPrev.map(oppValue)) : null, {
      unit: "usd", financial: true,
      definition: "Agreed value of client projects won in the period.",
      count: wonNow.length,
      series: monthlySeries(opps.filter((o) => o.kind === "project" && o.wonAt).map((o) => ({ at: o.wonAt, amount: oppValue(o) })), 12, new Date(now)).map((m) => m.value),
    }),
    kpi("active_interviews", "Roles in interviews", interviewing.length, null, {
      definition: "Job opportunities currently at screening, interviewing, or offer.",
      breakdown: Object.fromEntries(["screening", "interviewing", "offer"].map((s) => [s, interviewing.filter((o) => o.stage === s).length])),
    }),
    kpi("win_rate", "Inquiry win rate", rate(decNow), rate(decPrev), {
      unit: "ratio",
      definition: "Of inbound project inquiries decided in the period, the share you won.",
      won: decNow.filter((o) => o.wonAt).length, decided: decNow.length,
    }),
  ];
}

// ---- what needs attention ----

export function computeAlerts(state, now = Date.now()) {
  const alerts = [];
  const opps = Object.values(state.opps);
  const tasks = Object.values(state.tasks);
  const title = (task) => relatedTitle(state, task);

  for (const task of tasks) {
    if (task.status !== "open") continue;
    if (task.kind === "reply") {
      const hours = (now - t(task.createdAt)) / 3600e3;
      if (hours >= 24) {
        alerts.push({ key: "reply_overdue", severity: hours >= 48 ? "high" : "medium", title: task.title, detail: `Waiting ${Math.round(hours)} hours`, entity: entityOf(task), at: task.createdAt });
      }
    } else if (task.dueAt && t(task.dueAt) < now) {
      alerts.push({ key: "task_overdue", severity: task.priority === "high" ? "high" : "medium", title: task.title, detail: `Due ${relDays(task.dueAt, now)}${title(task) ? ` · ${title(task)}` : ""}`, entity: entityOf(task), at: task.dueAt });
    } else if (["interview", "call"].includes(task.kind) && task.dueAt && t(task.dueAt) - now < 2 * DAY) {
      alerts.push({ key: "coming_up", severity: "info", title: task.title, detail: `${relDays(task.dueAt, now)}${title(task) ? ` · ${title(task)}` : ""}`, entity: entityOf(task), at: task.dueAt });
    }
  }

  for (const o of opps) {
    const st = stageOf(o.kind, o.stage);
    if (st?.type === "open" && st.staleDays) {
      const contact = state.contacts[o.contactId];
      const last = Math.max(t(o.stageEnteredAt), t(o.updatedAt), t(contact?.lastInteractionAt) || 0);
      const days = (now - last) / DAY;
      const replyPending = tasks.some((x) => x.kind === "reply" && x.status === "open" && x.relatedId === o.id);
      if (days > st.staleDays && !replyPending) {
        alerts.push({ key: "opportunity_stale", severity: "medium", title: o.title, detail: `${st.label} for ${Math.floor(days)} days with no activity`, entity: { type: "opportunity", id: o.id }, at: o.stageEnteredAt });
      }
    }
    if (o.kind === "project" && st?.type === "won") {
      const invoiced = sum(o.payments.filter((p) => p.type === "invoiced").map((p) => p.amount));
      const received = sum(o.payments.filter((p) => p.type === "received").map((p) => p.amount));
      if (invoiced - received > 0) {
        alerts.push({ key: "payment_outstanding", severity: o.stage === "delivered" ? "medium" : "info", financial: true, title: o.title, detail: `$${(invoiced - received).toLocaleString("en-US")} invoiced, not yet received`, entity: { type: "opportunity", id: o.id }, at: o.updatedAt });
      }
    }
    if (o.kind === "project" && o.stage === "inquiry" && oppValue(o) >= 10000 && now - t(o.createdAt) < 7 * DAY) {
      alerts.push({ key: "high_value_lead", severity: "info", financial: true, title: o.title, detail: `Budget around $${oppValue(o).toLocaleString("en-US")}`, entity: { type: "opportunity", id: o.id }, at: o.createdAt });
    }
  }

  const suggested = tasks.filter((x) => x.status === "suggested");
  if (suggested.length) {
    alerts.push({ key: "suggestions_pending", severity: "info", title: `${suggested.length} suggested task${suggested.length > 1 ? "s" : ""} to review`, detail: "Proposed by Jarvis, waiting for your OK", entity: { type: "tasks", id: "suggested" }, at: suggested[0].createdAt });
  }

  const rank = { high: 0, medium: 1, info: 2 };
  return alerts.sort((a, b) => rank[a.severity] - rank[b.severity] || t(a.at) - t(b.at));
}

function entityOf(task) {
  return task.relatedType && task.relatedId ? { type: task.relatedType, id: task.relatedId } : { type: "task", id: task.id };
}

export function relatedTitle(state, task) {
  if (task.relatedType === "opportunity") return state.opps[task.relatedId]?.title || null;
  if (task.relatedType === "contact") return state.contacts[task.relatedId]?.name || null;
  return null;
}

function relDays(iso, now) {
  const d = Math.round((t(iso) - now) / DAY);
  if (d === 0) return "today";
  if (d === 1) return "tomorrow";
  if (d === -1) return "yesterday";
  return d < 0 ? `${-d} days ago` : `in ${d} days`;
}

// ---- pipeline shape ----

export function computeFunnel(state, kind, period) {
  const opps = Object.values(state.opps).filter((o) => o.kind === kind && qualified(o));
  const stages = PIPELINES[kind].stages;
  const order = stages.map((s) => s.key);
  const cohort = opps.filter((o) => within(o.createdAt, period.from, period.to));
  const reachedIndex = (o) => Math.max(...o.stageHistory.map((h) => (stageOf(kind, h.stage)?.type === "lost" ? -1 : order.indexOf(h.stage))));
  return {
    kind,
    current: stages.map((s) => {
      const here = opps.filter((o) => o.stage === s.key);
      return { stage: s.key, label: s.label, type: s.type, count: here.length, value: sum(here.map(oppValue)) };
    }),
    cohort: {
      size: cohort.length,
      reached: stages.filter((s) => s.type !== "lost").map((s, i) => ({ stage: s.key, label: s.label, count: cohort.filter((o) => reachedIndex(o) >= i).length })),
      lost: cohort.filter((o) => stageOf(kind, o.stage)?.type === "lost").length,
    },
  };
}

export function computeSources(state, period) {
  const opps = Object.values(state.opps).filter((o) => qualified(o) && within(o.createdAt, period.from, period.to));
  const groups = {};
  for (const o of opps) {
    const g = (groups[o.source || "unknown"] ||= { source: o.source || "unknown", label: labelOf(SOURCES, o.source || "unknown"), opportunities: 0, projects: 0, jobs: 0, won: 0, wonValue: 0 });
    g.opportunities += 1;
    g[o.kind === "project" ? "projects" : "jobs"] += 1;
    if (o.wonAt) {
      g.won += 1;
      if (o.kind === "project") g.wonValue += oppValue(o);
    }
  }
  return Object.values(groups).sort((a, b) => b.opportunities - a.opportunities || b.won - a.won);
}

/** Which case studies and pages people read before they reached out. */
export function computeWorkAttraction(state, period) {
  const inbound = Object.values(state.opps).filter((o) => o.direction === "inbound" && qualified(o) && within(o.createdAt, period.from, period.to));
  const counts = {};
  for (const o of inbound) {
    const pages = new Set((o.attribution?.pages || []).map((p) => (p.endsWith("/") ? p : `${p}/`)));
    for (const p of pages) {
      if (!WORK_PAGES[p]) continue;
      const c = (counts[p] ||= { path: p, label: WORK_PAGES[p], inquiries: 0, won: 0 });
      c.inquiries += 1;
      if (o.wonAt) c.won += 1;
    }
  }
  return { inquiriesWithPages: inbound.filter((o) => o.attribution?.pages?.length).length, pages: Object.values(counts).sort((a, b) => b.inquiries - a.inquiries) };
}

export function computeUpcoming(state, now = Date.now(), days = 14) {
  return Object.values(state.tasks)
    .filter((x) => x.status === "open" && x.dueAt && t(x.dueAt) < now + days * DAY)
    .sort((a, b) => t(a.dueAt) - t(b.dueAt))
    .slice(0, 20)
    .map((x) => ({ id: x.id, title: x.title, kind: x.kind, priority: x.priority, dueAt: x.dueAt, overdue: t(x.dueAt) < now, related: relatedTitle(state, x), relatedType: x.relatedType, relatedId: x.relatedId }));
}

// ---- money (management view, not accounting) ----

export function computeMoney(state, period) {
  const projects = Object.values(state.opps).filter((o) => o.kind === "project");
  const won = projects.filter((o) => o.wonAt);
  const payments = projects.flatMap((o) => o.payments.map((p) => ({ ...p, opportunityId: o.id, title: o.title })));
  const paid = (type, from, to) => sum(payments.filter((p) => p.type === type && within(p.at, from, to)).map((p) => p.amount));
  const invoicedAll = sum(payments.filter((p) => p.type === "invoiced").map((p) => p.amount));
  const receivedAll = sum(payments.filter((p) => p.type === "received").map((p) => p.amount));
  const agreedActive = sum(won.filter((o) => o.stage !== "lost").map(oppValue));
  const byService = {};
  for (const o of won.filter((x) => within(x.wonAt, period.from, period.to))) byService[o.service || "other"] = (byService[o.service || "other"] || 0) + oppValue(o);

  const jobsWithOffers = Object.values(state.opps).filter((o) => o.kind === "job" && ["offer", "accepted"].includes(o.stage));
  return {
    currency: "USD",
    period: { won: sum(won.filter((o) => within(o.wonAt, period.from, period.to)).map(oppValue)), invoiced: paid("invoiced", period.from, period.to), received: paid("received", period.from, period.to) },
    previous: period.prevFrom != null ? { won: sum(won.filter((o) => within(o.wonAt, period.prevFrom, period.prevTo)).map(oppValue)), received: paid("received", period.prevFrom, period.prevTo) } : null,
    outstanding: Math.max(0, invoicedAll - receivedAll),
    notYetInvoiced: Math.max(0, agreedActive - invoicedAll),
    averageProjectValue: won.length ? Math.round(sum(won.map(oppValue)) / won.length) : null,
    wonCount: won.length,
    byService: Object.entries(byService).map(([service, value]) => ({ service, value })).sort((a, b) => b.value - a.value),
    receivedByMonth: monthlySeries(payments.filter((p) => p.type === "received"), 12),
    recentPayments: payments.sort((a, b) => b.at.localeCompare(a.at)).slice(0, 10),
    offers: jobsWithOffers.map((o) => ({ id: o.id, title: o.title, stage: o.stage, compensation: o.value?.final ?? o.value?.estimate ?? null })),
    note: "Management numbers from the pipeline, not an accounting ledger.",
  };
}

// ---- normalized report for Jarvis ----
//
// Common shape across every business Jarvis watches, with this business's
// own detail under `specific`. No emails, phone numbers, or message text.

export const REPORT_SCHEMA = "jarvis.business_report";
export const REPORT_VERSION = "1.0";

export function buildBusinessReport(state, events, period, { financial = false } = {}) {
  const kpis = computeKpis(state, period).map((k) => (k.financial && !financial ? { ...k, value: null, previous: null, change: null, changePct: null, series: undefined, redacted: true } : k));
  const opps = Object.values(state.opps);
  const newOpps = opps.filter((o) => within(o.createdAt, period.from, period.to));
  const openProjects = opps.filter((o) => o.kind === "project" && stageType(o) === "open");
  const money = computeMoney(state, period);
  const alerts = computeAlerts(state, period.to).filter((a) => financial || !a.financial);
  const projectFunnel = computeFunnel(state, "project", period);
  const jobFunnel = computeFunnel(state, "job", period);
  const cohort = projectFunnel.cohort;
  const reached = (key) => cohort.reached.find((r) => r.stage === key)?.count ?? 0;
  const daysToWin = opps.filter((o) => o.kind === "project" && o.wonAt && within(o.wonAt, period.from, period.to)).map((o) => (t(o.wonAt) - t(o.createdAt)) / DAY);

  return {
    schema: REPORT_SCHEMA,
    schemaVersion: REPORT_VERSION,
    business: { id: "sean-despain", name: "Sean Despain", type: "portfolio", domain: "seandespain.com", currency: "USD", timezone: "America/Denver" },
    generatedAt: new Date(period.to).toISOString(),
    period: { key: period.key, from: new Date(period.from).toISOString(), to: new Date(period.to).toISOString(), previousFrom: period.prevFrom != null ? new Date(period.prevFrom).toISOString() : null, previousTo: period.prevTo != null ? new Date(period.prevTo).toISOString() : null },
    kpis,
    leads: {
      new: newOpps.length,
      qualified: newOpps.filter(qualified).length,
      inbound: newOpps.filter((o) => o.direction === "inbound").length,
      bySource: computeSources(state, period).map(({ source, label, opportunities, won }) => ({ source, label, count: opportunities, won })),
    },
    pipeline: {
      valueKind: "revenue",
      open: { count: openProjects.length, value: financial ? sum(openProjects.map(oppValue)) : null, weightedValue: financial ? Math.round(sum(openProjects.map((o) => oppValue(o) * (stageOf(o.kind, o.stage)?.probability ?? 0)))) : null },
      byStage: projectFunnel.current.map((s) => ({ ...s, value: financial ? s.value : null })),
    },
    conversions: {
      inquiryToConversation: cohort.size ? reached("conversation") / cohort.size : null,
      inquiryToWon: cohort.size ? reached("active") / cohort.size : null,
      medianDaysToWin: median(daysToWin),
    },
    revenue: financial ? { won: money.period.won, received: money.period.received, outstanding: money.outstanding, currency: "USD" } : null,
    attention: alerts.map(({ key, severity, title, detail, entity, at }) => ({ key, severity, title, detail, entity, at })),
    upcoming: computeUpcoming(state, period.to).map(({ id, title, kind, dueAt, overdue, related }) => ({ id, title, kind, dueAt, overdue, related })),
    recentActivity: events.slice(0, 25).map((e) => ({ id: e.id, type: e.type, label: EVENT_TYPES[e.type] || e.type, at: e.at, summary: e.summary, opportunityId: e.opportunityId, contactId: e.contactId })),
    traffic: { source: "ga4", note: "Website traffic comes from GA4, which Jarvis reads directly. Not duplicated here." },
    specific: {
      portfolio: {
        jobSearch: { open: jobFunnel.current.filter((s) => s.type === "open").map(({ stage, label, count }) => ({ stage, label, count })), cohort: jobFunnel.cohort },
        workThatAttractsOpportunity: computeWorkAttraction(state, period).pages,
        responseTime: kpis.find((k) => k.key === "response_time"),
      },
    },
  };
}

export const budgetsByKey = Object.fromEntries(BUDGETS.map(([k, label, mid]) => [k, { label, mid }]));
export { stagesOfType };
