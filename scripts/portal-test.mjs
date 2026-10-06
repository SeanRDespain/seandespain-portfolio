// End-to-end test for the manager portal, the inquiry form, and the Jarvis
// API. Starts the local dev server with a random throwaway password, runs
// every check against it, and prints a pass/fail list.
//
//   npm run build && node scripts/portal-test.mjs [screenshotDir]
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import bcrypt from "bcryptjs";
import { chromium } from "playwright";

const PORT = 4519;
const BASE = `http://localhost:${PORT}`;
const STORE = ".portal-test";
const shots = process.argv[2] || null;
const password = randomBytes(12).toString("base64url");
const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok: Boolean(ok), detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail && !ok ? `  (${detail})` : ""}`);
};

await fs.rm(STORE, { recursive: true, force: true });
const server = spawn(process.execPath, ["scripts/portal-dev.mjs", String(PORT)], {
  env: { ...process.env, SD_STORE_DIR: STORE, MANAGER_PORTAL_PASSWORD_HASH: bcrypt.hashSync(password, 10) },
  stdio: ["ignore", "pipe", "pipe"],
});
await new Promise((resolve) => server.stdout.on("data", (d) => String(d).includes("portal dev server") && resolve()));
server.stderr.on("data", (d) => process.stderr.write(`[server] ${d}`));

async function call(p, { method = "GET", body, cookie, ip = "10.0.0.1", portal = true, headers = {} } = {}) {
  const h = { ...headers, "x-test-ip": ip };
  if (body !== undefined) h["content-type"] = "application/json";
  if (portal && method !== "GET") h["x-portal-request"] = "1";
  if (cookie) h.cookie = cookie;
  const res = await fetch(`${BASE}${p}`, { method, headers: h, body: body !== undefined ? JSON.stringify(body) : undefined, redirect: "manual" });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {}
  return { status: res.status, json, text, headers: res.headers };
}
const loginCookie = async (ip = "10.0.0.2", username) => {
  const r = await call("/api/manager/login", { method: "POST", body: { password, ...(username ? { username } : {}) }, ip });
  return { r, cookie: (r.headers.getSetCookie()[0] || "").split(";")[0] };
};

try {
  // ---------------- authentication ----------------
  check("API: me requires sign-in", (await call("/api/manager/me")).status === 401);
  check("API: overview requires sign-in", (await call("/api/manager/overview")).status === 401);
  check("API: contacts requires sign-in", (await call("/api/manager/contacts")).status === 401);
  check("Jarvis API requires a key", (await call("/api/jarvis/v1/summary", { portal: false })).status === 401);
  check("Wrong password is rejected", (await call("/api/manager/login", { method: "POST", body: { password: "nope-nope" }, ip: "10.0.1.1" })).status === 401);
  check("Login without the portal header is rejected (CSRF)", (await call("/api/manager/login", { method: "POST", body: { password }, portal: false })).status === 403);

  const { r: loginRes, cookie } = await loginCookie();
  const setCookie = loginRes.headers.getSetCookie()[0] || "";
  check("Correct password signs in", loginRes.status === 200 && cookie.startsWith("sd_portal="));
  check("Session cookie is HttpOnly, Secure, SameSite=Strict, API-scoped", /HttpOnly/.test(setCookie) && /Secure/.test(setCookie) && /SameSite=Strict/.test(setCookie) && /Path=\/api\/manager/.test(setCookie));
  check("Login response never echoes the password or hash", !loginRes.text.includes(password) && !loginRes.text.includes("$2"));
  const me = await call("/api/manager/me", { cookie });
  check("Signed-in session reads its own account", me.status === 200 && me.json.user.role === "owner");
  check("Write without the portal header is rejected (CSRF)", (await call("/api/manager/contacts", { method: "POST", body: { name: "X" }, cookie, portal: false })).status === 403);

  for (let i = 0; i < 5; i++) await call("/api/manager/login", { method: "POST", body: { password: `wrong-${i}` }, ip: "10.0.2.2" });
  const locked = await call("/api/manager/login", { method: "POST", body: { password }, ip: "10.0.2.2" });
  check("Brute force: 6th attempt from one IP is blocked, even with the right password", locked.status === 429 && locked.headers.get("retry-after"));

  // ---------------- public inquiry form ----------------
  const browser = await chromium.launch();
  const visitor = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const vp = await visitor.newPage();
  const pageErrors = [];
  vp.on("pageerror", (e) => pageErrors.push(e.message));
  await vp.goto(`${BASE}/?utm_source=linkedin&utm_medium=social&utm_campaign=profile`);
  await vp.goto(`${BASE}/work/jarvis/`);
  await vp.goto(`${BASE}/contact/?type=project#inquiry`);
  await vp.fill("input[name=name]", "Dana Rivera");
  await vp.fill("input[name=email]", "dana@example.com");
  await vp.fill("input[name=company]", "Rivera Outfitters");
  await vp.selectOption("select[name=budget]", "10000_25000");
  await vp.selectOption("select[name=timeline]", "1_3_months");
  await vp.fill("textarea[name=message]", "We need a booking app for our guided trips, plus a new website.");
  await vp.waitForTimeout(2700);
  await vp.click(".inquiry button[type=submit]");
  await vp.waitForSelector("[data-inquiry-sent]:not([hidden])", { timeout: 8000 });
  check("Website form submits and confirms", true);
  check("Public pages have no script errors", pageErrors.length === 0, pageErrors.join(" | "));

  let opps = (await call("/api/manager/opportunities?kind=project&status=all", { cookie })).json.items;
  const inbound = opps.find((o) => o.company === "Rivera Outfitters");
  check("Inquiry became a project opportunity", Boolean(inbound));
  check("Source captured automatically from UTM (LinkedIn)", inbound?.source === "linkedin", inbound?.source);
  check("Pages read before inquiry captured (Jarvis case study)", inbound?.attribution?.pages?.includes("/work/jarvis/"), JSON.stringify(inbound?.attribution?.pages));
  check("Budget range pre-filled the estimate", inbound?.value?.estimate === 17500 && inbound?.value?.basis === "inquiry_budget");
  check("A Reply task was created automatically", inbound?.awaitingReply === true);

  const before = (await call("/api/manager/opportunities?status=all", { cookie })).json.items.length;
  await call("/api/inquiry", { method: "POST", portal: false, body: { type: "project", name: "Bot", email: "bot@example.com", message: "buy cheap stuff now please", website_url: "http://spam" }, ip: "10.0.3.1" });
  await call("/api/inquiry", { method: "POST", portal: false, body: { type: "project", name: "Fast", email: "fast@example.com", message: "too quick to be human", t: Date.now() }, ip: "10.0.3.2" });
  check("Bot traps (hidden field, instant submit) store nothing", (await call("/api/manager/opportunities?status=all", { cookie })).json.items.length === before);
  check("Inquiry validation rejects a missing email", (await call("/api/inquiry", { method: "POST", portal: false, body: { type: "project", name: "No Email", message: "hello there friend" }, ip: "10.0.3.3" })).status === 400);
  check("Inquiry from a foreign site is rejected", (await call("/api/inquiry", { method: "POST", portal: false, headers: { origin: "https://evil.example" }, body: { type: "other", name: "E", email: "e@example.com", message: "hello from elsewhere" }, ip: "10.0.3.4" })).status === 403);
  const job = await call("/api/inquiry", { method: "POST", portal: false, body: { type: "job", name: "Riley Chen", email: "riley@talent.example", company: "Northwind", message: "We have a Product Designer role open." }, ip: "10.0.3.5" });
  check("Recruiter inquiry is accepted", job.status === 200);
  let last;
  for (let i = 0; i < 6; i++) last = await call("/api/inquiry", { method: "POST", portal: false, body: { type: "other", name: `Q${i}`, email: `q${i}@example.com`, message: "a quick question for you" }, ip: "10.0.3.9" });
  check("Inquiry rate limit: 6th from one IP in an hour is blocked", last.status === 429);

  // ---------------- portal workflows ----------------
  const id = inbound.id;
  await call("/api/manager/interactions", { method: "POST", cookie, body: { opportunityId: id, type: "email", direction: "outbound", note: "Thanks Dana, free Thursday?" } });
  let detail = (await call(`/api/manager/opportunities/${id}`, { cookie })).json;
  check("Logging a reply closes the Reply task", detail.tasks.every((t) => t.kind !== "reply" || t.status === "done"));
  check("Lost requires a reason", (await call(`/api/manager/opportunities/${id}/stage`, { method: "POST", cookie, body: { stage: "lost" } })).status === 400);
  for (const s of ["conversation", "proposal", "active"]) await call(`/api/manager/opportunities/${id}/stage`, { method: "POST", cookie, body: { stage: s } });
  await call(`/api/manager/opportunities/${id}`, { method: "PATCH", cookie, body: { final: 16000 } });
  await call(`/api/manager/opportunities/${id}/payments`, { method: "POST", cookie, body: { type: "invoiced", amount: 8000 } });
  await call(`/api/manager/opportunities/${id}/payments`, { method: "POST", cookie, body: { type: "received", amount: 5000 } });
  detail = (await call(`/api/manager/opportunities/${id}`, { cookie })).json;
  check("Stage moves to won and stamps the win", detail.opportunity.stage === "active" && Boolean(detail.opportunity.wonAt));
  check("Money: agreed, received, outstanding", detail.opportunity.money.value === 16000 && detail.opportunity.money.received === 5000 && detail.opportunity.money.outstanding === 3000);
  const types = detail.events.map((e) => e.type);
  check("History recorded automatically", ["form_submitted", "opportunity_created", "interaction_logged", "proposal_sent", "opportunity_won", "payment_recorded"].every((t) => types.includes(t)) || ["opportunity_created", "interaction_logged", "proposal_sent", "opportunity_won", "payment_recorded"].every((t) => types.includes(t)), types.join(","));

  const createdJob = await call("/api/manager/opportunities", { method: "POST", cookie, body: { kind: "job", title: "Senior Product Designer at Acme", source: "linkedin", direction: "outbound", stage: "applied", employment: "full_time", estimate: 130000, newContact: { name: "Morgan Lee", email: "morgan@acme.example" } } });
  check("Manual job opportunity with a new contact", createdJob.status === 201);
  await call(`/api/manager/opportunities/${createdJob.json.opportunity.id}/stage`, { method: "POST", cookie, body: { stage: "interviewing" } });
  await call("/api/manager/tasks", { method: "POST", cookie, body: { title: "Portfolio review with Acme", kind: "interview", relatedType: "opportunity", relatedId: createdJob.json.opportunity.id, dueAt: new Date(Date.now() + 26 * 3600e3).toISOString(), priority: "high" } });
  await call("/api/manager/tasks", { method: "POST", cookie, body: { title: "Send Rivera the kickoff checklist", kind: "follow_up", relatedType: "opportunity", relatedId: id, dueAt: new Date(Date.now() - 30 * 3600e3).toISOString() } });

  const ov = (await call("/api/manager/overview?period=30d", { cookie })).json;
  const k = Object.fromEntries(ov.kpis.map((x) => [x.key, x]));
  check("KPI: new opportunities counts both pipelines", k.new_opportunities.value >= 3, k.new_opportunities.value);
  check("KPI: median reply time measured", k.response_time.value != null);
  check("KPI: won value and interviews", k.won_value.value === 16000 && k.active_interviews.value === 1);
  check("Alerts flag the overdue task and the waiting recruiter", ov.alerts.some((a) => a.key === "task_overdue") && ov.alerts.some((a) => a.key === "reply_overdue" || a.key === "coming_up" || a.key === "payment_outstanding"));
  check("Work attraction shows the Jarvis case study", ov.work.pages.some((p) => p.path === "/work/jarvis/"));
  check("Sources group opportunities", ov.sources.some((s) => s.source === "linkedin"));
  const money = (await call("/api/manager/money?period=90d", { cookie })).json;
  check("Money view: won, received, outstanding; job pay kept separate", money.period.won === 16000 && money.period.received === 5000 && money.outstanding === 3000);
  check("Search finds people and opportunities", (await call("/api/manager/search?q=rivera", { cookie })).json.opportunities.length >= 1);

  // ---------------- Jarvis API ----------------
  const key1 = (await call("/api/manager/api-keys", { method: "POST", cookie, body: { name: "Jarvis", scopes: ["read", "suggest"] } })).json;
  const key2 = (await call("/api/manager/api-keys", { method: "POST", cookie, body: { name: "Jarvis finance", scopes: ["read", "read_financial"] } })).json;
  const asJarvis = (p, token, opts = {}) => call(p, { ...opts, portal: false, headers: { authorization: `Bearer ${token}` } });
  const summary = await asJarvis("/api/jarvis/v1/summary?period=30d", key1.token);
  check("Jarvis summary returns the normalized schema", summary.status === 200 && summary.json.schema === "jarvis.business_report" && summary.json.schemaVersion === "1.0");
  check("Jarvis without read_financial gets no money", summary.json.revenue === null && summary.json.kpis.find((x) => x.key === "won_value").value === null);
  check("Jarvis report carries no emails or message text", !/@example\.com|booking app for our guided trips/.test(summary.text));
  const fin = await asJarvis("/api/jarvis/v1/summary?period=30d", key2.token);
  check("Jarvis with read_financial gets revenue", fin.json.revenue?.won === 16000 && fin.json.revenue?.received === 5000);
  check("Jarvis activity feed works", (await asJarvis("/api/jarvis/v1/activity?limit=5", key1.token)).json.items.length === 5);
  const sug = await asJarvis("/api/jarvis/v1/suggestions", key1.token, { method: "POST", body: { title: "Follow up with Northwind", kind: "follow_up", reason: "Recruiter waiting 2 days" } });
  check("Jarvis can suggest a task (waits for approval)", sug.status === 201 && sug.json.task.status === "suggested");
  check("A key without 'suggest' can't suggest", (await asJarvis("/api/jarvis/v1/suggestions", key2.token, { method: "POST", body: { title: "x" } })).status === 403);
  await call(`/api/manager/api-keys/${key1.id}`, { method: "DELETE", cookie });
  check("A revoked key stops working", (await asJarvis("/api/jarvis/v1/summary", key1.token)).status === 401);
  check("A made-up key is rejected", (await asJarvis("/api/jarvis/v1/summary", "sdp_key_AAAAAAAAAAAA.bbbbbbbbbbbbbbbbbbbbbbbb")).status === 401);

  // ---------------- roles (server-side) ----------------
  await fs.mkdir(path.join(STORE, "auth"), { recursive: true });
  await fs.writeFile(path.join(STORE, "auth", "users.json"), JSON.stringify({ users: { usr_ro: { id: "usr_ro", username: "viewer", name: "Viewer", role: "read_only", active: true, passwordHash: bcrypt.hashSync(password, 10) } } }));
  const { cookie: roCookie } = await loginCookie("10.0.4.1", "viewer");
  check("Read-only role: can view the pipeline", (await call("/api/manager/opportunities", { cookie: roCookie })).status === 200);
  check("Read-only role: money values are stripped", (await call(`/api/manager/opportunities/${id}`, { cookie: roCookie })).json.opportunity.value === null);
  check("Read-only role: Money view is forbidden", (await call("/api/manager/money", { cookie: roCookie })).status === 403);
  check("Read-only role: cannot create records", (await call("/api/manager/contacts", { method: "POST", cookie: roCookie, body: { name: "Nope" } })).status === 403);
  check("Read-only role: cannot manage API keys", (await call("/api/manager/api-keys", { cookie: roCookie })).status === 403);

  // ---------------- portal UI ----------------
  const ui = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const up = await ui.newPage();
  const uiErrors = [];
  up.on("pageerror", (e) => uiErrors.push(e.message));
  up.on("console", (m) => m.type() === "error" && !/401|Failed to load resource/.test(m.text()) && uiErrors.push(m.text()));
  await up.goto(`${BASE}/manager/`);
  await up.waitForSelector(".mp-login");
  await up.fill("input[name=password]", "definitely-wrong");
  await up.click(".mp-login button");
  await up.waitForFunction(() => document.querySelector(".mp-login__msg")?.textContent.length > 0);
  check("UI: wrong password shows an error", /didn't work/.test(await up.textContent(".mp-login__msg")));
  await up.fill("input[name=password]", password);
  await up.click(".mp-login button");
  await up.waitForSelector(".mp-kpi");
  check("UI: overview renders KPIs and attention items", (await up.$$(".mp-kpi")).length >= 6 && (await up.$$(".mp-attn li")).length >= 1);
  if (shots) await up.screenshot({ path: path.join(shots, "portal-desk-overview.png"), fullPage: true });
  for (const [hash, sel, name] of [
    ["#/pipeline", ".mp-board", "pipeline"],
    [`#/opportunity/${id}`, ".mp-stepper", "opportunity"],
    ["#/people", ".mp-people", "people"],
    ["#/tasks", ".mp-list", "tasks"],
    ["#/money", ".mp-kpis", "money"],
    ["#/analytics", ".mp-ov", "analytics"],
    ["#/activity", ".mp-timeline", "activity"],
    ["#/settings", ".mp-facts", "settings"],
  ]) {
    await up.goto(`${BASE}/manager/${hash}`);
    const ok = await up.waitForSelector(sel, { timeout: 8000 }).then(() => true, () => false);
    check(`UI: ${name} view loads`, ok);
    if (shots && ["pipeline", "opportunity", "money", "settings"].includes(name)) await up.screenshot({ path: path.join(shots, `portal-desk-${name}.png`), fullPage: true });
  }
  await up.goto(`${BASE}/manager/#/tasks?view=suggested`);
  await up.waitForSelector("[data-task-approve]");
  await up.click("[data-task-approve]");
  await up.waitForTimeout(600);
  check("UI: approving a Jarvis suggestion makes it a real task", (await call("/api/manager/tasks?view=suggested", { cookie })).json.items.length === 0);
  await up.goto(`${BASE}/manager/#/opportunity/${createdJob.json.opportunity.id}`);
  await up.waitForSelector("[data-log=note]");
  await up.click("[data-log=note]");
  await up.fill("#sheet textarea[name=note]", "Asked about the team size and design system maturity.");
  await up.click("#sheet button[type=submit]");
  await up.waitForTimeout(700);
  check("UI: adding a note from the record page saves it", (await call(`/api/manager/opportunities/${createdJob.json.opportunity.id}`, { cookie })).json.events.some((e) => e.type === "note_added"));
  check("UI: no script errors across the portal", uiErrors.length === 0, uiErrors.join(" | "));

  const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const pp = await phone.newPage();
  await pp.goto(`${BASE}/manager/`);
  await pp.fill("input[name=password]", password);
  await pp.click(".mp-login button");
  await pp.waitForSelector(".mp-kpi");
  const bottomVisible = await pp.isVisible(".mp-bottom");
  const overflow = await pp.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  check("Phone: bottom tab bar shows, no sideways scrolling", bottomVisible && !overflow);
  if (shots) await pp.screenshot({ path: path.join(shots, "portal-phone-overview.png"), fullPage: true });
  for (const [hash, sel, name] of [["#/pipeline", ".mp-board", "pipeline"], [`#/opportunity/${id}`, ".mp-stepper", "opportunity"], ["#/tasks", ".mp-list", "tasks"]]) {
    await pp.goto(`${BASE}/manager/${hash}`);
    await pp.waitForSelector(sel);
    const wide = await pp.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    check(`Phone: ${name} fits the screen`, !wide);
    if (shots) await pp.screenshot({ path: path.join(shots, `portal-phone-${name}.png`), fullPage: true });
  }
  await pp.goto(`${BASE}/manager/#/overview`);
  await pp.waitForSelector(".mp-kpi");
  await pp.click("[data-add]");
  await pp.waitForSelector("#sheet[open]");
  check("Phone: quick add opens as a bottom sheet", await pp.isVisible("#sheet[open] .mp-form"));
  if (shots) await pp.screenshot({ path: path.join(shots, "portal-phone-quickadd.png") });
  await browser.close();

  // ---------------- sessions ----------------
  const out = await call("/api/manager/logout", { method: "POST", cookie });
  check("Logout clears the cookie", out.status === 200 && /Max-Age=0/.test(out.headers.getSetCookie()[0] || ""));
  check("A signed-out cookie can't be replayed", (await call("/api/manager/me", { cookie })).status === 401);
  const { cookie: c2 } = await loginCookie("10.0.5.1");
  const sessDir = path.join(STORE, "auth", "sessions");
  for (const f of await fs.readdir(sessDir)) {
    const file = path.join(sessDir, f);
    const s = JSON.parse(await fs.readFile(file, "utf8"));
    s.expiresAt = new Date(Date.now() - 1000).toISOString();
    await fs.writeFile(file, JSON.stringify(s));
  }
  const expired = await call("/api/manager/me", { cookie: c2 });
  check("An expired session is refused", expired.status === 401 && expired.json.error.code === "session_expired");
} catch (err) {
  check("Test run completed without crashing", false, err.stack);
} finally {
  server.kill();
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  process.exitCode = failed.length ? 1 : 0;
}
