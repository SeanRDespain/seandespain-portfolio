// End-to-end test for the business portal, the inquiry form, and the Jarvis
// data API. Starts the local server (real function code, local file storage)
// with a random throwaway password and Jarvis token, runs every check, and
// prints pass/fail. All records it creates are labeled "[TEST]" or live in a
// throwaway store that is deleted first.
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
const shots = process.argv[2] || null;
const password = randomBytes(12).toString("base64url");
const jarvisToken = randomBytes(24).toString("base64url");
const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok: Boolean(ok) });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail && !ok ? `  (${detail})` : ""}`);
};

let server;
async function startServer(store) {
  server = spawn(process.execPath, ["scripts/portal-dev.mjs", String(PORT)], {
    env: { ...process.env, SD_STORE_DIR: store, MANAGER_PORTAL_PASSWORD_HASH: bcrypt.hashSync(password, 10), JARVIS_SITE_API_TOKEN: jarvisToken },
    stdio: ["ignore", "pipe", "pipe"],
  });
  server.stderr.on("data", (d) => process.stderr.write(`[server] ${d}`));
  await new Promise((resolve) => server.stdout.on("data", (d) => String(d).includes("portal dev server") && resolve()));
}
async function stopServer() {
  server.kill();
  await new Promise((r) => setTimeout(r, 300));
}

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
const signIn = async (ip, username, pw = password) => {
  const r = await call("/api/manager/login", { method: "POST", body: { password: pw, ...(username ? { username } : {}) }, ip });
  return { r, cookie: (r.headers.getSetCookie()[0] || "").split(";")[0] };
};
const jarvis = (p, token = jarvisToken) => call(p, { portal: false, headers: token ? { authorization: `Bearer ${token}` } : {} });
const inquiry = (body, ip = "10.1.0.1") => call("/api/inquiry", { method: "POST", portal: false, body: { t: Date.now() - 5000, ...body }, ip });
const ymd = (offsetDays) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Denver", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(Date.now() + offsetDays * 86400000));

try {
  // ======================= migration of v1 records =======================
  const OLD = ".portal-test-v1";
  await fs.rm(OLD, { recursive: true, force: true });
  const now = new Date().toISOString();
  const wr = async (key, value) => {
    const file = path.join(OLD, ...key.split("/")) + ".json";
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, JSON.stringify(value));
  };
  await wr("crm/contacts", { items: { con_a: { id: "con_a", name: "[TEST] Old Lead", email: "old@example.com", company: "Old Co", createdAt: now, updatedAt: now }, con_b: { id: "con_b", name: "[TEST] Won Client", email: "won@example.com", company: "Won Co", createdAt: now, updatedAt: now }, con_c: { id: "con_c", name: "[TEST] Asker", email: "ask@example.com", createdAt: now, updatedAt: now } } });
  await wr("crm/opportunities", {
    items: {
      opp_aaaaaaaaaaaa: { id: "opp_aaaaaaaaaaaa", kind: "project", title: "Project inquiry: Old Co", company: "Old Co", source: "direct", direction: "inbound", contactId: "con_a", stage: "inquiry", stageEnteredAt: now, stageHistory: [{ stage: "inquiry", at: now }], value: { estimate: 6000, final: null, basis: "inquiry_budget" }, payments: [], budget: "2500_10000", attribution: { first: { utm_source: "linkedin", landing_page: "/" }, latest: null, pages: ["/", "/work/jarvis/"] }, summary: "Need a site", createdAt: now, updatedAt: now },
      opp_bbbbbbbbbbbb: { id: "opp_bbbbbbbbbbbb", kind: "project", title: "Won Co app", company: "Won Co", source: "referral", direction: "inbound", contactId: "con_b", stage: "active", stageEnteredAt: now, stageHistory: [{ stage: "inquiry", at: now }, { stage: "proposal", at: now }, { stage: "active", at: now }], value: { estimate: 15000, final: 16000 }, payments: [{ id: "pay_1", type: "invoiced", amount: 8000, at: now }, { id: "pay_2", type: "received", amount: 5000, at: now }], attribution: { first: { referrer: "https://www.google.com/" }, latest: null, pages: [] }, wonAt: now, summary: "App build", createdAt: now, updatedAt: now },
      opp_cccccccccccc: { id: "opp_cccccccccccc", kind: "job", title: "[TEST] Designer at Acme", company: "Acme", source: "linkedin", direction: "outbound", contactId: null, stage: "lead", stageEnteredAt: now, stageHistory: [{ stage: "lead", at: now }], value: { estimate: 120000 }, payments: [], attribution: null, createdAt: now, updatedAt: now },
    },
  });
  await wr("crm/tasks", { items: { tsk_1: { id: "tsk_1", title: "Reply to Old Lead", kind: "reply", relatedType: "opportunity", relatedId: "opp_aaaaaaaaaaaa", status: "open", createdAt: now }, tsk_2: { id: "tsk_2", title: "Reply to Asker", kind: "reply", relatedType: "contact", relatedId: "con_c", status: "done", completedAt: now, createdAt: now } } });
  await wr(`events/${now.slice(0, 7)}`, { items: [{ id: "evt_zzzzzzzzzzzz", type: "form_submitted", at: now, actor: "website", contactId: "con_c", opportunityId: null, data: { formType: "other", source: "direct", message: "Quick question" } }] });
  await startServer(OLD);
  const { cookie: mc } = await signIn("10.9.0.1");
  const inqs = (await call("/api/manager/inquiries?status=all", { cookie: mc })).json.items;
  const opps = [...(await call("/api/manager/opportunities?type=client&status=all", { cookie: mc })).json.items, ...(await call("/api/manager/opportunities?type=employment&status=all", { cookie: mc })).json.items];
  const prjs = (await call("/api/manager/projects?phase=all", { cookie: mc })).json.items;
  check("Migration: untouched website opportunity became a New inquiry", inqs.some((i) => i.contactName === "[TEST] Old Lead" && i.status === "new" && i.source === "linkedin"));
  const exported = (await call("/api/manager/export", { cookie: mc })).json;
  check("Migration: its auto-created opportunity is archived, not deleted", !opps.some((o) => o.id === "opp_aaaaaaaaaaaa") && exported.opportunities.some((o) => o.id === "opp_aaaaaaaaaaaa" && o.archivedAt));
  check("Migration: progressed work kept as a Won client opportunity", opps.some((o) => o.id === "opp_bbbbbbbbbbbb" && o.type === "client" && o.stage === "won"));
  check("Migration: won work became a project with its received payment", prjs.some((p) => p.title === "Won Co app" && p.money?.collected === 5000 && p.money?.value === 16000));
  check("Migration: job lead became an employment opportunity", opps.some((o) => o.id === "opp_cccccccccccc" && o.type === "employment" && o.stage === "interested"));
  check("Migration: general question rebuilt as a contacted inquiry", inqs.some((i) => i.type === "general" && i.contactName === "[TEST] Asker" && i.status === "contacted"));
  const relinked = (await call(`/api/manager/inquiries/${inqs.find((i) => i.contactName === "[TEST] Old Lead").id}`, { cookie: mc })).json.tasks;
  check("Migration: the open Reply task now belongs to the inquiry", relinked.some((t) => t.kind === "reply" && t.status === "open"));
  await stopServer();
  await startServer(OLD);
  const { cookie: mc2 } = await signIn("10.9.0.2");
  check("Migration runs once (no duplicates after restart)", (await call("/api/manager/inquiries?status=all", { cookie: mc2 })).json.items.length === inqs.length);
  await stopServer();

  // ======================= fresh store: main checks =======================
  const STORE = ".portal-test";
  await fs.rm(STORE, { recursive: true, force: true });
  await startServer(STORE);

  // ---- anonymous access is rejected ----
  for (const p of ["me", "overview", "inquiries", "opportunities", "projects", "calendar", "tasks", "contacts", "users", "export"]) {
    if ((await call(`/api/manager/${p}`)).status !== 401) check(`Anonymous blocked: /api/manager/${p}`, false);
  }
  check("Anonymous requests to every portal API are rejected (401)", true);
  check("Jarvis API rejects anonymous requests", (await jarvis("/api/jarvis/v1/health", null)).status === 401);
  check("Jarvis API rejects a wrong token", (await jarvis("/api/jarvis/v1/health", "wrong-token-value-1234567890")).status === 401);
  check("Jarvis API is read-only (POST refused)", (await call("/api/jarvis/v1/records", { method: "POST", portal: false, body: {}, headers: { authorization: `Bearer ${jarvisToken}` } })).status === 405);

  // ---- owner sign-in ----
  const { r: loginRes, cookie } = await signIn("10.0.0.2");
  const setCookie = loginRes.headers.getSetCookie()[0] || "";
  check("Owner signs in with the configured password", loginRes.status === 200);
  check("Session cookie is HttpOnly, Secure, SameSite=Strict, API-scoped", /HttpOnly/.test(setCookie) && /Secure/.test(setCookie) && /SameSite=Strict/.test(setCookie) && /Path=\/api\/manager/.test(setCookie));
  check("Login response never echoes the password or a hash", !loginRes.text.includes(password) && !loginRes.text.includes("$2"));
  check("Writes without the portal header are refused (CSRF)", (await call("/api/manager/tasks", { method: "POST", body: { title: "x" }, cookie, portal: false })).status === 403);
  for (let i = 0; i < 5; i++) await signIn("10.0.2.2", undefined, `wrong-${i}`);
  check("Brute force: 6th attempt from one IP is blocked", (await signIn("10.0.2.2")).r.status === 429);

  // ---- public form -> records ----
  const browser = await chromium.launch();
  const visitor = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const vp = await visitor.newPage();
  const pageErrors = [];
  vp.on("pageerror", (e) => pageErrors.push(e.message));
  await vp.goto(`${BASE}/?utm_source=linkedin&utm_medium=social&utm_campaign=profile`);
  await vp.goto(`${BASE}/work/jarvis/`);
  await vp.goto(`${BASE}/contact/?type=client_work#inquiry`);
  await vp.fill("input[name=name]", "Dana Rivera");
  await vp.fill("input[name=email]", "dana@example.com");
  await vp.fill("input[name=company]", "Rivera Outfitters");
  await vp.selectOption("select[name=service]", "app");
  await vp.selectOption("select[name=budget]", "10000_25000");
  await vp.fill("textarea[name=message]", "We need a booking app for our guided trips, plus a new website.");
  await vp.waitForTimeout(2700);
  await vp.click(".inquiry button[type=submit]");
  await vp.waitForSelector("[data-inquiry-sent]:not([hidden])", { timeout: 8000 });
  check("Website form submits and confirms", true);
  check("Public pages: no script errors", pageErrors.length === 0, pageErrors.join(" | "));

  let list = (await call("/api/manager/inquiries?status=all", { cookie })).json.items;
  const dana = list.find((i) => i.contactName === "Dana Rivera");
  check("Form submission created one inquiry record", list.length === 1 && Boolean(dana));
  check("Inquiry has type, requested service, status, owner, timestamps", dana?.type === "client_work" && dana?.service === "app" && dana?.status === "new" && dana?.owner === "owner" && dana?.createdAt && dana?.updatedAt);
  check("Source/UTM captured automatically (LinkedIn)", dana?.source === "linkedin" && dana?.attribution?.first?.utm_source === "linkedin");
  check("A Reply follow-up was scheduled automatically", Boolean(dana?.nextFollowUpAt));

  // duplicates
  const idem = "test-retry-key-0123456789abcdef";
  const body = { type: "employment", name: "Riley Chen", email: "riley@talent.example", company: "Northwind", message: "We have a Product Designer role open.", idem };
  await inquiry(body, "10.1.0.2");
  await inquiry(body, "10.1.0.2");
  await inquiry({ ...body, idem: undefined }, "10.1.0.3");
  list = (await call("/api/manager/inquiries?status=all", { cookie })).json.items;
  check("Retries never duplicate (same key twice, then same email + message)", list.filter((i) => i.contactName === "Riley Chen").length === 1);
  check("Legacy form values still work (job -> employment)", (await inquiry({ type: "job", name: "Sam Ortiz", email: "sam@example.com", message: "Contract role available next month." }, "10.1.0.4")).status === 200);
  check("Bot traps store nothing", (await inquiry({ type: "client_work", name: "Bot", email: "bot@example.com", message: "spam spam spam spam", website_url: "x" }, "10.1.0.5")).status === 200 && (await call("/api/manager/inquiries?status=all", { cookie })).json.items.length === 3);
  check("Validation rejects a missing email", (await inquiry({ type: "client_work", name: "No Email", message: "hello there friend" }, "10.1.0.6")).status === 400);
  check("Foreign-site submissions are rejected", (await call("/api/inquiry", { method: "POST", portal: false, headers: { origin: "https://evil.example" }, body: { type: "general", name: "E", email: "e@example.com", message: "hello from elsewhere" } })).status === 403);
  let last;
  for (let i = 0; i < 6; i++) last = await inquiry({ type: "general", name: `[TEST] Q${i}`, email: `q${i}@example.com`, message: `a quick question number ${i}` }, "10.1.0.9");
  check("Rate limit: 6th inquiry from one IP in an hour is blocked", last.status === 429);
  await inquiry({ type: "client_work", name: "[TEST] Fake Client", email: "fake@example.com", message: "labeled test inquiry for exclusion" }, "10.1.0.10");

  // ---- workflow: inquiry -> client opportunity -> project -> payment ----
  await call("/api/manager/interactions", { method: "POST", cookie, body: { entity: "inquiry", id: dana.id, type: "email", direction: "outbound", note: "Thanks Dana, free Thursday?" } });
  let inq = (await call(`/api/manager/inquiries/${dana.id}`, { cookie })).json;
  check("Logging a reply marks the inquiry Contacted and closes its Reply task", inq.inquiry.status === "contacted" && inq.tasks.every((t) => t.kind !== "reply" || t.status === "done") && Boolean(inq.inquiry.firstResponseAt));
  const conv = await call(`/api/manager/inquiries/${dana.id}/convert`, { method: "POST", cookie, body: { to: "client", title: "Rivera Outfitters booking app", quote: 18000 } });
  check("Inquiry converts to a client opportunity with a quote", conv.status === 201 && conv.json.opportunity.quote?.amount === 18000 && conv.json.opportunity.inquiryId === dana.id);
  const oppId = conv.json.opportunity.id;
  check("Converting twice is refused", (await call(`/api/manager/inquiries/${dana.id}/convert`, { method: "POST", cookie, body: { to: "client" } })).status === 409);
  await call(`/api/manager/opportunities/${oppId}/stage`, { method: "POST", cookie, body: { stage: "proposal" } });
  check("Lost requires a reason", (await call(`/api/manager/opportunities/${oppId}/stage`, { method: "POST", cookie, body: { stage: "lost" } })).status === 400);
  await call(`/api/manager/opportunities/${oppId}/stage`, { method: "POST", cookie, body: { stage: "won" } });
  const second = await call("/api/manager/opportunities", { method: "POST", cookie, body: { type: "client", title: "Brand refresh for Juniper Cafe", source: "referral", quote: 4500, newContact: { name: "Ava Juniper" } } });
  check("Manual client opportunity is labeled as a manual entry", second.json.opportunity.channel === "manual");

  // collaborator account
  const created = await call("/api/manager/users", { method: "POST", cookie, body: { name: "Jordan Lee", username: "jordan", role: "staff" } });
  check("Owner creates a collaborator; temp password shown once", created.status === 201 && /^[a-z2-9]{4}(-[a-z2-9]{4}){3}$/.test(created.json.temporaryPassword));
  const jordanId = created.json.user.id;
  const prj = await call(`/api/manager/opportunities/${oppId}/project`, { method: "POST", cookie, body: { title: "Rivera booking app", deadline: new Date(Date.now() + 20 * 86400000).toISOString(), value: 18000 } });
  check("Won client work becomes a project with its recorded value", prj.status === 201 && prj.json.project.value?.amount === 18000);
  const prjId = prj.json.project.id;
  check("A second project for the same opportunity is refused", (await call(`/api/manager/opportunities/${oppId}/project`, { method: "POST", cookie, body: {} })).status === 409);
  const d1 = (await call(`/api/manager/projects/${prjId}/deliverables`, { method: "POST", cookie, body: { title: "Booking flow screens", assigneeId: jordanId, dueAt: new Date(Date.now() + 7 * 86400000).toISOString() } })).json.deliverable;
  const d2 = (await call(`/api/manager/projects/${prjId}/deliverables`, { method: "POST", cookie, body: { title: "Payments integration", dueAt: new Date(Date.now() + 14 * 86400000).toISOString() } })).json.deliverable;
  await call(`/api/manager/projects/${prjId}/payments`, { method: "POST", cookie, body: { amount: 6000, method: "bank" } });
  const other = await call("/api/manager/projects", { method: "POST", cookie, body: { title: "Juniper menu boards", clientName: "Ava Juniper", value: 2000 } });
  const otherId = other.json.project.id;

  // employment
  const job = await call("/api/manager/opportunities", { method: "POST", cookie, body: { type: "employment", role: "Senior Product Designer", organization: "Acme", title: "Senior Product Designer at Acme", stage: "applied", applicationUrl: "https://acme.example/jobs/1", source: "outbound", nextAction: "Follow up Friday" } });
  check("Employment opportunity tracks employer, role, application link, next action", job.json.opportunity.type === "employment" && job.json.opportunity.applicationUrl && job.json.opportunity.nextAction && job.json.opportunity.quote === null);
  await call(`/api/manager/opportunities/${job.json.opportunity.id}/stage`, { method: "POST", cookie, body: { stage: "interviewing" } });
  await call("/api/manager/tasks", { method: "POST", cookie, body: { title: "Interview: Acme design panel", kind: "interview", relatedType: "opportunity", relatedId: job.json.opportunity.id, dueAt: new Date(Date.now() + 26 * 3600e3).toISOString() } });
  await call("/api/manager/tasks", { method: "POST", cookie, body: { title: "Send Juniper the moodboard", kind: "follow_up", relatedType: "project", relatedId: otherId, dueAt: new Date(Date.now() - 30 * 3600e3).toISOString() } });
  const jt = await call("/api/manager/tasks", { method: "POST", cookie, body: { title: "Export icon set", kind: "other", assigneeId: jordanId, dueAt: new Date(Date.now() + 2 * 86400000).toISOString() } });

  // ---- dashboard calculations ----
  const ov = (await call("/api/manager/overview?period=30d", { cookie })).json;
  const M = ov.metrics;
  check("Dashboard: new client inquiries = 1 (test and spam excluded)", M.new_client_inquiries.value === 1, JSON.stringify(M.new_client_inquiries));
  check("Dashboard: quoted pipeline = open client quotes only ($4,500)", M.quoted_pipeline.value.amount === 4500 && M.quoted_pipeline.value.currency === "USD");
  check("Dashboard: cash collected = $6,000 (manual entries)", M.cash_collected.value.amount === 6000 && M.cash_collected.source === "manual_entry");
  check("Dashboard: unpaid balances = $12,000 + $2,000", M.unpaid_balances.value.amount === 14000 && M.unpaid_balances.projects === 2);
  check("Dashboard: active projects = 2", M.active_projects.value === 2);
  check("Dashboard: employment kept separate (1 open, 1 interviewing, 1 interview scheduled)", M.open_employment.value === 1 && M.open_employment.interviewing === 1 && M.open_employment.interviews_scheduled === 1);
  check("Dashboard: follow-ups due counts the overdue one", M.follow_ups_due.value >= 1 && M.follow_ups_due.overdue >= 1);
  check("Dashboard: client funnel follows the inquiry to won", JSON.stringify(ov.funnels.client.map((x) => x.count)) === "[1,1,1,1]", JSON.stringify(ov.funnels.client));
  check("Dashboard: attention lists the overdue follow-up", ov.attention.some((a) => a.key === "task_overdue"));

  // ---- staff (collaborator) permissions ----
  const { r: jr, cookie: jc } = await signIn("10.0.6.1", "jordan", created.json.temporaryPassword);
  check("Collaborator signs in with their own username", jr.status === 200 && jr.json.user.role === "staff");
  const sov = (await call("/api/manager/overview", { cookie: jc })).json;
  check("Collaborator overview shows only their assigned project", sov.role === "staff" && sov.projects.length === 1 && sov.projects[0].id === prjId);
  check("Collaborator sees only their deliverables, no money", sov.projects[0].deliverables.length === 1 && sov.projects[0].deliverables[0].id === d1.id && !("money" in sov.projects[0]) && !("payments" in sov.projects[0]));
  check("Collaborator: other projects are hidden (404)", (await call(`/api/manager/projects/${otherId}`, { cookie: jc })).status === 404);
  for (const p of ["inquiries", "opportunities", "contacts", "users", "export", `inquiries/${dana.id}`]) {
    if ((await call(`/api/manager/${p}`, { cookie: jc })).status !== 403) check(`Collaborator blocked: ${p}`, false);
  }
  check("Collaborator: inquiries, opportunities, contacts, team, export all forbidden (403)", true);
  check("Collaborator updates their own deliverable with a note", (await call(`/api/manager/projects/${prjId}/deliverables/${d1.id}`, { method: "PATCH", cookie: jc, body: { status: "done", update: "Screens uploaded to the shared folder." } })).status === 200);
  check("Collaborator can't touch someone else's deliverable", (await call(`/api/manager/projects/${prjId}/deliverables/${d2.id}`, { method: "PATCH", cookie: jc, body: { status: "done" } })).status === 403);
  check("Collaborator can't rename or reassign their deliverable", (await call(`/api/manager/projects/${prjId}/deliverables/${d1.id}`, { method: "PATCH", cookie: jc, body: { title: "Renamed", assigneeId: null } })).json.deliverable.title === "Booking flow screens");
  check("Collaborator can't record payments", (await call(`/api/manager/projects/${prjId}/payments`, { method: "POST", cookie: jc, body: { amount: 1 } })).status === 403);
  check("Collaborator completes their own task", (await call(`/api/manager/tasks/${jt.json.task.id}`, { method: "PATCH", cookie: jc, body: { action: "complete" } })).status === 200);
  const ownersTask = (await call("/api/manager/tasks", { cookie })).json.items.find((t) => t.assigneeId === "owner");
  check("Collaborator can't complete Sean's tasks", (await call(`/api/manager/tasks/${ownersTask.id}`, { method: "PATCH", cookie: jc, body: { action: "complete" } })).status === 403);
  check("Collaborator calendar holds only their work", (await call("/api/manager/calendar", { cookie: jc })).json.items.every((i) => i.assigneeId === jordanId || i.source === "project"));
  check("A staff session can't read the Jarvis API", (await call("/api/jarvis/v1/summary", { portal: false, cookie: jc })).status === 401);
  check("Manager sees the collaborator's update", (await call(`/api/manager/projects/${prjId}`, { cookie })).json.project.deliverables.find((d) => d.id === d1.id).updates.length === 1);

  // ---- persistence: restart the server process, then reload ----
  await stopServer();
  await startServer(STORE);
  const { cookie: c3 } = await signIn("10.0.7.1");
  const after = (await call("/api/manager/overview?period=30d", { cookie: c3 })).json.metrics;
  check("Records persist across a full server restart", after.cash_collected.value.amount === 6000 && after.active_projects.value === 2);

  // ---- Jarvis API: envelope, data, filters, pagination ----
  const health = await jarvis("/api/jarvis/v1/health");
  const env = health.json;
  check("Jarvis health: envelope fields present", health.status === 200 && ["schema_version", "business_id", "business_slug", "source", "generated_at", "data", "availability"].every((k) => k in env) && env.business_id === "sean-despain");
  check("Jarvis health: entities, counts, timezone", env.data.supported_entities.join() === "inquiry,opportunity,project,deliverable,payment,task" && env.data.reporting_timezone === "America/Denver");
  const sum = (await jarvis(`/api/jarvis/v1/summary?from=${ymd(-29)}&to=${ymd(0)}`)).json;
  check("Jarvis summary matches the portal's saved data", sum.data.common.leads.client_work === after.new_client_inquiries.value && sum.data.common.cash_collected.amount === 6000 && sum.data.common.unpaid_balances.amount === 14000 && sum.data.common.quoted_value.open_pipeline.amount === 4500);
  check("Jarvis summary: money carries currency and source; unavailable sources are null", sum.data.common.cash_collected.currency === "USD" && sum.data.common.cash_collected.source === "manual_entry" && sum.data.common.verified_payments === null && sum.availability.payments_provider === "unavailable");
  check("Jarvis summary: employment kept out of sales", sum.data.business_specific.employment.open_opportunities === 1 && sum.data.common.confirmed_work.projects_started === 2);
  check("Jarvis summary: explicit period with timezone", sum.data.period.timezone === "America/Denver" && sum.data.period.from === ymd(-29) && /Z$/.test(sum.data.period.from_utc));
  const past = (await jarvis(`/api/jarvis/v1/summary?from=${ymd(-60)}&to=${ymd(-31)}`)).json;
  check("Date filter: an earlier window excludes today's records", past.data.common.leads.new_inquiries === 0 && past.data.common.cash_collected.amount === 0);
  check("Date filter: bad ranges are rejected", (await jarvis(`/api/jarvis/v1/summary?from=${ymd(0)}&to=${ymd(-5)}`)).status === 400);
  const all = (await jarvis("/api/jarvis/v1/records?entity=inquiry&limit=500")).json.data.records;
  check("Records exclude labeled test data", all.every((r) => !/\[TEST\]/.test(r.contact_name || "")) && all.length === 3);
  check("Records carry id, entity, business_id, created_at, updated_at, archive marker", all.every((r) => r.id && r.entity === "inquiry" && r.business_id === "sean-despain" && r.created_at && r.updated_at && "archived" in r));
  check("Records never include emails or message text", !/@example\.|booking app for our guided trips/.test(JSON.stringify(all)));
  let cursor = null;
  const seen = [];
  let pages = 0;
  do {
    const res = (await jarvis(`/api/jarvis/v1/records?entity=task&limit=2${cursor ? `&cursor=${cursor}` : ""}`)).json;
    seen.push(...res.data.records.map((r) => r.id));
    cursor = res.next_cursor;
    pages++;
  } while (cursor && pages < 20);
  const totalTasks = (await jarvis("/api/jarvis/v1/records?entity=task&limit=500")).json.data.records.length;
  check("Pagination: cursor walks every record once", seen.length === totalTasks && new Set(seen).size === seen.length && pages > 1, `${seen.length}/${totalTasks} in ${pages} pages`);
  check("updated_since in the future returns nothing", (await jarvis(`/api/jarvis/v1/records?entity=project&updated_since=${new Date(Date.now() + 3600e3).toISOString()}`)).json.data.records.length === 0);
  await call(`/api/manager/projects/${otherId}`, { method: "PATCH", cookie: c3, body: { archived: true } });
  const changed = (await jarvis(`/api/jarvis/v1/records?entity=project&updated_since=${new Date(Date.now() - 60e3).toISOString()}`)).json.data.records;
  check("Archiving shows up as an archive marker in updated_since sync", changed.some((r) => r.id === otherId && r.archived === true && r.archived_at));
  const payRecs = (await jarvis("/api/jarvis/v1/records?entity=payment")).json.data.records;
  check("Payments export with currency and manual-entry label", payRecs.length === 1 && payRecs[0].amount.currency === "USD" && payRecs[0].source === "manual_entry" && payRecs[0].verified_by_provider === false);
  check("Bad cursor is rejected", (await jarvis("/api/jarvis/v1/records?entity=task&cursor=garbage")).status === 400);

  // ---- deactivating a collaborator ends their access ----
  await call(`/api/manager/users/${jordanId}`, { method: "PATCH", cookie: c3, body: { active: false } });
  const { r: deadLogin } = await signIn("10.0.6.2", "jordan", created.json.temporaryPassword);
  check("Deactivated collaborator can't sign in", deadLogin.status === 401);

  // ---- portal UI ----
  const ui = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const up = await ui.newPage();
  const uiErrors = [];
  up.on("pageerror", (e) => uiErrors.push(e.message));
  up.on("console", (m) => m.type() === "error" && !/401|Failed to load resource/.test(m.text()) && uiErrors.push(m.text()));
  await up.goto(`${BASE}/manager/`);
  await up.waitForSelector(".mp-login");
  await up.fill("input[name=password]", password);
  await up.click(".mp-login button");
  await up.waitForSelector(".mp-kpi");
  check("UI: overview shows the numbers", (await up.$$(".mp-kpi")).length === 7);
  if (shots) await up.screenshot({ path: path.join(shots, "v2-desk-overview.png"), fullPage: true });
  for (const [hash, sel, name] of [
    ["#/inquiries", ".mp-row", "inquiries"],
    [`#/inquiry/${dana.id}`, ".mp-msg", "inquiry"],
    ["#/inquiries?tab=client&status=all", ".mp-opp", "client work"],
    ["#/inquiries?tab=employment", ".mp-board", "employment"],
    [`#/opportunity/${oppId}`, ".mp-stepper", "opportunity"],
    ["#/inquiries?tab=contacts", ".mp-people", "contacts"],
    ["#/projects", ".mp-opp", "projects"],
    [`#/project/${prjId}`, ".mp-dlv", "project"],
    ["#/calendar", ".mp-list", "calendar agenda"],
    ["#/calendar?view=month", ".mp-month", "calendar month"],
    ["#/settings", ".mp-facts", "settings"],
  ]) {
    await up.goto(`${BASE}/manager/${hash}`);
    const ok = await up.waitForSelector(sel, { timeout: 8000 }).then(() => true, () => false);
    check(`UI: ${name} view loads`, ok);
    if (shots && ["inquiries", "inquiry", "employment", "project", "calendar agenda", "calendar month", "settings"].includes(name)) await up.screenshot({ path: path.join(shots, `v2-desk-${name.replace(/ /g, "-")}.png`), fullPage: true });
  }
  await up.reload();
  await up.waitForSelector(".mp-dlv, .mp-month, .mp-facts", { timeout: 8000 }).catch(() => {});
  check("UI: data still there after a browser reload (3 real + 6 labeled test inquiries)", (await call("/api/manager/inquiries?status=all", { cookie: c3 })).json.items.length === 9);
  check("UI: no script errors across the portal", uiErrors.length === 0, uiErrors.join(" | "));

  const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const pp = await phone.newPage();
  await pp.goto(`${BASE}/manager/`);
  await pp.fill("input[name=password]", password);
  await pp.click(".mp-login button");
  await pp.waitForSelector(".mp-kpi");
  for (const [hash, sel, name] of [["#/overview", ".mp-kpi", "overview"], ["#/inquiries", ".mp-row", "inquiries"], [`#/project/${prjId}`, ".mp-dlv", "project"], ["#/calendar", ".mp-list", "calendar"]]) {
    await pp.goto(`${BASE}/manager/${hash}`);
    await pp.waitForSelector(sel);
    const wide = await pp.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    check(`Phone: ${name} fits the screen`, !wide);
    if (shots) await pp.screenshot({ path: path.join(shots, `v2-phone-${name}.png`), fullPage: true });
  }
  check("Phone: bottom tabs show the five areas", (await pp.$$(".mp-bottom a")).length === 5);

  // ---- public site main paths ----
  for (const p of ["/", "/about/", "/capabilities/", "/contact/", "/contact/thanks/", "/work/peace-life/", "/work/jarvis/", "/work/wip-services/", "/work/qinty/", "/work/once-upon-a-princess/", "/resume/Sean_Despain_Resume_Hybrid_ProductCreativeTech.pdf"]) {
    const res = await fetch(`${BASE}${p}`);
    if (res.status !== 200) check(`Public path ${p}`, false, String(res.status));
  }
  check("Public site main paths all return 200", true);
  await browser.close();
} catch (err) {
  check("Test run completed without crashing", false, err.stack);
} finally {
  server?.kill();
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  process.exitCode = failed.length ? 1 : 0;
}
