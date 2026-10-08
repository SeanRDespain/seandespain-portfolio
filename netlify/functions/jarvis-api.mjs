// Jarvis data API for seandespain.com (read-only).
//
//   GET /api/jarvis/v1/health
//   GET /api/jarvis/v1/summary?from=YYYY-MM-DD&to=YYYY-MM-DD
//   GET /api/jarvis/v1/records?entity=...&updated_since=ISO&cursor=...&limit=...
//
// Every response uses the shared envelope: schema_version, business_id,
// business_slug, source, generated_at, data, availability (+ next_cursor on
// records). Authenticated with the server-only JARVIS_SITE_API_TOKEN, which is
// separate from every staff login. Exports only what Jarvis needs: no emails,
// phone numbers, messages, notes, or secrets. Test records are excluded.
// Contract details and samples: JARVIS-HANDOFF.md.
import { json, errorResponse, HttpError } from "../lib/http.js";
import { requireJarvisToken } from "../lib/auth.js";
import { loadState } from "../lib/crm.js";
import { parseRange, jarvisSummary, exportRecords, recordCounts, SUPPORTED_ENTITIES } from "../lib/metrics.js";
import { BUSINESS } from "../lib/model.js";
import { ga4Config } from "../lib/ga4.js";
import { notifyConfigured } from "../lib/notify.js";

export const SCHEMA_VERSION = "1.0";

function availability() {
  return {
    operational_records: "available",
    payments_provider: "unavailable",
    cash_collected: "manual_entry",
    website_analytics: "unavailable",
    inquiry_email_notifications: notifyConfigured() ? "available" : "unavailable",
    portal_ga4_reporting: ga4Config().configured ? "available" : "unavailable",
  };
}

function envelope(data, extra = {}) {
  return {
    schema_version: SCHEMA_VERSION,
    business_id: BUSINESS.id,
    business_slug: BUSINESS.slug,
    source: BUSINESS.source,
    generated_at: new Date().toISOString(),
    data,
    availability: availability(),
    ...extra,
  };
}

const handlers = {
  async health() {
    const state = await loadState();
    const all = [state.inquiries, state.opps, state.projects, state.tasks].flatMap((c) => Object.values(c));
    const last = all.map((r) => r.updatedAt).filter(Boolean).sort().pop() || null;
    return envelope({
      status: "ok",
      supported_entities: SUPPORTED_ENTITIES,
      record_counts: recordCounts(state),
      last_record_update_at: last,
      reporting_timezone: BUSINESS.timezone,
      currency: BUSINESS.currency,
      read_only: true,
    });
  },

  async summary(url) {
    let range;
    try {
      range = parseRange({ from: url.searchParams.get("from"), to: url.searchParams.get("to") });
    } catch (e) {
      throw new HttpError(400, "invalid", e.message);
    }
    if (range.days > 731) throw new HttpError(400, "invalid", "Ask for two years or less at a time.");
    const state = await loadState();
    return envelope(jarvisSummary(state, range, availability()));
  },

  async records(url) {
    const entity = url.searchParams.get("entity");
    if (!SUPPORTED_ENTITIES.includes(entity)) throw new HttpError(400, "invalid", `entity must be one of: ${SUPPORTED_ENTITIES.join(", ")}`);
    const updatedSince = url.searchParams.get("updated_since");
    if (updatedSince && Number.isNaN(Date.parse(updatedSince))) throw new HttpError(400, "invalid", "updated_since must be an ISO 8601 timestamp.");
    const limit = Math.min(500, Math.max(1, Number(url.searchParams.get("limit")) || 100));
    const state = await loadState();
    let page;
    try {
      page = exportRecords(state, entity, { updatedSince, cursor: url.searchParams.get("cursor"), limit });
    } catch (e) {
      throw new HttpError(e.status || 500, "invalid", e.message);
    }
    return envelope({ entity, records: page.records, count: page.records.length }, { next_cursor: page.next_cursor });
  },
};

export default async (req) => {
  try {
    if (req.method !== "GET") throw new HttpError(405, "method_not_allowed", "This API is read-only.");
    const url = new URL(req.url);
    const name = url.pathname.replace(/^\/api\/jarvis\/v1\/?/, "").replace(/\/$/, "");
    const handler = handlers[name];
    if (!handler) throw new HttpError(404, "not_found", "Endpoints: /health, /summary, /records");
    await requireJarvisToken(req);
    return json(await handler(url));
  } catch (err) {
    const res = errorResponse(err);
    const body = await res.json();
    return json({ schema_version: SCHEMA_VERSION, business_id: BUSINESS.id, business_slug: BUSINESS.slug, source: BUSINESS.source, generated_at: new Date().toISOString(), ...body }, res.status, Object.fromEntries(res.headers));
  }
};

export const config = { path: ["/api/jarvis/v1", "/api/jarvis/v1/*"] };
