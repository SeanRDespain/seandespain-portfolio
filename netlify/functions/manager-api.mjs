// /api/manager/*: everything the manager portal reads and writes.
//
// Every route names the permission it needs and the session is checked on
// the server before anything is read, so hiding a button is never the only
// protection. Money fields are stripped for roles without finance access.
import { json, errorResponse, readJson, HttpError, v } from "../lib/http.js";
import { login, logout, requireSession, assertSameOrigin, createApiKey, listApiKeys, revokeApiKey, API_SCOPES } from "../lib/auth.js";
import {
  loadState, listEvents, createContact, updateContact, createOpportunity, updateOpportunity, changeStage,
  recordPayment, logInteraction, createTask, updateTask,
} from "../lib/crm.js";
import { computeKpis, computeAlerts, computeFunnel, computeSources, computeWorkAttraction, computeUpcoming, computeMoney, parsePeriod, oppValue } from "../lib/metrics.js";
import { publicConfig, stageOf, redactOpportunity } from "../lib/model.js";
import { ga4Config, ga4Overview } from "../lib/ga4.js";
import { notifyConfigured } from "../lib/notify.js";

const DAY = 86_400_000;
const routes = [];
const route = (method, pattern, permission, handler) => {
  const names = [];
  const re = new RegExp(`^${pattern.replace(/:(\w+)/g, (_, n) => (names.push(n), "([A-Za-z0-9_-]+)"))}$`);
  routes.push({ method, re, names, permission, handler });
};

// ---- enrichment: computed fields, never stored ----

function enrichOpp(state, o, now, canFinance) {
  const st = stageOf(o.kind, o.stage);
  const open = Object.values(state.tasks)
    .filter((x) => x.status === "open" && x.relatedType === "opportunity" && x.relatedId === o.id)
    .sort((a, b) => (a.dueAt || "9").localeCompare(b.dueAt || "9"));
  const contact = state.contacts[o.contactId];
  const lastTouch = Math.max(Date.parse(o.stageEnteredAt), Date.parse(o.updatedAt), Date.parse(contact?.lastInteractionAt || 0) || 0);
  const invoiced = o.payments.filter((p) => p.type === "invoiced").reduce((a, p) => a + p.amount, 0);
  const received = o.payments.filter((p) => p.type === "received").reduce((a, p) => a + p.amount, 0);
  return {
    ...(canFinance ? o : redactOpportunity(o)),
    contactName: contact?.name || null,
    stageLabel: st?.label || o.stage,
    stageType: st?.type || "open",
    nextHint: st?.next || null,
    daysInStage: Math.floor((now - Date.parse(o.stageEnteredAt)) / DAY),
    nextTask: open[0] ? { id: open[0].id, title: open[0].title, dueAt: open[0].dueAt, kind: open[0].kind } : null,
    awaitingReply: open.some((x) => x.kind === "reply"),
    stale: st?.type === "open" && st.staleDays ? (now - lastTouch) / DAY > st.staleDays : false,
    money: canFinance ? { value: oppValue(o), invoiced, received, outstanding: Math.max(0, invoiced - received) } : null,
  };
}

function enrichContact(state, c) {
  const opps = Object.values(state.opps).filter((o) => o.contactId === c.id);
  const oppIds = new Set(opps.map((o) => o.id));
  const open = Object.values(state.tasks)
    .filter((x) => x.status === "open" && ((x.relatedType === "contact" && x.relatedId === c.id) || (x.relatedType === "opportunity" && oppIds.has(x.relatedId))))
    .sort((a, b) => (a.dueAt || "9").localeCompare(b.dueAt || "9"));
  const status = opps.some((o) => o.kind === "project" && o.wonAt) ? "client" : opps.some((o) => stageOf(o.kind, o.stage)?.type === "open") ? "active" : opps.length ? "past" : "contact";
  return {
    ...c,
    status,
    opportunityCount: opps.length,
    openOpportunities: opps.filter((o) => stageOf(o.kind, o.stage)?.type === "open").length,
    nextTask: open[0] ? { id: open[0].id, title: open[0].title, dueAt: open[0].dueAt, kind: open[0].kind } : null,
    awaitingReply: open.some((x) => x.kind === "reply"),
  };
}

const has = (s, p) => s.permissions.includes(p);
const match = (q, ...fields) => !q || fields.some((f) => f && String(f).toLowerCase().includes(q));

// ---- session ----

route("POST", "login", null, async ({ req, context }) => {
  const body = await readJson(req, 2000);
  const { user, cookie } = await login(req, context, { username: body.username, password: body.password });
  return json({ ok: true, user: { name: user.name, role: user.role } }, 200, { "Set-Cookie": cookie });
});

route("POST", "logout", null, async ({ req }) => json({ ok: true }, 200, { "Set-Cookie": await logout(req) }));

route("GET", "me", "crm.read", async ({ session }) =>
  json({
    user: { id: session.user.id, name: session.user.name, role: session.user.role },
    permissions: session.permissions,
    config: publicConfig(),
    integrations: { ga4: ga4Config().configured, email: notifyConfigured() },
  }),
);

// ---- overview ----

route("GET", "overview", "crm.read", async ({ url, session }) => {
  const period = parsePeriod(url.searchParams.get("period") || "30d");
  const state = await loadState();
  const finance = has(session, "finance.read");
  const kpis = computeKpis(state, period).map((k) => (k.financial && !finance ? { ...k, value: null, previous: null, change: null, series: null, redacted: true } : k));
  return json({
    period: { key: period.key, from: new Date(period.from).toISOString(), to: new Date(period.to).toISOString() },
    kpis,
    alerts: computeAlerts(state, period.to).filter((a) => finance || !a.financial),
    upcoming: computeUpcoming(state, period.to),
    funnels: { project: computeFunnel(state, "project", period), job: computeFunnel(state, "job", period) },
    sources: computeSources(state, period),
    work: computeWorkAttraction(state, period),
    recent: has(session, "activity.read") ? await listEvents({ limit: 8 }) : [],
    counts: { contacts: Object.keys(state.contacts).length, opportunities: Object.keys(state.opps).length },
  });
});

route("GET", "search", "crm.read", async ({ url, session }) => {
  const q = (url.searchParams.get("q") || "").trim().toLowerCase();
  if (q.length < 2) return json({ contacts: [], opportunities: [] });
  const state = await loadState();
  const now = Date.now();
  return json({
    contacts: Object.values(state.contacts).filter((c) => match(q, c.name, c.email, c.company, c.title)).slice(0, 8).map((c) => enrichContact(state, c)),
    opportunities: Object.values(state.opps).filter((o) => match(q, o.title, o.company, o.summary, o.roleTitle)).slice(0, 8).map((o) => enrichOpp(state, o, now, has(session, "finance.read"))),
  });
});

// ---- contacts ----

route("GET", "contacts", "crm.read", async ({ url }) => {
  const q = (url.searchParams.get("q") || "").trim().toLowerCase();
  const type = url.searchParams.get("type");
  const status = url.searchParams.get("status");
  const state = await loadState();
  const items = Object.values(state.contacts)
    .filter((c) => match(q, c.name, c.email, c.company, c.title) && (!type || c.type === type))
    .map((c) => enrichContact(state, c))
    .filter((c) => !status || c.status === status)
    .sort((a, b) => (b.lastInteractionAt || b.createdAt).localeCompare(a.lastInteractionAt || a.createdAt));
  return json({ items });
});

route("POST", "contacts", "crm.write", async ({ req, session }) => {
  const contact = await createContact(await readJson(req), session.user.id);
  return json({ contact }, 201);
});

route("GET", "contacts/:id", "crm.read", async ({ params, session }) => {
  const state = await loadState();
  const c = state.contacts[params.id];
  if (!c) throw new HttpError(404, "not_found", "That contact doesn't exist.");
  const now = Date.now();
  const opps = Object.values(state.opps).filter((o) => o.contactId === c.id).map((o) => enrichOpp(state, o, now, has(session, "finance.read")));
  const ids = new Set(opps.map((o) => o.id));
  const tasks = Object.values(state.tasks).filter((x) => (x.relatedType === "contact" && x.relatedId === c.id) || (x.relatedType === "opportunity" && ids.has(x.relatedId)));
  return json({
    contact: enrichContact(state, c),
    opportunities: opps,
    tasks: tasks.sort((a, b) => (a.status === "open" ? 0 : 1) - (b.status === "open" ? 0 : 1) || (a.dueAt || "9").localeCompare(b.dueAt || "9")),
    events: has(session, "activity.read") ? await listEvents({ contactId: c.id, limit: 100 }) : [],
  });
});

route("PATCH", "contacts/:id", "crm.write", async ({ req, params, session }) => json({ contact: await updateContact(params.id, await readJson(req), session.user.id) }));

// ---- opportunities ----

route("GET", "opportunities", "crm.read", async ({ url, session }) => {
  const q = (url.searchParams.get("q") || "").trim().toLowerCase();
  const kind = url.searchParams.get("kind");
  const status = url.searchParams.get("status") || "open";
  const stage = url.searchParams.get("stage");
  const source = url.searchParams.get("source");
  const state = await loadState();
  const now = Date.now();
  const items = Object.values(state.opps)
    .filter((o) => (!kind || o.kind === kind) && (!stage || o.stage === stage) && (!source || o.source === source) && match(q, o.title, o.company, o.roleTitle, state.contacts[o.contactId]?.name))
    .map((o) => enrichOpp(state, o, now, has(session, "finance.read")))
    .filter((o) => status === "all" || o.stageType === status || (status === "open" && o.kind === "project" && o.stage === "active"))
    .sort((a, b) => Number(b.awaitingReply) - Number(a.awaitingReply) || Number(b.stale) - Number(a.stale) || b.updatedAt.localeCompare(a.updatedAt));
  return json({ items });
});

route("POST", "opportunities", "crm.write", async ({ req, session }) => {
  const body = await readJson(req);
  let contactId = body.contactId || null;
  if (!contactId && body.newContact?.name) {
    contactId = (await createContact({ type: body.kind === "job" ? "recruiter" : "client", ...body.newContact }, session.user.id)).id;
  }
  if (!has(session, "finance.write")) delete body.estimate;
  const opp = await createOpportunity({ ...body, contactId }, session.user.id, { needsReply: Boolean(body.needsReply) });
  return json({ opportunity: opp }, 201);
});

route("GET", "opportunities/:id", "crm.read", async ({ params, session }) => {
  const state = await loadState();
  const o = state.opps[params.id];
  if (!o) throw new HttpError(404, "not_found", "That opportunity doesn't exist.");
  const tasks = Object.values(state.tasks).filter((x) => x.relatedType === "opportunity" && x.relatedId === o.id);
  return json({
    opportunity: enrichOpp(state, o, Date.now(), has(session, "finance.read")),
    contact: state.contacts[o.contactId] ? enrichContact(state, state.contacts[o.contactId]) : null,
    tasks: tasks.sort((a, b) => (a.status === "open" ? 0 : 1) - (b.status === "open" ? 0 : 1) || (a.dueAt || "9").localeCompare(b.dueAt || "9")),
    events: has(session, "activity.read") ? await listEvents({ opportunityId: o.id, limit: 100 }) : [],
  });
});

route("PATCH", "opportunities/:id", "crm.write", async ({ req, params, session }) => {
  const opp = await updateOpportunity(params.id, await readJson(req), session.user.id, { canFinance: has(session, "finance.write") });
  return json({ opportunity: opp });
});

route("POST", "opportunities/:id/stage", "crm.write", async ({ req, params, session }) => {
  const body = await readJson(req);
  const opp = await changeStage(params.id, { stage: body.stage, lossReason: body.lossReason || null, note: body.note || null }, session.user.id);
  return json({ opportunity: opp });
});

route("POST", "opportunities/:id/payments", "finance.write", async ({ req, params, session }) => json({ opportunity: await recordPayment(params.id, await readJson(req), session.user.id) }, 201));

route("POST", "interactions", "crm.write", async ({ req, session }) => {
  const body = await readJson(req);
  const evt = await logInteraction({ opportunityId: body.opportunityId || null, contactId: body.contactId || null, type: body.type, direction: body.direction, note: body.note, at: body.at }, session.user.id);
  return json({ event: evt }, 201);
});

// ---- tasks ----

route("GET", "tasks", "tasks.read", async ({ url }) => {
  const view = url.searchParams.get("view") || "open";
  const state = await loadState();
  const now = Date.now();
  const endOfToday = new Date();
  endOfToday.setHours(23, 59, 59, 999);
  const items = Object.values(state.tasks)
    .filter((x) => {
      if (view === "done") return x.status === "done";
      if (view === "suggested") return x.status === "suggested";
      if (x.status !== "open") return false;
      if (view === "overdue") return x.dueAt && Date.parse(x.dueAt) < now;
      if (view === "today") return x.dueAt && Date.parse(x.dueAt) <= endOfToday.getTime();
      return true;
    })
    .map((x) => ({ ...x, related: x.relatedType === "opportunity" ? state.opps[x.relatedId]?.title : x.relatedType === "contact" ? state.contacts[x.relatedId]?.name : null, overdue: x.status === "open" && x.dueAt && Date.parse(x.dueAt) < now }))
    .sort((a, b) => (view === "done" ? (b.completedAt || "").localeCompare(a.completedAt || "") : (a.dueAt || "9").localeCompare(b.dueAt || "9")));
  const counts = {
    open: Object.values(state.tasks).filter((x) => x.status === "open").length,
    overdue: Object.values(state.tasks).filter((x) => x.status === "open" && x.dueAt && Date.parse(x.dueAt) < now).length,
    suggested: Object.values(state.tasks).filter((x) => x.status === "suggested").length,
  };
  return json({ items: items.slice(0, 200), counts });
});

route("POST", "tasks", "tasks.write", async ({ req, session }) => json({ task: await createTask(await readJson(req), session.user.id) }, 201));
route("PATCH", "tasks/:id", "tasks.write", async ({ req, params, session }) => json({ task: await updateTask(params.id, await readJson(req), session.user.id) }));

// ---- activity, money, analytics ----

route("GET", "activity", "activity.read", async ({ url }) => {
  const limit = Math.min(200, Number(url.searchParams.get("limit")) || 60);
  return json({ items: await listEvents({ limit, before: url.searchParams.get("before") || null }) });
});

route("GET", "money", "finance.read", async ({ url }) => {
  const state = await loadState();
  return json(computeMoney(state, parsePeriod(url.searchParams.get("period") || "90d")));
});

route("GET", "analytics", "analytics.read", async ({ url }) => {
  const period = parsePeriod(url.searchParams.get("period") || "30d");
  const state = await loadState();
  return json({
    period: { key: period.key },
    ga4: await ga4Overview(period.days),
    sources: computeSources(state, period),
    work: computeWorkAttraction(state, period),
    funnels: { project: computeFunnel(state, "project", period), job: computeFunnel(state, "job", period) },
  });
});

// ---- settings: integrations, API keys, export ----

route("GET", "integrations", "crm.read", async () =>
  json({
    ga4: { configured: ga4Config().configured, vars: ["GOOGLE_SERVICE_ACCOUNT_EMAIL", "GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY", "GA4_SEAN_DESPAIN_PROPERTY_ID"] },
    email: { configured: notifyConfigured(), vars: ["RESEND_API_KEY", "NOTIFY_EMAIL"] },
    storage: { provider: "Netlify Blobs", store: "sd-portal" },
  }),
);

route("GET", "api-keys", "apikeys.manage", async () => json({ items: await listApiKeys(), scopes: API_SCOPES }));

route("POST", "api-keys", "apikeys.manage", async ({ req, session }) => {
  const body = await readJson(req, 2000);
  const name = v.str(body.name, "Name", { max: 60, required: true });
  const scopes = Array.isArray(body.scopes) ? body.scopes.filter((s) => s in API_SCOPES) : [];
  if (!scopes.includes("read")) scopes.unshift("read");
  const { id, token } = await createApiKey({ name, scopes, createdBy: session.user.id });
  return json({ id, token, note: "Copy this key now. It won't be shown again." }, 201);
});

route("DELETE", "api-keys/:id", "apikeys.manage", async ({ params }) => {
  if (!(await revokeApiKey(params.id))) throw new HttpError(404, "not_found", "That key doesn't exist.");
  return json({ ok: true });
});

route("GET", "export", "export", async () => {
  const state = await loadState();
  return json(
    { exportedAt: new Date().toISOString(), contacts: Object.values(state.contacts), opportunities: Object.values(state.opps), tasks: Object.values(state.tasks), events: await listEvents({ limit: 100_000 }) },
    200,
    { "Content-Disposition": `attachment; filename="portal-export-${new Date().toISOString().slice(0, 10)}.json"` },
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
