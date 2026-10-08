// POST /api/inquiry: the contact page's inquiry form.
//
// Public on purpose, so it defends itself: origin check, two bot traps (a
// hidden field and a minimum fill time), per-IP and global rate limits, and
// strict validation. Each real submission becomes one inquiry record; the
// form's idempotency key (and email + message within 15 minutes) makes
// retries return the saved inquiry instead of creating a duplicate. The
// optional email alert to Sean is sent only for genuinely new inquiries.
// Works without JavaScript too: a plain form post is redirected.
import { json, errorResponse, readJson, HttpError, v, clientIp, sha256 } from "../lib/http.js";
import { update } from "../lib/store.js";
import { ingestWebsiteInquiry } from "../lib/crm.js";
import { keys, labelOf, BUDGETS, TIMELINES, HEARD_ABOUT, SOURCES, SERVICES } from "../lib/model.js";
import { notifyNewInquiry } from "../lib/notify.js";

const PRODUCTION_HOSTS = ["seandespain.com", "www.seandespain.com"];
const HOUR = 3600_000;
const LEGACY_TYPES = { project: "client_work", job: "employment", other: "general" };

async function rateLimit(key, max) {
  const cutoff = Date.now() - HOUR;
  const doc = await update(key, { hits: [] }, (d) => ({ hits: [...d.hits.filter((x) => x > cutoff), Date.now()].slice(-200) }));
  if (doc.hits.length > max) {
    const err = new HttpError(429, "rate_limited", "Too many messages from here. Please email me instead: seandespain@gmail.com");
    err.headers = { "Retry-After": "3600" };
    throw err;
  }
}

function cleanTouch(touch) {
  if (!touch || typeof touch !== "object") return null;
  const s = (val, max = 150) => (typeof val === "string" && val.trim() ? val.trim().slice(0, max) : null);
  const out = {
    utm_source: s(touch.utm_source), utm_medium: s(touch.utm_medium), utm_campaign: s(touch.utm_campaign),
    utm_content: s(touch.utm_content), utm_term: s(touch.utm_term), referrer: s(touch.referrer, 500),
    landing_page: s(touch.landing_page, 300), at: s(touch.at, 40),
  };
  return Object.values(out).some(Boolean) ? out : null;
}

function cleanAttribution(raw) {
  let a = raw;
  if (typeof a === "string") {
    try {
      a = JSON.parse(a);
    } catch {
      return null;
    }
  }
  if (!a || typeof a !== "object") return null;
  const pages = Array.isArray(a.pages) ? a.pages.filter((p) => typeof p === "string" && p.startsWith("/")).map((p) => p.slice(0, 200)).slice(-25) : [];
  return { first: cleanTouch(a.first), latest: cleanTouch(a.latest), pages };
}

export default async (req, context) => {
  if (req.method !== "POST") return json({ error: { code: "method_not_allowed", message: "Use POST." } }, 405, { Allow: "POST" });
  const plainForm = (req.headers.get("content-type") || "").includes("application/x-www-form-urlencoded");
  const back = (status) => new Response(null, { status: 303, headers: { Location: status === "sent" ? "/contact/thanks/" : `/contact/?inquiry=${status}#inquiry` } });

  try {
    const origin = req.headers.get("origin");
    if (origin) {
      const host = new URL(origin).host;
      if (host !== new URL(req.url).host && !PRODUCTION_HOSTS.includes(host)) throw new HttpError(403, "bad_origin", "Request rejected.");
    }
    const body = await readJson(req, 24_000);

    // Bot traps: answer as if it worked so bots learn nothing.
    if (body.website_url || (body.t && Date.now() - Number(body.t) < 2500)) return plainForm ? back("sent") : json({ ok: true });

    const ipKey = sha256(clientIp(req, context)).slice(0, 32);
    await rateLimit(`auth/ratelimit/inquiry-${ipKey}`, 5);
    await rateLimit("auth/ratelimit/inquiry-global", 60);

    const type = v.oneOf(LEGACY_TYPES[body.type] || body.type, "What this is about", ["client_work", "employment", "general"], { required: true });
    const form = {
      type,
      name: v.str(body.name, "Name", { max: 120, required: true }),
      email: v.email(body.email, "Email", { required: true }),
      company: v.str(body.company, "Organization", { max: 120 }),
      message: v.str(body.message, "Message", { max: 4000, required: true, min: 10 }),
      service: type === "client_work" ? v.oneOf(body.service, "Service", keys(SERVICES)) : null,
      budget: type === "client_work" ? v.oneOf(body.budget, "Budget", keys(BUDGETS)) : null,
      timeline: type === "client_work" ? v.oneOf(body.timeline, "Timeline", keys(TIMELINES)) : null,
      heard: v.oneOf(body.heard, "How you found me", keys(HEARD_ABOUT)),
    };
    const idem = typeof body.idem === "string" && /^[A-Za-z0-9_-]{16,64}$/.test(body.idem) ? body.idem : null;

    const { inquiry, duplicate } = await ingestWebsiteInquiry(form, cleanAttribution(body.attribution), idem);

    if (!duplicate) {
      const base = PRODUCTION_HOSTS.includes(new URL(req.url).host) ? "https://seandespain.com" : new URL(req.url).origin;
      await notifyNewInquiry({ form, sourceLabel: labelOf(SOURCES, inquiry.source), portalUrl: `${base}/manager/#/inquiry/${inquiry.id}` });
    }
    return plainForm ? back("sent") : json({ ok: true });
  } catch (err) {
    if (plainForm) return back(err instanceof HttpError && err.status === 429 ? "busy" : "error");
    return errorResponse(err);
  }
};

export const config = { path: "/api/inquiry" };
