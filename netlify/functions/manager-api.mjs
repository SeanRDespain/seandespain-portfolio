// /api/manager/*: everything the portal reads and writes.
//
// Every route names its permission and the session is checked on the server
// before anything is read. Managers see the whole business. Collaborators
// (staff) see only projects, deliverables, and tasks assigned to them, with
// no money and no client contact details, whatever the page asks for.
import { json, errorResponse, readJson, HttpError } from "../lib/http.js";
import { login, logout, requireSession, assertSameOrigin, listUsers, createUser, updateUser, jarvisTokenConfigured } from "../lib/auth.js";
import {
  loadState, listEvents, createContact, updateContact, createManualInquiry, updateInquiry, convertInquiry, createOpportunity,
  updateOpportunity, changeStage, createProject, updateProject, addDeliverable, updateDeliverable, recordPayment, logInteraction,
  createTask, updateTask,
} from "../lib/crm.js";
import { computeMetrics, computeAttention, computeFunnels, computeCharts, calendarItems, computeAttribution, parseRange, projectMoney, nextFollowUp } from "../lib/metrics.js";
import { publicConfig, stageOf, inquiryIsOpen, projectPhase, labelOf, INQUIRY_TYPES } from "../lib/model.js";
import { ga4Config, ga4Overview } from "../lib/ga4.js";
import { notifyConfigured } from "../lib/notify.js";

const DAY = 86_400_000;
const routes = [];
const route = (method, pattern, permission, handler) => {
  const names = [];
  const re = new RegExp(`^${pattern.replace(/:(\w+)/g, (_, n) => (names.push(n), "([A-Za-z0-9_-]+)"))}$`);
  routes.push({ method, re, names, permission, handler });
};
const manager = (s) => s.can("records.read");
const match = (q, ...fields) => !q || fields.some((f) => f && String(f).toLowerCase().includes(q));

// ---- shaping records for the screen ----

const userNames = (users) => Object.fromEntries(users.map((u) => [u.id, u.name]));

function inquiryRow(state, i) {
  const { fingerprint, message, ...rest } = i;
  return { ...rest, messagePreview: message ? message.slice(0, 160) : null, nextFollowUpAt: nextFollowUp(state, "inquiry", i.id), ageHours: Math.round((Date.now() - Date.parse(i.createdAt)) / 3600e3) };
}

function oppRow(state, o, s) {
  const st = stageOf(o.type, o.stage);
  const tasks = Object.values(state.tasks).filter((x) => !x.archivedAt && x.status === "open" && x.relatedType === "opportunity" && x.relatedId === o.id).sort((a, b) => (a.dueAt || "9").localeCompare(b.dueAt || "9"));
  return {
    ...o,
    quote: s.can("money.read") ? o.quote : null,
    contactName: state.contacts[o.contactId]?.name || null,
    stageLabel: st?.label || o.stage,
    stageType: st?.type || "open",
    nextHint: st?.next || null,
    daysInStage: Math.floor((Date.now() - Date.parse(o.stageEnteredAt)) / DAY),
    nextTask: tasks[0] ? { id: tasks[0].id, title: tasks[0].title, dueAt: tasks[0].dueAt, kind: tasks[0].kind } : null,
  };
}

function projectRow(p, s, names) {
  const live = p.deliverables.filter((d) => !d.archivedAt);
  const staffView = !manager(s);
  const deliverables = staffView ? live.filter((d) => d.assigneeId === s.user.id) : live;
  const base = {
    id: p.id, title: p.title, clientName: p.clientName, organization: p.organization, stage: p.stage, phase: projectPhase(p.stage),
    startAt: p.startAt, deadline: p.deadline, assigneeId: p.assigneeId, assigneeName: p.assigneeId ? names[p.assigneeId] || "Former collaborator" : "Sean",
    deliverables: deliverables.map((d) => ({ ...d, assigneeName: d.assigneeId ? names[d.assigneeId] || "Former collaborator" : "Sean" })),
    progress: { done: live.filter((d) => d.status === "done").length, total: live.length },
    isTest: p.isTest, createdAt: p.createdAt, updatedAt: p.updatedAt, archivedAt: p.archivedAt,
  };
  if (staffView) return base;
  return { ...base, opportunityId: p.opportunityId, contactId: p.contactId, ...(s.can("money.read") ? { value: p.value, payments: p.payments, money: projectMoney(p) } : {}) };
}

const staffCanSee = (p, uid) => p.assigneeId === uid || p.deliverables.some((d) => !d.archivedAt && d.assigneeId === uid);

// ---- session ----

route("POST", "login", null, async ({ req, context }) => {
  const body = await readJson(req, 2000);
  const { user, cookie } = await login(req, context, { username: body.username, password: body.password });
  return json({ ok: true, user: { name: user.name, role: user.role } }, 200, { "Set-Cookie": cookie });
});
route("POST", "logout", null, async ({ req }) => json({ ok: true }, 200, { "Set-Cookie": await logout(req) }));
route("GET", "me", "work.read", async ({ session }) =>
  json({
    user: { id: session.user.id, name: session.user.name, role: session.user.role },
    permissions: session.permissions,
    config: publicConfig(),
    users: (await listUsers()).map(({ id, name, role, active }) => ({ id, name, role, active: active !== false })),
  }),
);

// ---- overview ----

route("GET", "overview", "work.read", async ({ url, session }) => {
  const state = await loadState();
  const now = Date.now();
  const names = userNames(await listUsers());
  if (!manager(session)) {
    const uid = session.user.id;
    const projects = Object.values(state.projects).filter((p) => !p.archivedAt && staffCanSee(p, uid));
    return json({
      role: "staff",
      attention: computeAttention(state, now, { userId: uid }),
      projects: projects.map((p) => projectRow(p, session, names)),
      upcoming: calendarItems(state, now - DAY, now + 14 * DAY, { userId: uid }).filter((i) => !i.done),
    });
  }
  let range;
  try {
    range = parseRange({ from: url.searchParams.get("from"), to: url.searchParams.get("to"), period: url.searchParams.get("period") });
  } catch (e) {
    throw new HttpError(400, "invalid", e.message);
  }
  const money = session.can("money.read");
  const metrics = computeMetrics(state, range, now);
  if (!money) for (const k of ["quoted_pipeline", "cash_collected", "unpaid_balances"]) metrics[k] = { ...metrics[k], value: null, previous: null, hidden: true };
  const charts = computeCharts(state, now);
  const ga = ga4Config().configured ? await ga4Overview(range.days) : null;
  return json({
    role: "manager",
    range: { from: range.fromDate, to: range.toDate, timezone: range.timezone },
    metrics,
    attention: computeAttention(state, now).filter((a) => money || !a.money),
    funnels: computeFunnels(state, range),
    charts: { inquiriesByWeek: charts.inquiriesByWeek, cashByMonth: money ? charts.cashByMonth : null },
    upcoming: calendarItems(state, now - DAY, now + 14 * DAY).filter((i) => !i.done).slice(0, 12),
    attribution: computeAttribution(state, range),
    traffic: ga && ga.connected ? { sessions: ga.totals.sessions, users: ga.totals.users, resumeDownloads: ga.events.resume_downloaded, fetchedAt: ga.fetchedAt } : null,
    recent: await listEvents({ limit: 6 }),
  });
});

route("GET", "search", "records.read", async ({ url }) => {
  const q = (url.searchParams.get("q") || "").trim().toLowerCase();
  if (q.length < 2) return json({ inquiries: [], opportunities: [], projects: [], contacts: [] });
  const s = await loadState();
  const take = (arr) => arr.filter((r) => !r.archivedAt).slice(0, 6);
  return json({
    inquiries: take(Object.values(s.inquiries).filter((i) => match(q, i.contactName, i.organization, i.message))).map((i) => ({ id: i.id, title: i.contactName, sub: `${labelOf(INQUIRY_TYPES, i.type)} · ${i.status}` })),
    opportunities: take(Object.values(s.opps).filter((o) => match(q, o.title, o.organization, o.role))).map((o) => ({ id: o.id, title: o.title, sub: stageOf(o.type, o.stage)?.label })),
    projects: take(Object.values(s.projects).filter((p) => match(q, p.title, p.clientName, p.organization))).map((p) => ({ id: p.id, title: p.title, sub: p.clientName || "" })),
    contacts: take(Object.values(s.contacts).filter((c) => match(q, c.name, c.email, c.company))).map((c) => ({ id: c.id, title: c.name, sub: [c.company, c.email].filter(Boolean).join(" · ") })),
  });
});

// ---- inquiries ----

route("GET", "inquiries", "records.read", async ({ url }) => {
  const status = url.searchParams.get("status") || "open";
  const type = url.searchParams.get("type");
  const q = (url.searchParams.get("q") || "").trim().toLowerCase();
  const s = await loadState();
  const items = Object.values(s.inquiries)
    .filter((i) => (status === "archived" ? Boolean(i.archivedAt) : !i.archivedAt))
    .filter((i) => ["all", "archived"].includes(status) || (status === "open" ? inquiryIsOpen(i.status) : status === "converted" ? i.status === "converted" : !inquiryIsOpen(i.status) && i.status !== "converted"))
    .filter((i) => (!type || i.type === type) && match(q, i.contactName, i.organization, i.message))
    .map((i) => inquiryRow(s, i))
    .sort((a, b) => (a.status === "new" ? 0 : 1) - (b.status === "new" ? 0 : 1) || b.createdAt.localeCompare(a.createdAt));
  return json({ items });
});

route("POST", "inquiries", "records.write", async ({ req, session }) => json({ inquiry: await createManualInquiry(await readJson(req), session.user.id) }, 201));

route("GET", "inquiries/:id", "records.read", async ({ params, session }) => {
  const s = await loadState();
  const i = s.inquiries[params.id];
  if (!i) throw new HttpError(404, "not_found", "That inquiry doesn't exist.");
  const opp = i.convertedTo ? s.opps[i.convertedTo.id] : null;
  const { fingerprint, ...inquiry } = i;
  return json({
    inquiry: { ...inquiry, nextFollowUpAt: nextFollowUp(s, "inquiry", i.id) },
    contact: s.contacts[i.contactId] || null,
    opportunity: opp ? oppRow(s, opp, session) : null,
    tasks: Object.values(s.tasks).filter((x) => !x.archivedAt && x.relatedType === "inquiry" && x.relatedId === i.id),
    events: await listEvents({ inquiryId: i.id, limit: 100 }),
  });
});

route("PATCH", "inquiries/:id", "records.write", async ({ req, params, session }) => json({ inquiry: await updateInquiry(params.id, await readJson(req), session.user.id) }));
route("POST", "inquiries/:id/convert", "records.write", async ({ req, params, session }) => json({ opportunity: await convertInquiry(params.id, await readJson(req), session.user.id) }, 201));

// ---- opportunities ----

route("GET", "opportunities", "records.read", async ({ url, session }) => {
  const type = url.searchParams.get("type") || "client";
  const status = url.searchParams.get("status") || "open";
  const q = (url.searchParams.get("q") || "").trim().toLowerCase();
  const s = await loadState();
  const items = Object.values(s.opps)
    .filter((o) => o.type === type && !o.archivedAt && match(q, o.title, o.organization, o.role, s.contacts[o.contactId]?.name))
    .map((o) => oppRow(s, o, session))
    .filter((o) => status === "all" || o.stageType === status)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return json({ items });
});

route("POST", "opportunities", "records.write", async ({ req, session }) => json({ opportunity: await createOpportunity(await readJson(req), session.user.id, { canMoney: session.can("money.write") }) }, 201));

route("GET", "opportunities/:id", "records.read", async ({ params, session }) => {
  const s = await loadState();
  const o = s.opps[params.id];
  if (!o) throw new HttpError(404, "not_found", "That opportunity doesn't exist.");
  const inq = o.inquiryId ? s.inquiries[o.inquiryId] : null;
  const prj = o.projectId ? s.projects[o.projectId] : null;
  return json({
    opportunity: oppRow(s, o, session),
    contact: s.contacts[o.contactId] || null,
    inquiry: inq ? { id: inq.id, createdAt: inq.createdAt, message: inq.message, attribution: inq.attribution, source: inq.source } : null,
    project: prj ? { id: prj.id, title: prj.title, stage: prj.stage } : null,
    tasks: Object.values(s.tasks).filter((x) => !x.archivedAt && x.relatedType === "opportunity" && x.relatedId === o.id),
    events: await listEvents({ opportunityId: o.id, limit: 100 }),
  });
});

route("PATCH", "opportunities/:id", "records.write", async ({ req, params, session }) => json({ opportunity: await updateOpportunity(params.id, await readJson(req), session.user.id, { canMoney: session.can("money.write") }) }));
route("POST", "opportunities/:id/stage", "records.write", async ({ req, params, session }) => {
  const b = await readJson(req);
  return json({ opportunity: await changeStage(params.id, { stage: b.stage, lossReason: b.lossReason || null }, session.user.id) });
});
route("POST", "opportunities/:id/project", "records.write", async ({ req, params, session }) => json({ project: await createProject({ ...(await readJson(req)), opportunityId: params.id }, session.user.id, { canMoney: session.can("money.write") }) }, 201));

// ---- contacts ----

route("GET", "contacts", "records.read", async ({ url }) => {
  const q = (url.searchParams.get("q") || "").trim().toLowerCase();
  const s = await loadState();
  const items = Object.values(s.contacts)
    .filter((c) => !c.archivedAt && match(q, c.name, c.email, c.company, c.title))
    .map((c) => ({ ...c, inquiries: Object.values(s.inquiries).filter((i) => i.contactId === c.id).length, opportunities: Object.values(s.opps).filter((o) => o.contactId === c.id && !o.archivedAt).length }))
    .sort((a, b) => (b.lastInteractionAt || b.createdAt).localeCompare(a.lastInteractionAt || a.createdAt));
  return json({ items });
});
route("POST", "contacts", "records.write", async ({ req, session }) => json({ contact: await createContact(await readJson(req), session.user.id) }, 201));
route("GET", "contacts/:id", "records.read", async ({ params, session }) => {
  const s = await loadState();
  const c = s.contacts[params.id];
  if (!c) throw new HttpError(404, "not_found", "That contact doesn't exist.");
  return json({
    contact: c,
    inquiries: Object.values(s.inquiries).filter((i) => i.contactId === c.id).map((i) => inquiryRow(s, i)),
    opportunities: Object.values(s.opps).filter((o) => o.contactId === c.id && !o.archivedAt).map((o) => oppRow(s, o, session)),
    projects: Object.values(s.projects).filter((p) => p.contactId === c.id && !p.archivedAt).map((p) => ({ id: p.id, title: p.title, stage: p.stage })),
    events: await listEvents({ contactId: c.id, limit: 80 }),
  });
});
route("PATCH", "contacts/:id", "records.write", async ({ req, params, session }) => json({ contact: await updateContact(params.id, await readJson(req), session.user.id) }));

// ---- projects (staff see only their assigned work) ----

route("GET", "projects", "work.read", async ({ url, session }) => {
  const phase = url.searchParams.get("phase") || "current";
  const s = await loadState();
  const names = userNames(await listUsers());
  const items = Object.values(s.projects)
    .filter((p) => !p.archivedAt && (manager(session) || staffCanSee(p, session.user.id)))
    .filter((p) => phase === "all" || (phase === "current" ? projectPhase(p.stage) !== "done" : projectPhase(p.stage) === "done"))
    .map((p) => projectRow(p, session, names))
    .sort((a, b) => (a.deadline || "9").localeCompare(b.deadline || "9"));
  return json({ items });
});

route("POST", "projects", "records.write", async ({ req, session }) => json({ project: await createProject(await readJson(req), session.user.id, { canMoney: session.can("money.write") }) }, 201));

route("GET", "projects/:id", "work.read", async ({ params, session }) => {
  const s = await loadState();
  const p = s.projects[params.id];
  if (!p || (!manager(session) && !staffCanSee(p, session.user.id))) throw new HttpError(404, "not_found", "That project doesn't exist.");
  const names = userNames(await listUsers());
  if (!manager(session)) return json({ project: projectRow(p, session, names) });
  return json({
    project: projectRow(p, session, names),
    contact: s.contacts[p.contactId] || null,
    opportunity: p.opportunityId && s.opps[p.opportunityId] ? { id: p.opportunityId, title: s.opps[p.opportunityId].title } : null,
    tasks: Object.values(s.tasks).filter((x) => !x.archivedAt && x.relatedType === "project" && x.relatedId === p.id),
    events: await listEvents({ projectId: p.id, limit: 100 }),
  });
});

route("PATCH", "projects/:id", "records.write", async ({ req, params, session }) => json({ project: await updateProject(params.id, await readJson(req), session.user.id, { canMoney: session.can("money.write") }) }));
route("POST", "projects/:id/deliverables", "records.write", async ({ req, params, session }) => json({ deliverable: await addDeliverable(params.id, await readJson(req), session.user.id) }, 201));
route("PATCH", "projects/:id/deliverables/:did", "work.update", async ({ req, params, session }) => {
  const s = await loadState();
  const p = s.projects[params.id];
  if (!p || (!manager(session) && !staffCanSee(p, session.user.id))) throw new HttpError(404, "not_found", "That project doesn't exist.");
  return json({ deliverable: await updateDeliverable(params.id, params.did, await readJson(req), session.user.id, { manager: manager(session) }) });
});
route("POST", "projects/:id/payments", "money.write", async ({ req, params, session }) => json({ payment: await recordPayment(params.id, await readJson(req), session.user.id) }, 201));

// ---- calendar & tasks ----

route("GET", "calendar", "work.read", async ({ url, session }) => {
  const from = Date.parse(url.searchParams.get("from") || "") || Date.now() - 7 * DAY;
  const to = Date.parse(url.searchParams.get("to") || "") || Date.now() + 35 * DAY;
  if (to <= from || to - from > 120 * DAY) throw new HttpError(400, "invalid", "Ask for a range of 120 days or less.");
  const s = await loadState();
  return json({ items: calendarItems(s, from, to, { userId: manager(session) ? null : session.user.id }) });
});

route("GET", "tasks", "work.read", async ({ url, session }) => {
  const view = url.searchParams.get("view") || "open";
  const s = await loadState();
  const now = Date.now();
  const all = Object.values(s.tasks).filter((x) => !x.archivedAt && (manager(session) || x.assigneeId === session.user.id));
  const title = (x) => (x.relatedType === "inquiry" ? s.inquiries[x.relatedId]?.contactName : x.relatedType === "opportunity" ? s.opps[x.relatedId]?.title : x.relatedType === "project" ? s.projects[x.relatedId]?.title : x.relatedType === "contact" ? s.contacts[x.relatedId]?.name : null);
  const items = all
    .filter((x) => (view === "done" ? x.status === "done" : x.status === "open" && (view !== "overdue" || (x.dueAt && Date.parse(x.dueAt) < now))))
    .map((x) => ({ ...x, related: title(x), overdue: x.status === "open" && Boolean(x.dueAt) && Date.parse(x.dueAt) < now }))
    .sort((a, b) => (view === "done" ? (b.completedAt || "").localeCompare(a.completedAt || "") : (a.dueAt || "9").localeCompare(b.dueAt || "9")));
  return json({ items: items.slice(0, 200), counts: { open: all.filter((x) => x.status === "open").length, overdue: all.filter((x) => x.status === "open" && x.dueAt && Date.parse(x.dueAt) < now).length } });
});

route("POST", "tasks", "records.write", async ({ req, session }) => json({ task: await createTask(await readJson(req), session.user.id) }, 201));
route("PATCH", "tasks/:id", "work.update", async ({ req, params, session }) => json({ task: await updateTask(params.id, await readJson(req), session.user.id, { manager: manager(session) }) }));

route("POST", "interactions", "records.write", async ({ req, session }) => {
  const b = await readJson(req);
  return json({ event: await logInteraction({ entity: b.entity, id: b.id, type: b.type, direction: b.direction, note: b.note, at: b.at }, session.user.id) }, 201);
});

// ---- settings: team, connections, export ----

route("GET", "users", "users.manage", async () => json({ items: await listUsers() }));
route("POST", "users", "users.manage", async ({ req }) => json(await createUser(await readJson(req, 2000)), 201));
route("PATCH", "users/:id", "users.manage", async ({ req, params }) => json(await updateUser(params.id, await readJson(req, 2000))));

route("GET", "integrations", "work.read", async () =>
  json({
    ga4: { configured: ga4Config().configured, vars: ["GOOGLE_SERVICE_ACCOUNT_EMAIL", "GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY", "GA4_SEAN_DESPAIN_PROPERTY_ID"] },
    email: { configured: notifyConfigured(), vars: ["RESEND_API_KEY", "NOTIFY_EMAIL"] },
    jarvis: { configured: jarvisTokenConfigured(), vars: ["JARVIS_SITE_API_TOKEN"], baseUrl: "https://seandespain.com/api/jarvis/v1" },
    payments: { configured: false, note: "No payment or accounting provider is connected. Payments are manual entries." },
    storage: { provider: "Netlify Blobs", store: "sd-portal" },
  }),
);

route("GET", "export", "export", async () => {
  const s = await loadState();
  return json(
    { exportedAt: new Date().toISOString(), contacts: Object.values(s.contacts), inquiries: Object.values(s.inquiries), opportunities: Object.values(s.opps), projects: Object.values(s.projects), tasks: Object.values(s.tasks) },
    200,
    { "Content-Disposition": `attachment; filename="seandespain-portal-${new Date().toISOString().slice(0, 10)}.json"` },
  );
});

// ---- dispatcher ----

export default async (req, context) => {
  try {
    const url = new URL(req.url);
    const path = url.pathname.replace(/^\/api\/manager\/?/, "").replace(/\/$/, "");
    const candidates = routes.filter((r) => r.re.test(path));
    if (!candidates.length) throw new HttpError(404, "not_found", "No such endpoint.");
    const r = candidates.find((x) => x.method === req.method);
    if (!r) throw new HttpError(405, "method_not_allowed", "Method not allowed.");
    assertSameOrigin(req);
    const m = r.re.exec(path);
    const params = Object.fromEntries(r.names.map((n, i) => [n, m[i + 1]]));
    const session = r.permission ? await requireSession(req, r.permission) : null;
    return await r.handler({ req, context, url, params, session });
  } catch (err) {
    return errorResponse(err);
  }
};

export const config = { path: ["/api/manager", "/api/manager/*"] };
