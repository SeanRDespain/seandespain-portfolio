// /api/jarvis/v1/*: the normalized reporting layer Jarvis reads.
//
// Jarvis never touches storage directly. It gets versioned, stable report
// shapes (the same "jarvis.business_report" every business portal returns)
// through an API key with explicit scopes:
//   read            reports, KPIs, pipeline, activity, alerts, upcoming
//   read_financial  money values inside those reports (otherwise null)
//   suggest         propose a task; it waits for a manager's approval
// Nothing here can delete, send, or move money.
import { json, errorResponse, readJson, HttpError, v } from "../lib/http.js";
import { requireApiKey } from "../lib/auth.js";
import { loadState, listEvents, createTask } from "../lib/crm.js";
import { buildBusinessReport, parsePeriod, REPORT_SCHEMA, REPORT_VERSION } from "../lib/metrics.js";
import { EVENT_TYPES, TASK_KINDS, keys } from "../lib/model.js";

const HEADERS = { "X-Schema": REPORT_SCHEMA, "X-Schema-Version": REPORT_VERSION };

async function report(url, key) {
  const period = parsePeriod(url.searchParams.get("period") || "30d");
  const [state, events] = await Promise.all([loadState(), listEvents({ limit: 25 })]);
  return buildBusinessReport(state, events, period, { financial: key.scopes.includes("read_financial") });
}

const handlers = {
  "GET /": async ({ key }) => ({
    schema: REPORT_SCHEMA,
    schemaVersion: REPORT_VERSION,
    business: { id: "sean-despain", name: "Sean Despain", type: "portfolio" },
    key: { name: key.name, scopes: key.scopes },
    endpoints: {
      "GET /api/jarvis/v1/summary?period=7d|30d|90d|12m|all": "Full normalized business report",
      "GET /api/jarvis/v1/kpis": "Primary KPIs with previous-period comparison",
      "GET /api/jarvis/v1/pipeline": "Pipeline, conversion, and job-search progress",
      "GET /api/jarvis/v1/alerts": "What needs attention now",
      "GET /api/jarvis/v1/upcoming": "Open tasks due in the next 14 days",
      "GET /api/jarvis/v1/sources": "Where opportunities come from, and which work attracts them",
      "GET /api/jarvis/v1/activity?since=ISO&limit=100": "Business events, newest first",
      "POST /api/jarvis/v1/suggestions": "Propose a task for approval (scope: suggest)",
    },
    eventTypes: EVENT_TYPES,
  }),
  "GET /summary": async ({ url, key }) => report(url, key),
  "GET /kpis": async ({ url, key }) => {
    const r = await report(url, key);
    return { schema: r.schema, schemaVersion: r.schemaVersion, generatedAt: r.generatedAt, period: r.period, kpis: r.kpis };
  },
  "GET /pipeline": async ({ url, key }) => {
    const r = await report(url, key);
    return { generatedAt: r.generatedAt, period: r.period, pipeline: r.pipeline, conversions: r.conversions, revenue: r.revenue, jobSearch: r.specific.portfolio.jobSearch };
  },
  "GET /alerts": async ({ url, key }) => {
    const r = await report(url, key);
    return { generatedAt: r.generatedAt, items: r.attention };
  },
  "GET /upcoming": async ({ url, key }) => {
    const r = await report(url, key);
    return { generatedAt: r.generatedAt, items: r.upcoming };
  },
  "GET /sources": async ({ url, key }) => {
    const r = await report(url, key);
    return { generatedAt: r.generatedAt, period: r.period, bySource: r.leads.bySource, workThatAttractsOpportunity: r.specific.portfolio.workThatAttractsOpportunity };
  },
  "GET /activity": async ({ url }) => {
    const limit = Math.min(500, Number(url.searchParams.get("limit")) || 100);
    const since = url.searchParams.get("since");
    if (since && Number.isNaN(Date.parse(since))) throw new HttpError(400, "invalid", "since must be an ISO date.");
    const items = await listEvents({ limit, since });
    return {
      generatedAt: new Date().toISOString(),
      items: items.map((e) => ({ id: e.id, type: e.type, label: EVENT_TYPES[e.type] || e.type, at: e.at, summary: e.summary, opportunityId: e.opportunityId, contactId: e.contactId, actor: e.actor })),
    };
  },
  "POST /suggestions": async ({ req, key }) => {
    if (!key.scopes.includes("suggest")) throw new HttpError(403, "scope_missing", 'This key doesn\'t have the "suggest" scope.');
    const body = await readJson(req, 4000);
    const reason = v.str(body.reason, "Reason", { max: 500 });
    const task = await createTask(
      {
        title: body.title,
        kind: v.oneOf(body.kind, "Kind", keys(TASK_KINDS)) || "follow_up",
        priority: body.priority,
        dueAt: body.dueAt,
        relatedType: body.relatedType,
        relatedId: body.relatedId,
        notes: reason ? `Suggested by ${key.name}: ${reason}` : `Suggested by ${key.name}`,
      },
      `apikey:${key.id}`,
      { suggested: key.name },
    );
    return { status: "pending_approval", task: { id: task.id, title: task.title, status: task.status } };
  },
};

export default async (req) => {
  try {
    const url = new URL(req.url);
    const sub = "/" + url.pathname.replace(/^\/api\/jarvis\/v1\/?/, "").replace(/\/$/, "");
    const handler = handlers[`${req.method} ${sub}`];
    if (!handler) throw new HttpError(404, "not_found", "No such endpoint. GET /api/jarvis/v1 lists them.");
    const key = await requireApiKey(req, "read");
    const status = req.method === "POST" ? 201 : 200;
    return json(await handler({ req, url, key }), status, HEADERS);
  } catch (err) {
    return errorResponse(err);
  }
};

export const config = { path: ["/api/jarvis/v1", "/api/jarvis/v1/*"] };
