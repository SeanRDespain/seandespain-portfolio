// Manager portal authentication and authorization.
//
// - The owner's password exists only as a bcrypt hash in the
//   MANAGER_PORTAL_PASSWORD_HASH environment variable. The plaintext is never
//   stored, logged, returned, or shipped to the browser.
// - A login creates an opaque random session id. The browser holds it in an
//   HttpOnly, Secure, SameSite=Strict cookie scoped to /api/manager; the
//   server holds only its SHA-256 and checks expiry on every request.
// - Every API route asks for a permission, so a future "read only" or
//   "team member" account is limited by the server, not just hidden buttons.
// - Jarvis and other services use separate API keys with explicit scopes,
//   never the manager password or a browser session.
import bcrypt from "bcryptjs";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { HttpError, sha256, nowIso, newId, clientIp } from "./http.js";
import { read, write, remove, update } from "./store.js";

export const SESSION_COOKIE = "sd_portal";
const SESSION_MAX_AGE_S = 12 * 60 * 60; // absolute lifetime
const SESSION_IDLE_S = 4 * 60 * 60; // signed out after 4 quiet hours
const TOUCH_EVERY_MS = 5 * 60 * 1000;

const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_PER_IP = 5;
const LOGIN_MAX_GLOBAL = 40;

/**
 * Roles are a permission list each. The UI hides what a role can't do, and
 * every endpoint enforces the same list on the server.
 */
export const ROLES = {
  owner: { label: "Owner", permissions: ["*"] },
  manager: {
    label: "Manager",
    permissions: ["crm.read", "crm.write", "tasks.read", "tasks.write", "finance.read", "finance.write", "analytics.read", "activity.read", "export"],
  },
  team_member: {
    label: "Team member",
    permissions: ["crm.read", "crm.write", "tasks.read", "tasks.write", "analytics.read", "activity.read"],
  },
  specialist: { label: "Specialist", permissions: ["crm.read", "tasks.read", "tasks.write", "activity.read"] },
  read_only: { label: "Read only", permissions: ["crm.read", "tasks.read", "analytics.read", "activity.read"] },
};

export function can(role, permission) {
  const perms = ROLES[role]?.permissions || [];
  return perms.includes("*") || perms.includes(permission);
}

export function permissionsFor(role) {
  const all = ["crm.read", "crm.write", "tasks.read", "tasks.write", "finance.read", "finance.write", "analytics.read", "activity.read", "export", "settings.manage", "users.manage", "apikeys.manage"];
  return all.filter((p) => can(role, p));
}

// ---- cookies ----

function parseCookies(req) {
  const out = {};
  for (const part of (req.headers.get("cookie") || "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function sessionCookie(value, maxAge) {
  return `${SESSION_COOKIE}=${value}; Path=/api/manager; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAge}`;
}

// ---- users: the owner comes from the environment, future accounts from storage ----

async function findUser(username) {
  const name = (username || "owner").trim().toLowerCase();
  if (name === "owner") {
    const hash = process.env.MANAGER_PORTAL_PASSWORD_HASH?.trim();
    if (!hash) return { configured: false };
    return { configured: true, user: { id: "owner", username: "owner", name: "Sean", role: "owner", active: true }, hash };
  }
  // Individual accounts (manager, team member, ...) live in storage with their
  // own bcrypt hashes. None exist yet; the structure is ready for them.
  const doc = await read("auth/users", { users: {} });
  const user = Object.values(doc.users).find((u) => u.username === name);
  if (!user) return { configured: true, user: null };
  return { configured: true, user: { ...user, passwordHash: undefined }, hash: user.passwordHash };
}

async function loadUserById(id) {
  if (id === "owner") return process.env.MANAGER_PORTAL_PASSWORD_HASH ? { id: "owner", username: "owner", name: "Sean", role: "owner", active: true } : null;
  const doc = await read("auth/users", { users: {} });
  const u = doc.users[id];
  return u && u.active ? { id: u.id, username: u.username, name: u.name, role: u.role, active: true } : null;
}

// ---- brute-force protection ----

async function recentFailures(key) {
  const doc = await read(key, { failures: [] });
  const cutoff = Date.now() - LOGIN_WINDOW_MS;
  return doc.failures.filter((t) => t > cutoff);
}

async function recordFailure(key) {
  const cutoff = Date.now() - LOGIN_WINDOW_MS;
  await update(key, { failures: [] }, (doc) => ({ failures: [...doc.failures.filter((t) => t > cutoff), Date.now()].slice(-100) }));
}

async function assertLoginAllowed(ipKey) {
  const [ip, global] = await Promise.all([recentFailures(ipKey), recentFailures("auth/ratelimit/login-global")]);
  const blocked = ip.length >= LOGIN_MAX_PER_IP ? ip : global.length >= LOGIN_MAX_GLOBAL ? global : null;
  if (blocked) {
    const retryAfter = Math.max(1, Math.ceil((blocked[0] + LOGIN_WINDOW_MS - Date.now()) / 1000));
    const err = new HttpError(429, "rate_limited", "Too many sign-in attempts. Try again in a few minutes.", { retryAfter });
    err.headers = { "Retry-After": String(retryAfter) };
    throw err;
  }
}

// ---- login / logout / session check ----

export async function login(req, context, { username, password }) {
  const ipKey = `auth/ratelimit/login-${sha256(clientIp(req, context)).slice(0, 32)}`;
  await assertLoginAllowed(ipKey);

  if (typeof password !== "string" || !password || password.length > 200) {
    throw new HttpError(400, "invalid", "Enter your password.");
  }
  const found = await findUser(username);
  if (!found.configured) {
    throw new HttpError(503, "not_configured", "Portal sign-in hasn't been set up on this deploy yet.");
  }
  // Compare against a dummy hash when the user doesn't exist, so a wrong
  // username and a wrong password take the same time.
  const hash = found.hash || "$2b$12$.ox.N/EBlmPz6o.TDPM..eapdiMz55tVUMgY1mXY8BtAXqNZX5ggq";
  const ok = (await bcrypt.compare(password, hash)) && found.user && found.user.active !== false;
  if (!ok) {
    await Promise.all([recordFailure(ipKey), recordFailure("auth/ratelimit/login-global")]);
    await new Promise((r) => setTimeout(r, 400));
    throw new HttpError(401, "bad_credentials", "That password didn't work.");
  }
  await remove(ipKey);

  const sid = randomBytes(32).toString("base64url");
  const now = Date.now();
  await write(`auth/sessions/${sha256(sid)}`, {
    userId: found.user.id,
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + SESSION_MAX_AGE_S * 1000).toISOString(),
    lastSeenAt: new Date(now).toISOString(),
    ipHash: sha256(clientIp(req, context)).slice(0, 16),
  });
  return { user: found.user, cookie: sessionCookie(sid, SESSION_MAX_AGE_S) };
}

export async function logout(req) {
  const sid = parseCookies(req)[SESSION_COOKIE];
  if (sid) await remove(`auth/sessions/${sha256(sid)}`);
  return sessionCookie("", 0);
}

/**
 * Validate the session cookie and (optionally) a permission. Throws 401 when
 * signed out or expired, 403 when signed in without the permission.
 */
export async function requireSession(req, permission) {
  const sid = parseCookies(req)[SESSION_COOKIE];
  if (!sid || sid.length > 100) throw new HttpError(401, "signed_out", "Please sign in.");
  const key = `auth/sessions/${sha256(sid)}`;
  const session = await read(key);
  const now = Date.now();
  const expired =
    !session ||
    now > Date.parse(session.expiresAt) ||
    now > Date.parse(session.lastSeenAt) + SESSION_IDLE_S * 1000;
  if (expired) {
    if (session) await remove(key);
    throw new HttpError(401, "session_expired", "Your session ended. Please sign in again.");
  }
  const user = await loadUserById(session.userId);
  if (!user) {
    await remove(key);
    throw new HttpError(401, "signed_out", "Please sign in.");
  }
  if (permission && !can(user.role, permission)) {
    throw new HttpError(403, "forbidden", "Your account doesn't have access to that.");
  }
  if (now - Date.parse(session.lastSeenAt) > TOUCH_EVERY_MS) {
    await write(key, { ...session, lastSeenAt: new Date(now).toISOString() });
  }
  return { user, permissions: permissionsFor(user.role) };
}

/** State-changing requests must come from the portal itself. */
export function assertSameOrigin(req) {
  if (req.method === "GET" || req.method === "HEAD") return;
  if (req.headers.get("x-portal-request") !== "1") {
    throw new HttpError(403, "bad_origin", "Request rejected.");
  }
  const origin = req.headers.get("origin");
  if (origin) {
    const host = new URL(req.url).host;
    if (new URL(origin).host !== host) throw new HttpError(403, "bad_origin", "Request rejected.");
  }
}

// ---- API keys for Jarvis and other services ----
//
// Scopes follow the automation ladder: read < suggest < create < update <
// financial. Keys are shown once when created; only a SHA-256 is stored.

export const API_SCOPES = {
  read: "Read reports, KPIs, pipeline, activity, alerts",
  read_financial: "Include money values in reports",
  suggest: "Propose tasks that wait for a manager's approval",
  create: "Create records directly",
  update: "Change existing records",
  financial: "Record payments and other money changes",
};

export async function createApiKey({ name, scopes, createdBy }) {
  const id = newId("key");
  const secret = randomBytes(24).toString("base64url");
  const token = `sdp_${id}.${secret}`;
  await update("auth/apikeys", { keys: {} }, (doc) => {
    doc.keys[id] = { id, name, scopes, hash: sha256(secret), createdAt: nowIso(), createdBy, lastUsedAt: null, revokedAt: null };
    return doc;
  });
  return { id, token };
}

export async function listApiKeys() {
  const doc = await read("auth/apikeys", { keys: {} });
  return Object.values(doc.keys)
    .map(({ hash, ...k }) => k)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function revokeApiKey(id) {
  let found = false;
  await update("auth/apikeys", { keys: {} }, (doc) => {
    if (!doc.keys[id]) return undefined;
    found = true;
    doc.keys[id].revokedAt = nowIso();
    return doc;
  });
  return found;
}

export async function requireApiKey(req, scope) {
  const auth = req.headers.get("authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : req.headers.get("x-sd-portal-api-key")?.trim() || "";
  const m = /^sdp_(key_[A-Za-z0-9_-]{12})\.([A-Za-z0-9_-]{20,64})$/.exec(token);
  if (!m) throw new HttpError(401, "missing_key", "A valid API key is required.");
  const doc = await read("auth/apikeys", { keys: {} });
  const key = doc.keys[m[1]];
  const given = Buffer.from(sha256(m[2]));
  if (!key || key.revokedAt || !timingSafeEqual(Buffer.from(key.hash), given)) {
    throw new HttpError(401, "bad_key", "That API key isn't valid.");
  }
  if (scope && !key.scopes.includes(scope)) {
    throw new HttpError(403, "scope_missing", `This key doesn't have the "${scope}" scope.`);
  }

  // per-key rate limit: 120 requests a minute
  const minute = Math.floor(Date.now() / 60000);
  const counterKey = `auth/ratelimit/apikey-${key.id}`;
  const counter = await update(counterKey, { minute, count: 0 }, (c) => (c.minute === minute ? { minute, count: c.count + 1 } : { minute, count: 1 }));
  if (counter.count > 120) {
    const err = new HttpError(429, "rate_limited", "Too many requests for this key. Slow down.", { retryAfter: 60 });
    err.headers = { "Retry-After": "60" };
    throw err;
  }
  if (!key.lastUsedAt || Date.now() - Date.parse(key.lastUsedAt) > 10 * 60 * 1000) {
    await update("auth/apikeys", { keys: {} }, (d) => {
      if (!d.keys[key.id]) return undefined;
      d.keys[key.id].lastUsedAt = nowIso();
      return d;
    });
  }
  return { id: key.id, name: key.name, scopes: key.scopes };
}
