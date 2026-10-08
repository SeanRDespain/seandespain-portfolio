// Numbers, calendars, and exports, computed from the saved records.
//
// Definitions (also documented in JARVIS-HANDOFF.md):
//   new client inquiries  client-work inquiries created in the period (not spam)
//   follow-ups due        open tasks due by the end of today (incl. overdue)
//   active projects       projects in planning, in progress, or review
//   open employment       employment opportunities not yet accepted or closed
//   quoted pipeline       quotes on open client opportunities (discovery, proposal)
//   cash collected        payments received in the period (manual entries)
//   unpaid balances       recorded value minus collected, on non-cancelled projects
// Employment is never counted as a sale. Test ("[TEST]") and archived
// records are excluded everywhere.
import { BUSINESS, OPPORTUNITY_TYPES, PROJECT_STAGES, INQUIRY_TYPES, stageOf, labelOf, inquiryIsOpen, projectPhase, WORK_PAGES, SOURCES, TASK_KINDS } from "./model.js";

const DAY = 86_400_000;
const live = (r) => r && !r.isTest && !r.archivedAt;
const t = (iso) => (iso ? Date.parse(iso) : NaN);
const within = (iso, r) => t(iso) >= r.from && t(iso) < r.to;
const sum = (a) => a.reduce((x, y) => x + y, 0);
const usd = (amount) => (amount == null ? null : { amount: Math.round(amount * 100) / 100, currency: BUSINESS.currency });

// ---- dates in the reporting timezone (America/Denver) ----

function offsetMs(utcMs, tz) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).formatToParts(new Date(utcMs)).map((p) => [p.type, p.value]));
  return Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second) - utcMs;
}
/** UTC instant of local midnight for a YYYY-MM-DD date in the reporting timezone. */
export function startOfDay(ymd, tz = BUSINESS.timezone) {
  const [y, m, d] = ymd.split("-").map(Number);
  let guess = Date.UTC(y, m - 1, d);
  for (let i = 0; i < 2; i++) guess = Date.UTC(y, m - 1, d) - offsetMs(guess, tz);
  return guess;
}
export function localYmd(ms = Date.now(), tz = BUSINESS.timezone) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(ms));
}
const addDaysYmd = (ymd, n) => new Date(Date.UTC(...ymd.split("-").map((x, i) => (i === 1 ? x - 1 : +x))) + n * DAY).toISOString().slice(0, 10);

/**
 * A reporting range: whole local days, `from` inclusive and `to` inclusive,
 * expressed as UTC instants [from, to). Defaults to the last 30 days.
 */
export function parseRange({ from, to, period } = {}, now = Date.now()) {
  const ymd = /^\d{4}-\d{2}-\d{2}$/;
  const today = localYmd(now);
  const days = { "7d": 7, "30d": 30, "90d": 90, "12m": 365 }[period] || 30;
  const toDay = to && ymd.test(to) ? to : today;
  const fromDay = from && ymd.test(from) ? from : addDaysYmd(toDay, -(days - 1));
  if (fromDay > toDay) throw Object.assign(new Error("from must be on or before to"), { status: 400 });
  const span = Math.round((startOfDay(addDaysYmd(toDay, 1)) - startOfDay(fromDay)) / DAY);
  const r = { fromDate: fromDay, toDate: toDay, from: startOfDay(fromDay), to: startOfDay(addDaysYmd(toDay, 1)), timezone: BUSINESS.timezone, days: span };
  r.prev = { from: startOfDay(addDaysYmd(fromDay, -span)), to: r.from };
  return r;
}

// ---- derived record facts ----

export function projectMoney(p) {
  const collected = sum((p.payments || []).filter((x) => !x.archivedAt).map((x) => x.amount));
  const value = p.value?.amount ?? null;
  const balance = value == null || p.stage === "cancelled" ? null : Math.max(0, value - collected);
  const status = value == null ? "no_value" : collected <= 0 ? "unpaid" : collected < value ? "partial" : "paid";
  return { value, collected, balance, status, source: "manual_entry" };
}

const openTasksFor = (state, type, id) => Object.values(state.tasks).filter((x) => live(x) && x.status === "open" && x.relatedType === type && x.relatedId === id).sort((a, b) => (a.dueAt || "9").localeCompare(b.dueAt || "9"));
export const nextFollowUp = (state, type, id) => openTasksFor(state, type, id)[0]?.dueAt || null;

// ---- overview numbers ----

export function computeMetrics(state, range, now = Date.now()) {
  const inquiries = Object.values(state.inquiries).filter(live);
  const opps = Object.values(state.opps).filter(live);
  const projects = Object.values(state.projects).filter(live);
  const tasks = Object.values(state.tasks).filter(live);
  const endOfToday = startOfDay(addDaysYmd(localYmd(now), 1));

  const clientInq = (r) => inquiries.filter((i) => i.type === "client_work" && i.status !== "spam" && within(i.createdAt, r));
  const due = tasks.filter((x) => x.status === "open" && x.dueAt && t(x.dueAt) < endOfToday && ["follow_up", "reply", "call", "appointment", "interview"].includes(x.kind));
  const activeProjects = projects.filter((p) => projectPhase(p.stage) === "active");
  const openEmployment = opps.filter((o) => o.type === "employment" && stageOf("employment", o.stage)?.type === "open");
  const interviewing = openEmployment.filter((o) => ["screening", "interviewing"].includes(o.stage));
  const interviewsScheduled = tasks.filter((x) => x.kind === "interview" && x.status === "open" && t(x.dueAt) >= now);
  const openClient = opps.filter((o) => o.type === "client" && stageOf("client", o.stage)?.type === "open");
  const quoted = openClient.filter((o) => o.quote?.amount != null);
  const payments = projects.flatMap((p) => (p.payments || []).filter((x) => !x.archivedAt));
  const cash = (r) => sum(payments.filter((x) => within(x.receivedAt, r)).map((x) => x.amount));
  const unpaid = projects.map((p) => ({ p, m: projectMoney(p) })).filter(({ m }) => m.balance > 0);

  return {
    new_client_inquiries: { value: clientInq(range).length, previous: clientInq(range.prev).length, label: "New client inquiries" },
    follow_ups_due: { value: due.length, overdue: due.filter((x) => t(x.dueAt) < now).length, label: "Follow-ups due" },
    active_projects: { value: activeProjects.length, label: "Active projects" },
    open_employment: { value: openEmployment.length, interviewing: interviewing.length, interviews_scheduled: interviewsScheduled.length, label: "Open employment opportunities" },
    quoted_pipeline: { value: usd(sum(quoted.map((o) => o.quote.amount))), quoted: quoted.length, unquoted: openClient.length - quoted.length, label: "Quoted pipeline" },
    cash_collected: { value: usd(cash(range)), previous: usd(cash(range.prev)), source: "manual_entry", label: "Cash collected" },
    unpaid_balances: { value: usd(sum(unpaid.map(({ m }) => m.balance))), projects: unpaid.length, source: "manual_entry", label: "Unpaid balances" },
  };
}

// ---- needs attention ----

export function computeAttention(state, now = Date.now(), { userId = null } = {}) {
  const out = [];
  const mine = (assignee) => !userId || assignee === userId;
  if (!userId) {
    for (const i of Object.values(state.inquiries).filter(live)) {
      const hours = (now - t(i.createdAt)) / 3600e3;
      if (i.status === "new" && hours >= 24) out.push({ key: "inquiry_unanswered", severity: hours >= 48 ? "high" : "medium", title: `Reply to ${i.contactName || "an inquiry"}`, detail: `${labelOf(INQUIRY_TYPES, i.type)} · waiting ${Math.round(hours)}h`, entity: { type: "inquiry", id: i.id }, at: i.createdAt });
    }
  }
  for (const x of Object.values(state.tasks).filter(live)) {
    if (x.status !== "open" || !x.dueAt || !mine(x.assigneeId)) continue;
    if (x.kind === "reply" && x.relatedType === "inquiry" && !userId) continue; // covered above
    if (t(x.dueAt) < now) out.push({ key: "task_overdue", severity: x.priority === "high" ? "high" : "medium", title: x.title, detail: `${labelOf(TASK_KINDS, x.kind)} · was due ${new Date(x.dueAt).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: BUSINESS.timezone })}`, entity: x.relatedType ? { type: x.relatedType, id: x.relatedId } : { type: "task", id: x.id }, at: x.dueAt });
    else if (["interview", "appointment", "call"].includes(x.kind) && t(x.dueAt) - now < 2 * DAY) out.push({ key: "coming_up", severity: "info", title: x.title, detail: `${labelOf(TASK_KINDS, x.kind)} · ${new Date(x.dueAt).toLocaleString("en-US", { weekday: "short", hour: "numeric", minute: "2-digit", timeZone: BUSINESS.timezone })}`, entity: x.relatedType ? { type: x.relatedType, id: x.relatedId } : { type: "task", id: x.id }, at: x.dueAt });
  }
  for (const p of Object.values(state.projects).filter(live)) {
    for (const d of p.deliverables.filter((d) => !d.archivedAt && d.status !== "done" && d.dueAt && mine(d.assigneeId))) {
      if (t(d.dueAt) < now) out.push({ key: "deliverable_overdue", severity: "high", title: d.title, detail: `${p.title} · deliverable overdue`, entity: { type: "project", id: p.id }, at: d.dueAt });
    }
    if (!userId && projectPhase(p.stage) === "active" && p.deadline) {
      const days = (t(p.deadline) - now) / DAY;
      if (days < 0) out.push({ key: "deadline_passed", severity: "high", title: p.title, detail: "Project deadline has passed", entity: { type: "project", id: p.id }, at: p.deadline });
      else if (days < 7) out.push({ key: "deadline_soon", severity: "medium", title: p.title, detail: `Deadline in ${Math.ceil(days)} day${Math.ceil(days) === 1 ? "" : "s"}`, entity: { type: "project", id: p.id }, at: p.deadline });
    }
    if (!userId && p.stage === "delivered") {
      const m = projectMoney(p);
      if (m.balance > 0) out.push({ key: "unpaid_delivered", severity: "medium", money: true, title: p.title, detail: `$${m.balance.toLocaleString("en-US")} unpaid after delivery`, entity: { type: "project", id: p.id }, at: p.updatedAt });
    }
  }
  const rank = { high: 0, medium: 1, info: 2 };
  return out.sort((a, b) => rank[a.severity] - rank[b.severity] || t(a.at) - t(b.at));
}

// ---- funnels (client and employment kept separate) ----

export function computeFunnels(state, range) {
  const opps = Object.values(state.opps).filter(live);
  const cohortInq = Object.values(state.inquiries).filter((i) => live(i) && i.type === "client_work" && i.status !== "spam" && within(i.createdAt, range));
  const convertedOpps = cohortInq.map((i) => (i.convertedTo ? state.opps[i.convertedTo.id] : null)).filter(Boolean);
  const client = [
    { stage: "inquiries", label: "Client inquiries", count: cohortInq.length },
    { stage: "opportunity", label: "Became opportunities", count: convertedOpps.length },
    { stage: "proposal", label: "Proposal sent", count: convertedOpps.filter((o) => o.proposalSentAt).length },
    { stage: "won", label: "Won", count: convertedOpps.filter((o) => o.wonAt).length },
  ];
  const emp = opps.filter((o) => o.type === "employment" && within(o.createdAt, range));
  const order = OPPORTUNITY_TYPES.employment.stages.filter((s) => s.type !== "lost");
  const reached = (o) => Math.max(...o.stageHistory.map((h) => order.findIndex((s) => s.key === h.stage)));
  const employment = order.map((s, i) => ({ stage: s.key, label: s.label, count: emp.filter((o) => reached(o) >= i).length }));
  const current = (type) => OPPORTUNITY_TYPES[type].stages.map((s) => ({ stage: s.key, label: s.label, type: s.type, count: opps.filter((o) => o.type === type && o.stage === s.key).length }));
  return { client, employment, current: { client: current("client"), employment: current("employment") } };
}

// ---- charts ----

export function computeCharts(state, now = Date.now()) {
  const weeks = 12;
  const inquiries = Object.values(state.inquiries).filter((i) => live(i) && i.status !== "spam");
  const weekly = Array.from({ length: weeks }, (_, i) => {
    const end = now - (weeks - 1 - i) * 7 * DAY;
    const start = end - 7 * DAY;
    const inWeek = inquiries.filter((x) => t(x.createdAt) >= start && t(x.createdAt) < end);
    return { weekStart: new Date(start).toISOString().slice(0, 10), client_work: inWeek.filter((x) => x.type === "client_work").length, employment: inWeek.filter((x) => x.type === "employment").length, general: inWeek.filter((x) => x.type === "general").length };
  });
  const payments = Object.values(state.projects).filter(live).flatMap((p) => (p.payments || []).filter((x) => !x.archivedAt));
  const months = Array.from({ length: 12 }, (_, i) => {
    const d = new Date();
    d.setUTCDate(1);
    d.setUTCMonth(d.getUTCMonth() - (11 - i));
    const key = d.toISOString().slice(0, 7);
    return { month: key, amount: sum(payments.filter((x) => localYmd(t(x.receivedAt)).slice(0, 7) === key).map((x) => x.amount)) };
  });
  return { inquiriesByWeek: weekly, cashByMonth: months, currency: BUSINESS.currency, cashSource: "manual_entry" };
}

// ---- calendar ----

export function calendarItems(state, fromMs, toMs, { userId = null } = {}) {
  const items = [];
  const mine = (a) => !userId || a === userId;
  const title = (type, id) => (type === "inquiry" ? state.inquiries[id]?.contactName : type === "opportunity" ? state.opps[id]?.title : type === "project" ? state.projects[id]?.title : type === "contact" ? state.contacts[id]?.name : null);
  for (const x of Object.values(state.tasks).filter(live)) {
    if (!x.dueAt || !mine(x.assigneeId)) continue;
    const at = t(x.dueAt);
    if ((at >= fromMs && at < toMs) || (x.status === "open" && at < fromMs && toMs > Date.now())) {
      items.push({ kind: x.kind, source: "task", id: x.id, title: x.title, at: x.dueAt, done: x.status === "done", overdue: x.status === "open" && at < Date.now(), related: x.relatedType ? { type: x.relatedType, id: x.relatedId, title: title(x.relatedType, x.relatedId) } : null, assigneeId: x.assigneeId });
    }
  }
  for (const p of Object.values(state.projects).filter(live)) {
    const visible = !userId || p.assigneeId === userId || p.deliverables.some((d) => d.assigneeId === userId);
    if (visible && p.deadline && projectPhase(p.stage) !== "done" && t(p.deadline) >= fromMs && t(p.deadline) < toMs) items.push({ kind: "deadline", source: "project", id: p.id, title: `${p.title} deadline`, at: p.deadline, done: false, overdue: t(p.deadline) < Date.now(), related: { type: "project", id: p.id, title: p.title } });
    for (const d of p.deliverables.filter((d) => !d.archivedAt && d.dueAt && mine(d.assigneeId))) {
      const at = t(d.dueAt);
      if ((at >= fromMs && at < toMs) || (d.status !== "done" && at < fromMs && toMs > Date.now())) items.push({ kind: "deliverable", source: "deliverable", id: d.id, title: d.title, at: d.dueAt, done: d.status === "done", overdue: d.status !== "done" && at < Date.now(), related: { type: "project", id: p.id, title: p.title }, assigneeId: d.assigneeId });
    }
  }
  return items.sort((a, b) => t(a.at) - t(b.at));
}

export function computeAttribution(state, range) {
  const inq = Object.values(state.inquiries).filter((i) => live(i) && i.status !== "spam" && within(i.createdAt, range));
  const bySource = {};
  for (const i of inq) {
    const g = (bySource[i.source] ||= { source: i.source, label: labelOf(SOURCES, i.source), inquiries: 0, client_work: 0, employment: 0 });
    g.inquiries += 1;
    if (i.type in g) g[i.type] += 1;
  }
  const pages = {};
  for (const i of inq.filter((x) => x.attribution?.pages?.length)) {
    for (const p of new Set(i.attribution.pages.map((x) => (x.endsWith("/") ? x : `${x}/`)))) if (WORK_PAGES[p]) pages[p] = (pages[p] || 0) + 1;
  }
  return {
    bySource: Object.values(bySource).sort((a, b) => b.inquiries - a.inquiries),
    pagesReadFirst: Object.entries(pages).map(([path, count]) => ({ path, label: WORK_PAGES[path], inquiries: count })).sort((a, b) => b.inquiries - a.inquiries),
    capturedFor: inq.filter((x) => x.attribution).length,
    total: inq.length,
  };
}

// ---- Jarvis exports ----

const toIso = (ms) => new Date(ms).toISOString();

export function jarvisSummary(state, range, availability, now = Date.now()) {
  const m = computeMetrics(state, range, now);
  const inq = Object.values(state.inquiries).filter((i) => live(i) && i.status !== "spam" && within(i.createdAt, range));
  const opps = Object.values(state.opps).filter(live);
  const projects = Object.values(state.projects).filter(live);
  const started = projects.filter((p) => within(p.createdAt, range));
  const proposals = opps.filter((o) => o.type === "client" && o.proposalSentAt && within(o.proposalSentAt, range));
  const emp = opps.filter((o) => o.type === "employment");
  const f = computeFunnels(state, range);
  return {
    period: {
      from: range.fromDate, to: range.toDate, timezone: range.timezone, from_utc: toIso(range.from), to_utc_exclusive: toIso(range.to),
      definition: "Whole local days in the reporting timezone; from and to are inclusive dates. Snapshot values (open pipeline, unpaid balances, active projects, follow-ups due) are as of generated_at.",
    },
    common: {
      leads: { new_inquiries: inq.length, client_work: inq.filter((i) => i.type === "client_work").length, employment: inq.filter((i) => i.type === "employment").length, general: inq.filter((i) => i.type === "general").length },
      confirmed_work: { projects_started: started.length, recorded_value: usd(sum(started.map((p) => p.value?.amount || 0))) },
      quoted_value: { open_pipeline: m.quoted_pipeline.value, open_with_quote: m.quoted_pipeline.quoted, open_without_quote: m.quoted_pipeline.unquoted, proposals_sent_in_period: proposals.length, proposals_value_in_period: usd(sum(proposals.map((o) => o.quote?.amount || 0))) },
      cash_collected: { ...m.cash_collected.value, source: "manual_entry", verified_by_provider: false },
      verified_payments: null,
      unpaid_balances: { ...m.unpaid_balances.value, projects: m.unpaid_balances.projects, source: "manual_entry" },
      website_analytics: null,
    },
    business_specific: {
      follow_ups_due: m.follow_ups_due.value,
      follow_ups_overdue: m.follow_ups_due.overdue,
      active_projects: m.active_projects.value,
      deliverables_open: sum(projects.map((p) => p.deliverables.filter((d) => !d.archivedAt && d.status !== "done").length)),
      employment: {
        open_opportunities: m.open_employment.value,
        in_screening_or_interviews: m.open_employment.interviewing,
        interviews_scheduled: m.open_employment.interviews_scheduled,
        offers: emp.filter((o) => o.stage === "offer").length,
        accepted_in_period: emp.filter((o) => o.wonAt && within(o.wonAt, range)).length,
        funnel: f.employment,
      },
      client_funnel: f.client,
      inquiry_response: { unanswered_over_24h: computeAttention(state, now).filter((a) => a.key === "inquiry_unanswered").length },
    },
    availability_notes: {
      cash_collected: "Manual entries recorded in the portal. No payment or accounting provider is connected, so nothing is provider-verified.",
      website_analytics: "Not provided by this API. Jarvis reads Google Analytics 4 directly.",
    },
  };
}

const ENTITY_MAP = {
  inquiry: (s) =>
    Object.values(s.inquiries).filter((r) => !r.isTest).map((i) => ({
      id: i.id, entity: "inquiry", created_at: i.createdAt, updated_at: i.updatedAt, archived: Boolean(i.archivedAt), archived_at: i.archivedAt || null,
      type: i.type, status: i.status, contact_name: i.contactName, organization: i.organization, requested_service: i.service,
      source: i.source, utm: i.attribution?.first || i.attribution?.latest ? pickUtm(i.attribution.first || i.attribution.latest) : null,
      channel: i.channel, manual_entry: i.channel === "manual", owner: i.owner, next_follow_up_at: nextFollowUp(s, "inquiry", i.id),
      first_response_at: i.firstResponseAt, converted_to: i.convertedTo ? { entity: "opportunity", id: i.convertedTo.id } : null,
    })),
  opportunity: (s) =>
    Object.values(s.opps).filter((r) => !r.isTest).map((o) => ({
      id: o.id, entity: "opportunity", created_at: o.createdAt, updated_at: o.updatedAt, archived: Boolean(o.archivedAt), archived_at: o.archivedAt || null,
      opportunity_type: o.type, is_sale: o.type === "client", stage: o.stage, stage_status: stageOf(o.type, o.stage)?.type || "open", title: o.title,
      organization: o.organization, inquiry_id: o.inquiryId, source: o.source, manual_entry: o.channel === "manual", owner: o.owner,
      ...(o.type === "client"
        ? { requested_service: o.service, quote: o.quote, proposal_sent_at: o.proposalSentAt, project_id: o.projectId }
        : { employer: o.organization, role: o.role, employment_type: o.employmentType, application_url: o.applicationUrl, applied_at: o.appliedAt, next_action: o.nextAction }),
      next_follow_up_at: nextFollowUp(s, "opportunity", o.id), expected_decision_at: o.expectedDecisionAt, won_at: o.wonAt, closed_at: o.closedAt, loss_reason: o.lossReason,
    })),
  project: (s) =>
    Object.values(s.projects).filter((r) => !r.isTest).map((p) => {
      const m = projectMoney(p);
      return {
        id: p.id, entity: "project", created_at: p.createdAt, updated_at: p.updatedAt, archived: Boolean(p.archivedAt), archived_at: p.archivedAt || null,
        title: p.title, client_name: p.clientName, organization: p.organization, opportunity_id: p.opportunityId, stage: p.stage, phase: projectPhase(p.stage),
        start_at: p.startAt, deadline: p.deadline, assignee_id: p.assigneeId, recorded_value: usd(m.value), collected: usd(m.collected), balance: usd(m.balance),
        payment_status: m.status, payment_source: "manual_entry",
        deliverables: { total: p.deliverables.filter((d) => !d.archivedAt).length, done: p.deliverables.filter((d) => !d.archivedAt && d.status === "done").length },
      };
    }),
  deliverable: (s) =>
    Object.values(s.projects).filter((r) => !r.isTest).flatMap((p) =>
      p.deliverables.map((d) => ({
        id: d.id, entity: "deliverable", created_at: d.createdAt, updated_at: d.updatedAt, archived: Boolean(d.archivedAt || p.archivedAt), archived_at: d.archivedAt || p.archivedAt || null,
        project_id: p.id, title: d.title, status: d.status, assignee_id: d.assigneeId, due_at: d.dueAt, completed_at: d.completedAt, update_count: d.updates.length,
      })),
    ),
  payment: (s) =>
    Object.values(s.projects).filter((r) => !r.isTest).flatMap((p) =>
      p.payments.map((x) => ({
        id: x.id, entity: "payment", created_at: x.createdAt, updated_at: x.updatedAt || x.createdAt, archived: Boolean(x.archivedAt || p.archivedAt), archived_at: x.archivedAt || p.archivedAt || null,
        project_id: p.id, amount: usd(x.amount), received_at: x.receivedAt, method: x.method, source: "manual_entry", verified_by_provider: false,
      })),
    ),
  task: (s) =>
    Object.values(s.tasks).filter((r) => !r.isTest).map((x) => ({
      id: x.id, entity: "task", created_at: x.createdAt, updated_at: x.updatedAt || x.createdAt, archived: Boolean(x.archivedAt), archived_at: x.archivedAt || null,
      kind: x.kind, title: x.title, status: x.status, priority: x.priority, due_at: x.dueAt, completed_at: x.completedAt, assignee_id: x.assigneeId,
      related: x.relatedType ? { entity: x.relatedType, id: x.relatedId } : null,
    })),
};
export const SUPPORTED_ENTITIES = Object.keys(ENTITY_MAP);

function pickUtm(touch) {
  const keys = ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"];
  const out = Object.fromEntries(keys.filter((k) => touch?.[k]).map((k) => [k, touch[k]]));
  if (touch?.referrer) {
    try {
      out.referrer_host = new URL(touch.referrer).hostname;
    } catch {}
  }
  if (touch?.landing_page) out.landing_page = touch.landing_page;
  return Object.keys(out).length ? out : null;
}

/**
 * Stable, resumable paging: records ordered by (updated_at, id); the cursor
 * is the last record's pair, so new writes never shift a page already read.
 */
export function exportRecords(state, entity, { updatedSince = null, cursor = null, limit = 100 }) {
  const since = updatedSince ? Date.parse(updatedSince) : null;
  let after = null;
  if (cursor) {
    try {
      after = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
      if (!after?.u || !after?.i) throw new Error();
    } catch {
      throw Object.assign(new Error("cursor is not valid"), { status: 400 });
    }
  }
  const rows = ENTITY_MAP[entity](state)
    .filter((r) => since == null || Date.parse(r.updated_at) >= since)
    .sort((a, b) => a.updated_at.localeCompare(b.updated_at) || a.id.localeCompare(b.id))
    .filter((r) => !after || r.updated_at > after.u || (r.updated_at === after.u && r.id > after.i));
  const page = rows.slice(0, limit);
  const more = rows.length > limit;
  const last = page[page.length - 1];
  return { records: page.map((r) => ({ ...r, business_id: BUSINESS.id })), next_cursor: more && last ? Buffer.from(JSON.stringify({ u: last.updated_at, i: last.id })).toString("base64url") : null };
}

export function recordCounts(state) {
  return Object.fromEntries(SUPPORTED_ENTITIES.map((e) => [e, ENTITY_MAP[e](state).filter((r) => !r.archived).length]));
}

export { labelOf, PROJECT_STAGES, inquiryIsOpen };
