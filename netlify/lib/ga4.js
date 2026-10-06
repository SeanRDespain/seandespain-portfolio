// Read-only Google Analytics 4 reporting for the portal's Analytics view.
//
// GA4 stays the source of truth for website behavior: nothing here is stored
// except a one-hour cache of the report, so the portal never becomes a second
// analytics database. Uses the same service account and variable names as
// Jarvis, so one Google setup serves both.
import { createSign } from "node:crypto";
import { read, write } from "./store.js";

export const KEY_EVENTS = ["inquiry_submitted", "email_clicked", "contact_clicked", "resume_downloaded", "live_project_clicked"];

export function ga4Config() {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL?.trim();
  const key = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY?.replace(/\\n/g, "\n").trim();
  const property = process.env.GA4_SEAN_DESPAIN_PROPERTY_ID?.trim().replace(/^properties\//, "");
  return { configured: Boolean(email && key && property), email, key, property };
}

let token = null;
async function accessToken(cfg) {
  if (token && token.expires > Date.now() + 60_000) return token.value;
  const now = Math.floor(Date.now() / 1000);
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const unsigned = `${b64({ alg: "RS256", typ: "JWT" })}.${b64({ iss: cfg.email, scope: "https://www.googleapis.com/auth/analytics.readonly", aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600 })}`;
  const signature = createSign("RSA-SHA256").update(unsigned).sign(cfg.key).toString("base64url");
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${unsigned}.${signature}` }),
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`Google sign-in failed (${res.status}). Check the service account email and private key.`);
  const data = await res.json();
  token = { value: data.access_token, expires: Date.now() + data.expires_in * 1000 };
  return token.value;
}

const rows = (report, map) => (report.rows || []).map((r) => map(r.dimensionValues?.map((d) => d.value) || [], r.metricValues?.map((m) => Number(m.value)) || []));

export async function ga4Overview(days) {
  const cfg = ga4Config();
  if (!cfg.configured) return { configured: false, connected: false };
  const span = days || 365;
  const cacheKey = `cache/ga4-${span}d`;
  const cached = await read(cacheKey);
  if (cached && Date.now() - Date.parse(cached.fetchedAt) < 3600_000) return cached;

  try {
    const range = [{ startDate: `${span}daysAgo`, endDate: "today" }];
    const res = await fetch(`https://analyticsdata.googleapis.com/v1beta/properties/${cfg.property}:batchRunReports`, {
      method: "POST",
      headers: { Authorization: `Bearer ${await accessToken(cfg)}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        requests: [
          { dateRanges: range, dimensions: [{ name: "date" }], metrics: [{ name: "sessions" }, { name: "activeUsers" }], orderBys: [{ dimension: { dimensionName: "date" } }] },
          { dateRanges: range, dimensions: [{ name: "pagePath" }], metrics: [{ name: "screenPageViews" }, { name: "activeUsers" }], orderBys: [{ metric: { metricName: "screenPageViews" }, desc: true }], limit: 12 },
          { dateRanges: range, dimensions: [{ name: "sessionDefaultChannelGroup" }], metrics: [{ name: "sessions" }], orderBys: [{ metric: { metricName: "sessions" }, desc: true }] },
          { dateRanges: range, dimensions: [{ name: "eventName" }], metrics: [{ name: "eventCount" }], dimensionFilter: { filter: { fieldName: "eventName", inListFilter: { values: KEY_EVENTS } } } },
        ],
      }),
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) {
      const detail = res.status === 403 ? "The service account doesn't have access to this GA4 property yet." : `GA4 returned ${res.status}.`;
      return { configured: true, connected: false, error: detail };
    }
    const { reports } = await res.json();
    const [daily, pages, channels, events] = reports;
    const dailyRows = rows(daily, ([date], [sessions, users]) => ({ date: `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6)}`, sessions, users }));
    const result = {
      configured: true,
      connected: true,
      fetchedAt: new Date().toISOString(),
      days: span,
      totals: { sessions: dailyRows.reduce((a, r) => a + r.sessions, 0), users: dailyRows.reduce((a, r) => a + r.users, 0) },
      daily: dailyRows,
      pages: rows(pages, ([path], [views, users]) => ({ path, views, users })),
      channels: rows(channels, ([channel], [sessions]) => ({ channel, sessions })),
      events: Object.fromEntries(KEY_EVENTS.map((e) => [e, 0]).concat(rows(events, ([name], [count]) => [name, count]))),
    };
    await write(cacheKey, result);
    return result;
  } catch (err) {
    console.error("[portal] GA4 report failed:", err.message);
    return { configured: true, connected: false, error: err.message.startsWith("Google sign-in") ? err.message : "Couldn't reach Google Analytics right now." };
  }
}
