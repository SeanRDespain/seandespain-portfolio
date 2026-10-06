// POST /api/inquiry: the website's project / role / question form.
//
// Public on purpose, so it defends itself: origin check, two bot traps
// (a hidden field and a minimum fill time), per-IP and global rate limits,
// and strict validation. Attribution (UTM tags, referrer, landing page, the
// pages read before reaching out) arrives from the browser and is stored on
// the opportunity; nobody types it. Works without JavaScript too: a plain
// form post is redirected back to the contact page.
import { json, errorResponse, readJson, HttpError, v, clientIp, sha256 } from "../lib/http.js";
import { update } from "../lib/store.js";
import { ingestInquiry } from "../lib/crm.js";
import { keys, labelOf, BUDGETS, TIMELINES, HEARD_ABOUT, SOURCES } from "../lib/model.js";
import { notifyNewInquiry } from "../lib/notify.js";

const PRODUCTION_HOSTS = ["seandespain.com", "www.seandespain.com"];
const HOUR = 3600_000;

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
    utm_source: s(touch.utm_source),
    utm_medium: s(touch.utm_medium),
    utm_campaign: s(touch.utm_campaign),
    utm_content: s(touch.utm_content),
    utm_term: s(touch.utm_term),
    referrer: s(touch.referrer, 500),
    landing_page: s(touch.landing_page, 300),
    at: s(touch.at, 40),
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

    // Bot traps. Answer as if it worked so bots learn nothing.
    const filledTooFast = body.t && Date.now() - Number(body.t) < 2500;
    if (body.website_url || filledTooFast) return plainForm ? back("sent") : json({ ok: true });

    const ipKey = sha256(clientIp(req, context)).slice(0, 32);
    await rateLimit(`auth/ratelimit/inquiry-${ipKey}`, 5);
    await rateLimit("auth/ratelimit/inquiry-global", 60);

    const type = v.oneOf(body.type, "What this is about", ["project", "job", "other"], { required: true });
    const form = {
      type,
      name: v.str(body.name, "Name", { max: 120, required: true }),
      email: v.email(body.email, "Email", { required: true }),
      company: v.str(body.company, "Company", { max: 120 }),
      message: v.str(body.message, "Message", { max: 4000, required: true, min: 10 }),
      budget: type === "project" ? v.oneOf(body.budget, "Budget", keys(BUDGETS)) : null,
      timeline: type === "project" ? v.oneOf(body.timeline, "Timeline", keys(TIMELINES)) : null,
      heard: v.oneOf(body.heard, "How you found me", keys(HEARD_ABOUT)),
    };
    const attribution = cleanAttribution(body.attribution);

    const { opportunity } = await ingestInquiry(form, attribution);

    const base = PRODUCTION_HOSTS.includes(new URL(req.url).host) ? "https://seandespain.com" : new URL(req.url).origin;
    await notifyNewInquiry({
      form,
      sourceLabel: labelOf(SOURCES, opportunity?.source || "unknown"),
      portalUrl: `${base}/manager/${opportunity ? `#/opportunity/${opportunity.id}` : "#/tasks"}`,
    });

    return plainForm ? back("sent") : json({ ok: true });
  } catch (err) {
    if (plainForm) return back(err instanceof HttpError && err.status === 429 ? "busy" : "error");
    return errorResponse(err);
  }
};

export const config = { path: "/api/inquiry" };
