// Portal authentication and authorization.
//
// - The owner (Sean) signs in with the password whose bcrypt hash is in the
//   MANAGER_PORTAL_PASSWORD_HASH environment variable. Plaintext is never
//   stored, logged, returned, or shipped to the browser.
// - Collaborators get individual accounts (username + their own password,
//   stored only as a bcrypt hash) so access can follow assignments.
// - A login creates an opaque random session id, held in an HttpOnly,
//   Secure, SameSite=Strict cookie scoped to /api/manager. The server keeps
//   only its SHA-256 and checks expiry and the account on every request.
// - Jarvis uses a separate read-only service token (JARVIS_SITE_API_TOKEN),
//   never a staff login.
import bcrypt from "bcryptjs";
import { randomBytes, timingSafeEqual, createHash } from "node:crypto";
import { HttpError, sha256, nowIso, newId, clientIp, v } from "./http.js";
import { read, write, remove, update } from "./store.js";

export const SESSION_COOKIE = "sd_portal";
const SESSION_MAX_AGE_S = 12 * 60 * 60;
const SESSION_IDLE_S = 4 * 60 * 60;
const TOUCH_EVERY_MS = 5 * 60 * 1000;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_PER_IP = 5;
const LOGIN_MAX_GLOBAL = 40;
const DUMMY_HASH = "$2b$12$.ox.N/EBlmPz6o.TDPM..eapdiMz55tVUMgY1mXY8BtAXqNZX5ggq";

/**
 * Managers see and run the whole business. Staff (collaborators) see only
 * the projects, deliverables, and tasks assigned to them, without money or
 * client contact details. Both lists are enforced by every API route.
 */
export const ROLES = {
  owner: { label: "Owner", permissions: ["*"] },
  manager: { label: "Manager", permissions: ["records.read", "records.write", "money.read", "money.write", "work.read", "work.update", "export"] },
  staff: { label: "Collaborator", permissions: ["work.read", "work.update"] },
};
const ALL_PERMISSIONS = ["records.read", "records.write", "money.read", "money.write", "work.read", "work.update", "export", "users.manage"];

export const can = (role, permission) => {
  const perms = ROLES[role]?.permissions || [];
  return perms.includes("*") || perms.includes(permission);
};
export const permissionsFor = (role) => ALL_PERMISSIONS.filter((p) => can(role, p));

// ---- cookies ----

function parseCookies(req) {
  const out = {};
  for (const part of (req.headers.get("cookie") || "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}
const sessionCookie = (value, maxAge) => `${SESSION_COOKIE}=${value}; Path=/api/manager; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAge}`;

// ---- accounts ----

const OWNER = { id: "owner", username: "sean", name: "Sean", role: "owner", active: true };

async function usersDoc() {
  return read("auth/users", { users: {} });
}

async function findLogin(username) {
  const name = (username || "").trim().toLowerCase();
  if (!name || name === "sean" || name === "owner") {
    const hash = process.env.MANAGER_PORTAL_PASSWORD_HASH?.trim();
    return hash ? { configured: true, user: OWNER, hash } : { configured: false };
  }
  const user = Object.values((await usersDoc()).users).find((u) => u.username === name);
  return { configured: true, user: user && user.active ? publicUser(user) : null, hash: user?.passwordHash };
}

export async function loadUser(id) {
  if (id === "owner") return process.env.MANAGER_PORTAL_PASSWORD_HASH ? OWNER : null;
  const u = (await usersDoc()).users[id];
  return u && u.active ? publicUser(u) : null;
}

const publicUser = ({ passwordHash, ...u }) => u;

export async function listUsers() {
  const doc = await usersDoc();
  return [OWNER, ...Object.values(doc.users).map(publicUser).sort((a, b) => a.name.localeCompare(b.name))];
}

function tempPassword() {
  // readable, high-entropy: 4 groups of 4 from an unambiguous alphabet
  const alphabet = "abcdefghjkmnpqrstuvwxyz23456789";
  const bytes = randomBytes(16);
  return Array.from({ length: 4 }, (_, g) => Array.from({ length: 4 }, (_, i) => alphabet[bytes[g * 4 + i] % alphabet.length]).join("")).join("-");
}

export async function createUser({ name, username, role }) {
  const clean = {
    name: v.str(name, "Name", { max: 80, required: true }),
    username: v.str(username, "Username", { max: 40, required: true })?.toLowerCase(),
    role: v.oneOf(role, "Role", ["manager", "staff"], { required: true }),
  };
  if (!/^[a-z0-9._-]{3,40}$/.test(clean.username) || ["sean", "owner"].includes(clean.username)) {
    throw new HttpError(400, "invalid", "Use 3 to 40 letters, numbers, dots, dashes, or underscores (not sean or owner).", { field: "Username" });
  }
  const password = tempPassword();
  const user = { id: newId("usr"), ...clean, active: true, passwordHash: await bcrypt.hash(password, 12), createdAt: nowIso(), updatedAt: nowIso() };
  await update("auth/users", { users: {} }, (doc) => {
    if (Object.values(doc.users).some((u) => u.username === clean.username)) throw new HttpError(409, "duplicate", "That username is taken.");
    doc.users[user.id] = user;
    return doc;
  });
  return { user: publicUser(user), temporaryPassword: password };
}

export async function updateUser(id, { active, role, resetPassword }) {
  let password = null;
  let saved;
  const hash = resetPassword ? await bcrypt.hash((password = tempPassword()), 12) : null;
  await update("auth/users", { users: {} }, (doc) => {
    const u = doc.users[id];
    if (!u) throw new HttpError(404, "not_found", "That account doesn't exist.");
    if (active !== undefined) u.active = Boolean(active);
    if (role !== undefined) u.role = v.oneOf(role, "Role", ["manager", "staff"], { required: true });
    if (hash) u.passwordHash = hash;
    u.updatedAt = nowIso();
    saved = u;
    return doc;
  });
  return { user: publicUser(saved), temporaryPassword: password };
}

// ---- brute-force protection ----

async function recentFailures(key) {
  const cutoff = Date.now() - LOGIN_WINDOW_MS;
  return (await read(key, { failures: [] })).failures.filter((t) => t > cutoff);
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

// ---- login / logout / session ----

export async function login(req, context, { username, password }) {
  const ipKey = `auth/ratelimit/login-${sha256(clientIp(req, context)).slice(0, 32)}`;
  await assertLoginAllowed(ipKey);
  if (typeof password !== "string" || !password || password.length > 200) throw new HttpError(400, "invalid", "Enter your password.");
  const found = await findLogin(username);
  if (!found.configured) throw new HttpError(503, "not_configured", "Portal sign-in hasn't been set up on this deploy yet.");
  const ok = (await bcrypt.compare(password, found.hash || DUMMY_HASH)) && Boolean(found.user);
  if (!ok) {
    await Promise.all([recordFailure(ipKey), recordFailure("auth/ratelimit/login-global")]);
    await new Promise((r) => setTimeout(r, 400));
    throw new HttpError(401, "bad_credentials", "That username or password didn't work.");
  }
  await remove(ipKey);
  const sid = randomBytes(32).toString("base64url");
  const now = Date.now();
  await write(`auth/sessions/${sha256(sid)}`, {
    userId: found.user.id,
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + SESSION_MAX_AGE_S * 1000).toISOString(),
    lastSeenAt: new Date(now).toISOString(),
  });
  return { user: found.user, cookie: sessionCookie(sid, SESSION_MAX_AGE_S) };
}

export async function logout(req) {
  const sid = parseCookies(req)[SESSION_COOKIE];
  if (sid) await remove(`auth/sessions/${sha256(sid)}`);
  return sessionCookie("", 0);
}

export async function requireSession(req, permission) {
  const sid = parseCookies(req)[SESSION_COOKIE];
  if (!sid || sid.length > 100) throw new HttpError(401, "signed_out", "Please sign in.");
  const key = `auth/sessions/${sha256(sid)}`;
  const session = await read(key);
  const now = Date.now();
  if (!session || now > Date.parse(session.expiresAt) || now > Date.parse(session.lastSeenAt) + SESSION_IDLE_S * 1000) {
    if (session) await remove(key);
    throw new HttpError(401, "session_expired", "Your session ended. Please sign in again.");
  }
  const user = await loadUser(session.userId);
  if (!user) {
    await remove(key);
    throw new HttpError(401, "signed_out", "Please sign in.");
  }
  if (permission && !can(user.role, permission)) throw new HttpError(403, "forbidden", "Your account doesn't have access to that.");
  if (now - Date.parse(session.lastSeenAt) > TOUCH_EVERY_MS) await write(key, { ...session, lastSeenAt: new Date(now).toISOString() });
  return { user, permissions: permissionsFor(user.role), can: (p) => can(user.role, p) };
}

export function assertSameOrigin(req) {
  if (req.method === "GET" || req.method === "HEAD") return;
  if (req.headers.get("x-portal-request") !== "1") throw new HttpError(403, "bad_origin", "Request rejected.");
  const origin = req.headers.get("origin");
  if (origin && new URL(origin).host !== new URL(req.url).host) throw new HttpError(403, "bad_origin", "Request rejected.");
}

// ---- Jarvis service token (read-only) ----

export function jarvisTokenConfigured() {
  return Boolean(process.env.JARVIS_SITE_API_TOKEN?.trim());
}

export async function requireJarvisToken(req) {
  const expected = process.env.JARVIS_SITE_API_TOKEN?.trim();
  const auth = req.headers.get("authorization") || "";
  const given = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (!given) throw new HttpError(401, "unauthorized", "A valid Jarvis service token is required.");
  if (!expected) throw new HttpError(503, "not_configured", "The Jarvis API token isn't configured on this deploy.");
  const a = createHash("sha256").update(given).digest();
  const b = createHash("sha256").update(expected).digest();
  if (!given || !timingSafeEqual(a, b)) throw new HttpError(401, "unauthorized", "A valid Jarvis service token is required.");
  const minute = Math.floor(Date.now() / 60000);
  const counter = await update("auth/ratelimit/jarvis", { minute, count: 0 }, (c) => (c.minute === minute ? { minute, count: c.count + 1 } : { minute, count: 1 }));
  if (counter.count > 120) {
    const err = new HttpError(429, "rate_limited", "Too many requests. Slow down.", { retryAfter: 60 });
    err.headers = { "Retry-After": "60" };
    throw err;
  }
}
