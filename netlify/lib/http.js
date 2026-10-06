// Small HTTP helpers shared by the portal's functions: consistent JSON
// responses and errors, bounded body parsing, and input validation.
import { randomBytes, createHash } from "node:crypto";

export class HttpError extends Error {
  constructor(status, code, message, extra = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}

const SECURITY_HEADERS = {
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
  "X-Robots-Tag": "noindex, nofollow",
  "Referrer-Policy": "same-origin",
};

export function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...SECURITY_HEADERS, ...headers },
  });
}

/** Turn any thrown error into a safe JSON response. Internal details stay in the log. */
export function errorResponse(err) {
  if (err instanceof HttpError) {
    return json({ error: { code: err.code, message: err.message, ...err.extra } }, err.status, err.headers || {});
  }
  console.error("[portal] unexpected error:", err?.stack || err);
  return json({ error: { code: "internal_error", message: "Something went wrong on the server." } }, 500);
}

export async function readJson(req, maxBytes = 32_000) {
  const type = req.headers.get("content-type") || "";
  const text = await req.text();
  if (text.length > maxBytes) throw new HttpError(413, "too_large", "That request is too large.");
  if (!text) return {};
  if (type.includes("application/json")) {
    try {
      return JSON.parse(text);
    } catch {
      throw new HttpError(400, "bad_json", "The request body is not valid JSON.");
    }
  }
  if (type.includes("application/x-www-form-urlencoded")) {
    return Object.fromEntries(new URLSearchParams(text));
  }
  throw new HttpError(415, "unsupported_type", "Send JSON or form data.");
}

export function newId(prefix) {
  return `${prefix}_${randomBytes(9).toString("base64url")}`;
}

export function sha256(text) {
  return createHash("sha256").update(text).digest("hex");
}

export function clientIp(req, context) {
  return context?.ip || req.headers.get("x-nf-client-connection-ip") || req.headers.get("x-forwarded-for")?.split(",")[0].trim() || "unknown";
}

export function nowIso() {
  return new Date().toISOString();
}

// ---- validation: small, explicit, and strict about what is allowed ----

export const v = {
  str(value, field, { max = 200, required = false, min = 0 } = {}) {
    if (value === undefined || value === null || value === "") {
      if (required) throw new HttpError(400, "invalid", `${field} is required.`, { field });
      return null;
    }
    if (typeof value !== "string") throw new HttpError(400, "invalid", `${field} must be text.`, { field });
    const s = value.trim().replace(/\u0000/g, "");
    if (required && !s) throw new HttpError(400, "invalid", `${field} is required.`, { field });
    if (s.length < min) throw new HttpError(400, "invalid", `${field} is too short.`, { field });
    if (s.length > max) throw new HttpError(400, "invalid", `${field} is too long (max ${max}).`, { field });
    return s || null;
  },
  email(value, field = "Email", { required = false } = {}) {
    const s = v.str(value, field, { max: 254, required });
    if (s && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s)) throw new HttpError(400, "invalid", `${field} doesn't look like an email address.`, { field });
    return s ? s.toLowerCase() : null;
  },
  oneOf(value, field, allowed, { required = false } = {}) {
    if (value === undefined || value === null || value === "") {
      if (required) throw new HttpError(400, "invalid", `${field} is required.`, { field });
      return null;
    }
    if (!allowed.includes(value)) throw new HttpError(400, "invalid", `${field} has an unexpected value.`, { field });
    return value;
  },
  money(value, field) {
    if (value === undefined || value === null || value === "") return null;
    const n = typeof value === "number" ? value : Number(String(value).replace(/[$,\s]/g, ""));
    if (!Number.isFinite(n) || n < 0 || n > 100_000_000) throw new HttpError(400, "invalid", `${field} must be a positive amount.`, { field });
    return Math.round(n * 100) / 100;
  },
  date(value, field) {
    if (value === undefined || value === null || value === "") return null;
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) throw new HttpError(400, "invalid", `${field} must be a valid date.`, { field });
    return d.toISOString();
  },
  url(value, field) {
    const s = v.str(value, field, { max: 500 });
    if (s && !/^https?:\/\//i.test(s)) throw new HttpError(400, "invalid", `${field} must start with http:// or https://.`, { field });
    return s;
  },
};
