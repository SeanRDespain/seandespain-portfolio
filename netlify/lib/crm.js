// Operational records for seandespain.com and the rules that change them.
//
// Collections (Netlify Blobs, server-side only):
//   crm/contacts       people (private contact details stay here)
//   crm/inquiries      website form submissions and manual inquiry entries
//   crm/opportunities  client work and employment, kept as separate types
//   crm/projects       won client work: deliverables, deadline, collaborator,
//                      recorded value, manual payment entries
//   crm/tasks          follow-ups, replies, interviews, client appointments
//   events/YYYY-MM     history shown on each record
//
// Every record has a stable id, createdAt, updatedAt, and archivedAt (an
// archive marker instead of deleting). Records named "[TEST] ..." carry
// isTest and are excluded from every report and from the Jarvis API.
import { createHash } from "node:crypto";
import { HttpError, newId, nowIso, v } from "./http.js";
import { read, write, update } from "./store.js";
import {
  BUSINESS, INQUIRY_TYPES, INQUIRY_STATUSES, OPPORTUNITY_TYPES, PROJECT_STAGES, DELIVERABLE_STATUSES, SERVICES,
  EMPLOYMENT_TYPES, BUDGETS, TIMELINES, HEARD_ABOUT, CONTACT_TYPES, SOURCES, TASK_KINDS, PRIORITIES, PAYMENT_METHODS,
  INTERACTIONS, keys, stageOf, classifySource, looksLikeTest,
} from "./model.js";

const K = {
  contacts: "crm/contacts",
  inquiries: "crm/inquiries",
  opps: "crm/opportunities",
  projects: "crm/projects",
  tasks: "crm/tasks",
  events: (iso) => `events/${iso.slice(0, 7)}`,
};
const EMPTY = { items: {} };
const money = (amount) => (amount == null ? null : { amount, currency: BUSINESS.currency });

async function put(collection, record) {
  await update(collection, EMPTY, (doc) => {
    doc.items[record.id] = record;
    return doc;
  });
  return record;
}

async function patch(collection, id, fn, notFound = "That record doesn't exist.") {
  let saved;
  await update(collection, EMPTY, (doc) => {
    const current = doc.items[id];
    if (!current) throw new HttpError(404, "not_found", notFound);
    const next = fn(structuredClone(current));
    if (next === undefined) return undefined;
    next.updatedAt = nowIso();
    saved = doc.items[id] = next;
    return doc;
  });
  return saved;
}

// ---- schema migration (v1 portal records -> v2) ----

const SCHEMA_VERSION = 2;
let migrated = false;

const V1_SOURCE = { direct: "website_direct", tiktok: "other_site", event: "referral", partner: "referral", returning: "referral" };
const V1_CLIENT_STAGE = { inquiry: "discovery", conversation: "discovery", proposal: "proposal", active: "won", delivered: "won", lost: "lost" };
const V1_JOB_STAGE = { lead: "interested" };

async function ensureMigrated() {
  if (migrated) return;
  const meta = await read("meta/schema", { version: 1 });
  if (meta.version >= SCHEMA_VERSION) {
    migrated = true;
    return;
  }
  const [opps, tasks, contacts] = await Promise.all([read(K.opps, EMPTY), read(K.tasks, EMPTY), read(K.contacts, EMPTY)]);
  const now = nowIso();
  const newInquiries = {};
  const newProjects = {};
  const relink = {}; // old relatedType:relatedId -> inquiry id

  for (const o of Object.values(opps.items)) {
    if (o.type) continue; // already v2
    const type = o.kind === "job" ? "employment" : "client";
    const stageMap = type === "client" ? V1_CLIENT_STAGE : V1_JOB_STAGE;
    const quoteAmount = o.value?.final ?? o.value?.estimate ?? null;
    const firstStage = o.stageHistory?.[0]?.stage;
    const progressed = (o.stageHistory || []).length > 1;
    const next = {
      id: o.id, type, title: o.title, contactId: o.contactId || null, organization: o.company || null,
      inquiryId: null, stage: stageMap[o.stage] || o.stage, stageEnteredAt: o.stageEnteredAt,
      stageHistory: (o.stageHistory || []).map((h) => ({ stage: stageMap[h.stage] || h.stage, at: h.at })),
      owner: o.owner || "owner", source: V1_SOURCE[o.source] || o.source || "unknown", channel: o.attribution ? "inquiry" : "manual",
      service: type === "client" ? (o.service === "other" ? "not_sure" : o.service || null) : null,
      quote: type === "client" ? money(quoteAmount) : null,
      proposalSentAt: (o.stageHistory || []).find((h) => h.stage === "proposal")?.at || null,
      expectedDecisionAt: o.expectedCloseAt || null,
      role: o.roleTitle || null, employmentType: o.employment || null, applicationUrl: o.link || null,
      appliedAt: (o.stageHistory || []).find((h) => h.stage === "applied")?.at || null, nextAction: null,
      lossReason: o.lossReason || null, wonAt: o.wonAt || null, closedAt: o.closedAt || null, projectId: null,
      isTest: looksLikeTest(o.title), createdAt: o.createdAt, updatedAt: now, archivedAt: null,
    };
    if (o.attribution && o.direction === "inbound") {
      const inqId = `inq_m_${o.id.slice(4)}`;
      const replyDone = Object.values(tasks.items).find((t) => t.kind === "reply" && t.relatedType === "opportunity" && t.relatedId === o.id && t.status === "done");
      const keepAsOpportunity = progressed || !["inquiry", "lead"].includes(firstStage) || o.stage !== firstStage;
      newInquiries[inqId] = {
        id: inqId, contactId: o.contactId || null, contactName: contacts.items[o.contactId]?.name || null, organization: o.company || null,
        type: type === "client" ? "client_work" : "employment", service: next.service, budget: o.budget || null, timeline: o.timeline || null, heard: null,
        message: o.summary || null, source: classifySource(o.attribution.first || o.attribution.latest || {}, null), attribution: o.attribution, status: keepAsOpportunity ? "converted" : replyDone ? "contacted" : "new",
        owner: "owner", channel: "website_form", firstResponseAt: replyDone?.completedAt || null,
        convertedTo: keepAsOpportunity ? { entity: "opportunity", id: o.id } : null, fingerprint: null,
        isTest: looksLikeTest(contacts.items[o.contactId]?.name, o.title), createdAt: o.createdAt, updatedAt: now, archivedAt: null,
      };
      relink[`opportunity:${o.id}`] = inqId;
      if (keepAsOpportunity) next.inquiryId = inqId;
      else Object.assign(next, { archivedAt: now, archiveReason: "migrated_to_inquiry" });
    }
    if (type === "client" && ["active", "delivered"].includes(o.stage)) {
      const prjId = `prj_m_${o.id.slice(4)}`;
      newProjects[prjId] = {
        id: prjId, title: o.title, opportunityId: o.id, contactId: o.contactId || null, clientName: contacts.items[o.contactId]?.name || null,
        organization: o.company || null, stage: o.stage === "delivered" ? "delivered" : "in_progress", startAt: o.wonAt || null, deadline: o.dueAt || null,
        assigneeId: null, value: money(quoteAmount), deliverables: [],
        payments: (o.payments || []).filter((p) => p.type === "received").map((p) => ({ id: p.id, amount: p.amount, currency: BUSINESS.currency, receivedAt: p.at, method: "other", source: "manual_entry", note: p.note || null, createdAt: p.at, recordedBy: "owner" })),
        legacyInvoiced: (o.payments || []).filter((p) => p.type === "invoiced"),
        isTest: next.isTest, createdAt: o.wonAt || o.createdAt, updatedAt: now, archivedAt: null,
      };
      next.projectId = prjId;
    }
    opps.items[o.id] = next;
  }

  // general questions from the v1 form had no opportunity: rebuild them from their events
  for (let i = 0; i < 6; i++) {
    const month = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth() - i, 1)).toISOString();
    for (const e of (await read(K.events(month), { items: [] })).items) {
      if (e.type !== "form_submitted" || e.data?.formType !== "other" || e.opportunityId) continue;
      const inqId = `inq_m_${e.id.slice(4)}`;
      const replyDone = Object.values(tasks.items).find((t) => t.kind === "reply" && t.relatedType === "contact" && t.relatedId === e.contactId && t.status === "done");
      newInquiries[inqId] = {
        id: inqId, contactId: e.contactId, contactName: contacts.items[e.contactId]?.name || null, organization: contacts.items[e.contactId]?.company || null,
        type: "general", service: null, budget: null, timeline: null, heard: null, message: e.data?.message || null,
        source: V1_SOURCE[e.data?.source] || e.data?.source || "website_direct", attribution: null, status: replyDone ? "contacted" : "new",
        owner: "owner", channel: "website_form", firstResponseAt: replyDone?.completedAt || null, convertedTo: null, fingerprint: null,
        isTest: looksLikeTest(contacts.items[e.contactId]?.name), createdAt: e.at, updatedAt: now, archivedAt: null,
      };
      relink[`contact:${e.contactId}`] = inqId;
    }
  }

  for (const t of Object.values(tasks.items)) {
    const target = t.kind === "reply" ? relink[`${t.relatedType}:${t.relatedId}`] : null;
    if (target) {
      t.relatedType = "inquiry";
      t.relatedId = target;
    }
    if (t.status === "suggested") t.status = "open";
    if (t.status === "dismissed") t.status = "done";
    t.assigneeId ||= "owner";
    t.updatedAt ||= t.completedAt || t.createdAt;
    t.archivedAt ||= null;
    t.isTest ??= looksLikeTest(t.title);
  }
  for (const c of Object.values(contacts.items)) {
    c.archivedAt ||= null;
    c.isTest ??= looksLikeTest(c.name);
  }

  await update(K.inquiries, EMPTY, (doc) => {
    for (const [id, inq] of Object.entries(newInquiries)) doc.items[id] ||= inq;
    return doc;
  });
  await update(K.projects, EMPTY, (doc) => {
    for (const [id, p] of Object.entries(newProjects)) doc.items[id] ||= p;
    return doc;
  });
  await write(K.opps, opps);
  await write(K.tasks, tasks);
  await write(K.contacts, contacts);
  await write("meta/schema", { version: SCHEMA_VERSION, migratedAt: now });
  migrated = true;
}

export async function loadState() {
  await ensureMigrated();
  const [contacts, inquiries, opps, projects, tasks] = await Promise.all([K.contacts, K.inquiries, K.opps, K.projects, K.tasks].map((k) => read(k, EMPTY)));
  return { contacts: contacts.items, inquiries: inquiries.items, opps: opps.items, projects: projects.items, tasks: tasks.items };
}

// ---- history events ----

export async function recordEvent({ type, summary, actor, contactId = null, inquiryId = null, opportunityId = null, projectId = null, taskId = null, data = {}, at = null }) {
  const evt = { id: newId("evt"), type, at: at || nowIso(), actor: actor || "system", summary, contactId, inquiryId, opportunityId, projectId, taskId, data };
  await update(K.events(evt.at), { items: [] }, (doc) => {
    doc.items.push(evt);
    return doc;
  });
  return evt;
}

export async function listEvents({ limit = 60, before = null, ...filter } = {}) {
  const out = [];
  const cursor = new Date(before || Date.now());
  const fields = Object.entries(filter).filter(([, val]) => val);
  for (let i = 0; i < 24 && out.length < limit; i++) {
    const month = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() - i, 1)).toISOString();
    const items = (await read(K.events(month), { items: [] })).items
      .filter((e) => (!before || e.at < before) && fields.every(([k, val]) => e[k] === val))
      .sort((a, b) => b.at.localeCompare(a.at));
    out.push(...items);
  }
  return out.slice(0, limit);
}

// ---- contacts ----

function cleanContact(input, partial) {
  const c = {};
  const has = (k) => !partial || k in input;
  if (has("name")) c.name = v.str(input.name, "Name", { max: 120, required: true });
  if (has("email")) c.email = v.email(input.email);
  if (has("phone")) c.phone = v.str(input.phone, "Phone", { max: 40 });
  if (has("company")) c.company = v.str(input.company, "Organization", { max: 120 });
  if (has("title")) c.title = v.str(input.title, "Title", { max: 120 });
  if (has("type")) c.type = v.oneOf(input.type, "Type", keys(CONTACT_TYPES)) || "client";
  if (has("linkedin")) c.linkedin = v.url(input.linkedin, "LinkedIn");
  if (has("notes")) c.notes = v.str(input.notes, "Notes", { max: 4000 });
  return c;
}

export async function createContact(input, actor, extra = {}) {
  const data = cleanContact(input, false);
  if (data.email) {
    const existing = Object.values((await read(K.contacts, EMPTY)).items).find((x) => x.email === data.email && !x.archivedAt);
    if (existing) return existing;
  }
  const now = nowIso();
  const contact = { id: newId("con"), ...data, lastInteractionAt: null, isTest: looksLikeTest(data.name), createdAt: now, updatedAt: now, archivedAt: null, ...extra };
  await put(K.contacts, contact);
  return contact;
}

export async function updateContact(id, input, actor) {
  const p = cleanContact(input, true);
  const saved = await patch(K.contacts, id, (c) => ({ ...c, ...p, isTest: looksLikeTest(p.name ?? c.name), ...(input.archived !== undefined ? { archivedAt: input.archived ? nowIso() : null } : {}) }), "That contact doesn't exist.");
  await recordEvent({ type: "record_updated", actor, contactId: id, summary: `${saved.name} updated` });
  return saved;
}

async function touchContact(id, at) {
  if (!id) return;
  await update(K.contacts, EMPTY, (doc) => {
    const c = doc.items[id];
    if (!c || (c.lastInteractionAt && c.lastInteractionAt >= at)) return undefined;
    c.lastInteractionAt = at;
    return doc;
  });
}

async function resolveContact(input, actor, fallbackType) {
  if (input.contactId) {
    const c = (await read(K.contacts, EMPTY)).items[input.contactId];
    if (!c) throw new HttpError(400, "invalid", "That contact doesn't exist.");
    return c;
  }
  if (input.newContact?.name) return createContact({ type: fallbackType, ...input.newContact }, actor);
  return null;
}

// ---- inquiries ----

const fingerprint = (email, message) => createHash("sha256").update(`${email}\n${(message || "").trim().toLowerCase()}`).digest("hex").slice(0, 32);

/**
 * A website form submission becomes one inquiry, a matched or new contact,
 * and a Reply task due in 24 hours. Retries can't duplicate it: the form's
 * idempotency key, and the same email + message within 15 minutes, both
 * return the inquiry that was already saved.
 */
export async function ingestWebsiteInquiry(form, attribution, idempotencyKey) {
  await ensureMigrated();
  const idemKey = idempotencyKey ? `idem/inquiry-${createHash("sha256").update(idempotencyKey).digest("hex").slice(0, 40)}` : null;
  if (idemKey) {
    const seen = await read(idemKey);
    if (seen) return { inquiry: (await read(K.inquiries, EMPTY)).items[seen.inquiryId] || null, duplicate: true };
  }
  const fp = fingerprint(form.email, form.message);
  const recent = Object.values((await read(K.inquiries, EMPTY)).items).find((i) => i.fingerprint === fp && Date.now() - Date.parse(i.createdAt) < 15 * 60 * 1000);
  if (recent) {
    if (idemKey) await write(idemKey, { inquiryId: recent.id, at: nowIso() });
    return { inquiry: recent, duplicate: true };
  }

  const captured = attribution && (attribution.first || attribution.latest || attribution.pages?.length) ? attribution : null;
  const source = captured ? classifySource(captured.first || captured.latest || {}, form.heard) : ["linkedin", "google_organic", "referral"].includes(form.heard) ? form.heard : "unknown";
  const contact = await createContact({ name: form.name, email: form.email, company: form.company, type: form.type === "employment" ? "recruiter" : "client" }, "website", { firstSource: source });
  const now = nowIso();
  const inquiry = {
    id: newId("inq"), contactId: contact.id, contactName: contact.name, organization: form.company || contact.company || null,
    type: form.type, service: form.service || null, budget: form.budget || null, timeline: form.timeline || null, heard: form.heard || null,
    message: form.message, source, attribution: captured,
    status: "new", owner: "owner", channel: "website_form", firstResponseAt: null, convertedTo: null,
    fingerprint: fp, isTest: looksLikeTest(form.name),
    createdAt: now, updatedAt: now, archivedAt: null,
  };
  await put(K.inquiries, inquiry);
  if (idemKey) await write(idemKey, { inquiryId: inquiry.id, at: now });
  await touchContact(contact.id, now);
  await recordEvent({ type: "inquiry_received", actor: "website", inquiryId: inquiry.id, contactId: contact.id, summary: `${contact.name}: ${INQUIRY_TYPES.find(([k]) => k === form.type)[1]}`, data: { source: inquiry.source } });
  await createTask({ title: `Reply to ${contact.name}`, kind: "reply", priority: "high", relatedType: "inquiry", relatedId: inquiry.id, dueAt: new Date(Date.now() + 24 * 3600e3).toISOString() }, "system", { isTest: inquiry.isTest });
  return { inquiry, duplicate: false };
}

/** A deliberate manager entry: something that arrived by email, LinkedIn, or a referral. */
export async function createManualInquiry(input, actor) {
  await ensureMigrated();
  const type = v.oneOf(input.type, "Type", keys(INQUIRY_TYPES), { required: true });
  const contact = await resolveContact(input, actor, type === "employment" ? "recruiter" : "client");
  if (!contact) throw new HttpError(400, "invalid", "Add who it's from.", { field: "Name" });
  const now = nowIso();
  const inquiry = {
    id: newId("inq"), contactId: contact.id, contactName: contact.name, organization: v.str(input.organization, "Organization", { max: 120 }) || contact.company || null,
    type, service: type === "client_work" ? v.oneOf(input.service, "Service", keys(SERVICES)) : null, budget: null, timeline: null, heard: null,
    message: v.str(input.message, "Details", { max: 4000 }), source: v.oneOf(input.source, "Source", keys(SOURCES)) || "unknown", attribution: null,
    status: v.oneOf(input.status, "Status", ["new", "contacted"]) || "new", owner: actor, channel: "manual", firstResponseAt: input.status === "contacted" ? now : null,
    convertedTo: null, fingerprint: null, isTest: looksLikeTest(contact.name), createdAt: now, updatedAt: now, archivedAt: null,
  };
  await put(K.inquiries, inquiry);
  await recordEvent({ type: "inquiry_added", actor, inquiryId: inquiry.id, contactId: contact.id, summary: `${contact.name} (manual entry)` });
  if (input.followUpAt) await createTask({ title: `Follow up with ${contact.name}`, kind: "follow_up", relatedType: "inquiry", relatedId: inquiry.id, dueAt: input.followUpAt }, actor);
  return inquiry;
}

export async function updateInquiry(id, input, actor) {
  const status = input.status !== undefined ? v.oneOf(input.status, "Status", ["new", "contacted", "not_a_fit", "spam", "closed"], { required: true }) : undefined;
  let before;
  const saved = await patch(K.inquiries, id, (inq) => {
    before = inq.status;
    if (status) {
      if (inq.status === "converted") throw new HttpError(400, "invalid", "This inquiry is already converted. Change its opportunity instead.");
      inq.status = status;
      if (status === "contacted" && !inq.firstResponseAt) inq.firstResponseAt = nowIso();
    }
    if ("type" in input) inq.type = v.oneOf(input.type, "Type", keys(INQUIRY_TYPES), { required: true });
    if ("service" in input) inq.service = v.oneOf(input.service, "Service", keys(SERVICES));
    if ("organization" in input) inq.organization = v.str(input.organization, "Organization", { max: 120 });
    if ("source" in input && inq.channel === "manual") inq.source = v.oneOf(input.source, "Source", keys(SOURCES)) || inq.source;
    if ("archived" in input) inq.archivedAt = input.archived ? nowIso() : null;
    return inq;
  }, "That inquiry doesn't exist.");
  if (status && status !== before) {
    await recordEvent({ type: "inquiry_status", actor, inquiryId: id, contactId: saved.contactId, summary: `${saved.contactName}: ${INQUIRY_STATUSES.find(([k]) => k === status)[1]}` });
    if (status !== "new") await completeTasksFor("inquiry", id, actor, { kinds: ["reply"] });
  }
  if ("archived" in input && input.archived) await recordEvent({ type: "record_archived", actor, inquiryId: id, summary: `Inquiry from ${saved.contactName} archived` });
  return saved;
}

export async function convertInquiry(id, input, actor) {
  const inq = (await loadState()).inquiries[id];
  if (!inq) throw new HttpError(404, "not_found", "That inquiry doesn't exist.");
  if (inq.status === "converted") throw new HttpError(409, "already_converted", "This inquiry is already converted.");
  const to = v.oneOf(input.to, "Convert to", ["client", "employment"], { required: true });
  const opp = await createOpportunity(
    {
      type: to, title: input.title || (to === "client" ? `${inq.organization || inq.contactName}: ${SERVICES.find(([k]) => k === inq.service)?.[1] || "project"}` : `${input.role || "Role"} at ${inq.organization || "employer"}`),
      contactId: inq.contactId, organization: inq.organization, source: inq.source, service: inq.service, quote: input.quote, role: input.role,
      applicationUrl: input.applicationUrl, employmentType: input.employmentType, inquiryId: id, channel: "inquiry",
    },
    actor,
  );
  await patch(K.inquiries, id, (x) => ({ ...x, status: "converted", convertedTo: { entity: "opportunity", id: opp.id }, firstResponseAt: x.firstResponseAt || nowIso() }));
  await recordEvent({ type: "inquiry_converted", actor, inquiryId: id, opportunityId: opp.id, contactId: inq.contactId, summary: `${inq.contactName} → ${opp.title}` });
  await completeTasksFor("inquiry", id, actor, { kinds: ["reply"] });
  return opp;
}

// ---- opportunities ----

function cleanOpportunity(input, type, partial, canMoney) {
  const o = {};
  const has = (k) => !partial || k in input;
  if (has("title")) o.title = v.str(input.title, "Title", { max: 160, required: true });
  if (has("organization")) o.organization = v.str(input.organization, type === "employment" ? "Employer" : "Organization", { max: 120 });
  if (has("source")) o.source = v.oneOf(input.source, "Source", keys(SOURCES)) || (partial ? undefined : "unknown");
  if (has("expectedDecisionAt")) o.expectedDecisionAt = v.date(input.expectedDecisionAt, "Expected decision");
  if (has("nextAction")) o.nextAction = v.str(input.nextAction, "Next action", { max: 200 });
  if (type === "client") {
    if (has("service")) o.service = v.oneOf(input.service, "Service", keys(SERVICES));
    if ("quote" in input && canMoney) o.quote = money(v.money(input.quote, "Quote"));
  } else {
    if (has("role")) o.role = v.str(input.role, "Role", { max: 120 });
    if (has("employmentType")) o.employmentType = v.oneOf(input.employmentType, "Type", keys(EMPLOYMENT_TYPES));
    if (has("applicationUrl")) o.applicationUrl = v.url(input.applicationUrl, "Application link");
  }
  return Object.fromEntries(Object.entries(o).filter(([, val]) => val !== undefined));
}

export async function createOpportunity(input, actor, { canMoney = true } = {}) {
  await ensureMigrated();
  const type = v.oneOf(input.type, "Type", Object.keys(OPPORTUNITY_TYPES), { required: true });
  const contact = await resolveContact(input, actor, type === "employment" ? "recruiter" : "client");
  const stages = OPPORTUNITY_TYPES[type].stages;
  const stage = input.stage ? v.oneOf(input.stage, "Stage", stages.filter((s) => s.type === "open").map((s) => s.key)) : stages[0].key;
  const now = nowIso();
  const opp = {
    id: newId("opp"), type, title: null, contactId: contact?.id || null, organization: null, inquiryId: input.inquiryId || null,
    stage, stageEnteredAt: now, stageHistory: [{ stage, at: now }], owner: actor === "website" ? "owner" : actor, source: "unknown",
    channel: input.channel || "manual", service: null, quote: null, proposalSentAt: stage === "proposal" ? now : null, expectedDecisionAt: null,
    role: null, employmentType: null, applicationUrl: null, appliedAt: stage === "applied" ? now : null, nextAction: null,
    lossReason: null, wonAt: null, closedAt: null, projectId: null, createdAt: now, updatedAt: now, archivedAt: null,
    ...cleanOpportunity(input, type, false, canMoney),
  };
  opp.organization ||= contact?.company || null;
  opp.isTest = looksLikeTest(opp.title, contact?.name);
  await put(K.opps, opp);
  await recordEvent({ type: "opportunity_created", actor, opportunityId: opp.id, contactId: opp.contactId, inquiryId: opp.inquiryId, summary: opp.title, data: { type } });
  return opp;
}

export async function updateOpportunity(id, input, actor, { canMoney }) {
  const saved = await patch(K.opps, id, (o) => {
    const p = cleanOpportunity(input, o.type, true, canMoney);
    const next = { ...o, ...p };
    if ("archived" in input) next.archivedAt = input.archived ? nowIso() : null;
    next.isTest = looksLikeTest(next.title);
    return next;
  }, "That opportunity doesn't exist.");
  await recordEvent({ type: input.archived ? "record_archived" : "record_updated", actor, opportunityId: id, contactId: saved.contactId, summary: `${saved.title} ${input.archived ? "archived" : "updated"}` });
  return saved;
}

export async function changeStage(id, { stage, lossReason = null }, actor) {
  let before;
  const saved = await patch(K.opps, id, (o) => {
    const target = stageOf(o.type, stage);
    if (!target) throw new HttpError(400, "invalid", "That stage doesn't exist for this opportunity.");
    if (o.stage === stage) return undefined;
    if (target.type === "lost" && !OPPORTUNITY_TYPES[o.type].lossReasons.some(([k]) => k === lossReason)) throw new HttpError(400, "invalid", "Pick why it didn't move forward.", { field: "lossReason" });
    const now = nowIso();
    before = o.stage;
    o.stage = stage;
    o.stageEnteredAt = now;
    o.stageHistory = [...o.stageHistory, { stage, at: now }];
    if (stage === "proposal" && !o.proposalSentAt) o.proposalSentAt = now;
    if (stage === "applied" && !o.appliedAt) o.appliedAt = now;
    if (target.type === "won") {
      o.wonAt ||= now;
      o.closedAt = now;
      o.lossReason = null;
    } else if (target.type === "lost") {
      o.lossReason = lossReason;
      o.closedAt = now;
    } else {
      o.closedAt = null;
      o.wonAt = null;
      o.lossReason = null;
    }
    return o;
  }, "That opportunity doesn't exist.");
  if (!saved) return (await read(K.opps, EMPTY)).items[id];
  const st = stageOf(saved.type, stage);
  await recordEvent({ type: "stage_changed", actor, opportunityId: id, contactId: saved.contactId, summary: `${saved.title}: ${stageOf(saved.type, before)?.label} → ${st.label}`, data: { from: before, to: stage } });
  if (st.type !== "open") await recordEvent({ type: st.type === "won" ? "opportunity_won" : "opportunity_lost", actor, opportunityId: id, contactId: saved.contactId, summary: saved.title, data: { lossReason } });
  await touchContact(saved.contactId, nowIso());
  return saved;
}

// ---- projects ----

function cleanProject(input, partial, canMoney) {
  const p = {};
  const has = (k) => !partial || k in input;
  if (has("title")) p.title = v.str(input.title, "Project", { max: 160, required: true });
  if (has("clientName")) p.clientName = v.str(input.clientName, "Client", { max: 120 });
  if (has("organization")) p.organization = v.str(input.organization, "Organization", { max: 120 });
  if (has("stage")) p.stage = v.oneOf(input.stage, "Stage", keys(PROJECT_STAGES)) || (partial ? undefined : "planning");
  if (has("startAt")) p.startAt = v.date(input.startAt, "Start date");
  if (has("deadline")) p.deadline = v.date(input.deadline, "Deadline");
  if (has("assigneeId")) p.assigneeId = v.str(input.assigneeId, "Collaborator", { max: 40 }) || null;
  if ("value" in input && canMoney) p.value = money(v.money(input.value, "Recorded value"));
  return Object.fromEntries(Object.entries(p).filter(([, val]) => val !== undefined));
}

export async function createProject(input, actor, { canMoney = true } = {}) {
  await ensureMigrated();
  let opp = null;
  if (input.opportunityId) {
    opp = (await read(K.opps, EMPTY)).items[input.opportunityId];
    if (!opp || opp.type !== "client") throw new HttpError(400, "invalid", "Projects come from client work, not employment.");
    if (opp.projectId) throw new HttpError(409, "duplicate", "This opportunity already has a project.");
  }
  const contact = opp?.contactId ? (await read(K.contacts, EMPTY)).items[opp.contactId] : await resolveContact(input, actor, "client");
  const now = nowIso();
  const project = {
    id: newId("prj"), title: null, opportunityId: opp?.id || null, contactId: contact?.id || null, clientName: contact?.name || null,
    organization: opp?.organization || contact?.company || null, stage: "planning", startAt: now, deadline: null, assigneeId: null,
    value: canMoney ? opp?.quote || null : null, deliverables: [], payments: [], createdAt: now, updatedAt: now, archivedAt: null,
  };
  for (const [k, val] of Object.entries(cleanProject({ title: opp?.title, ...input }, false, canMoney))) if (val != null) project[k] = val;
  project.startAt ||= now;
  project.isTest = looksLikeTest(project.title, project.clientName);
  await put(K.projects, project);
  if (opp) {
    await patch(K.opps, opp.id, (o) => ({ ...o, projectId: project.id }));
    if (stageOf("client", opp.stage)?.type !== "won") await changeStage(opp.id, { stage: "won" }, actor);
  }
  await recordEvent({ type: "project_created", actor, projectId: project.id, opportunityId: opp?.id || null, contactId: project.contactId, summary: project.title });
  return project;
}

export async function updateProject(id, input, actor, { canMoney }) {
  const saved = await patch(K.projects, id, (p) => {
    const next = { ...p, ...cleanProject(input, true, canMoney) };
    if ("archived" in input) next.archivedAt = input.archived ? nowIso() : null;
    next.isTest = looksLikeTest(next.title, next.clientName);
    return next;
  }, "That project doesn't exist.");
  await recordEvent({ type: input.archived ? "record_archived" : "project_updated", actor, projectId: id, contactId: saved.contactId, summary: `${saved.title} ${input.archived ? "archived" : "updated"}` });
  return saved;
}

export async function addDeliverable(projectId, input, actor) {
  const now = nowIso();
  const d = {
    id: newId("dlv"), title: v.str(input.title, "Deliverable", { max: 160, required: true }), assigneeId: v.str(input.assigneeId, "Assignee", { max: 40 }) || null,
    dueAt: v.date(input.dueAt, "Due date"), status: "todo", completedAt: null, updates: [], createdAt: now, updatedAt: now, archivedAt: null,
  };
  const saved = await patch(K.projects, projectId, (p) => ({ ...p, deliverables: [...p.deliverables, d] }), "That project doesn't exist.");
  await recordEvent({ type: "deliverable_added", actor, projectId, summary: `${saved.title}: ${d.title}` });
  return d;
}

/**
 * Managers can change anything on a deliverable. A collaborator can only
 * update the status of, and post updates on, deliverables assigned to them.
 */
export async function updateDeliverable(projectId, deliverableId, input, actor, { manager }) {
  let changed;
  let touched = false;
  const saved = await patch(K.projects, projectId, (p) => {
    const d = p.deliverables.find((x) => x.id === deliverableId);
    const before = JSON.stringify(d);
    if (!d) throw new HttpError(404, "not_found", "That deliverable doesn't exist.");
    if (!manager && d.assigneeId !== actor) throw new HttpError(403, "forbidden", "That deliverable isn't assigned to you.");
    if ("status" in input) {
      d.status = v.oneOf(input.status, "Status", keys(DELIVERABLE_STATUSES), { required: true });
      d.completedAt = d.status === "done" ? d.completedAt || nowIso() : null;
    }
    if (manager) {
      if ("title" in input) d.title = v.str(input.title, "Deliverable", { max: 160, required: true });
      if ("assigneeId" in input) d.assigneeId = v.str(input.assigneeId, "Assignee", { max: 40 }) || null;
      if ("dueAt" in input) d.dueAt = v.date(input.dueAt, "Due date");
      if ("archived" in input) d.archivedAt = input.archived ? nowIso() : null;
    }
    const text = v.str(input.update, "Update", { max: 2000 });
    if (text) d.updates = [...d.updates, { id: newId("upd"), at: nowIso(), by: actor, text }];
    changed = d;
    if (JSON.stringify(d) === before) return undefined;
    touched = true;
    d.updatedAt = nowIso();
    return p;
  }, "That project doesn't exist.");
  if (!touched) return changed;
  await recordEvent({ type: "deliverable_updated", actor, projectId, summary: `${saved.title}: ${changed.title} (${DELIVERABLE_STATUSES.find(([k]) => k === changed.status)[1]})`, data: { deliverableId, status: changed.status, update: Boolean(input.update) } });
  return changed;
}

export async function recordPayment(projectId, input, actor) {
  const amount = v.money(input.amount, "Amount");
  if (!amount) throw new HttpError(400, "invalid", "Enter an amount.", { field: "amount" });
  const now = nowIso();
  const payment = {
    id: newId("pay"), amount, currency: BUSINESS.currency, receivedAt: v.date(input.receivedAt, "Date received") || now,
    method: v.oneOf(input.method, "Method", keys(PAYMENT_METHODS)) || "other", source: "manual_entry", note: v.str(input.note, "Note", { max: 300 }), createdAt: now, recordedBy: actor,
  };
  const saved = await patch(K.projects, projectId, (p) => ({ ...p, payments: [...p.payments, payment] }), "That project doesn't exist.");
  await recordEvent({ type: "payment_recorded", actor, projectId, contactId: saved.contactId, summary: `${saved.title}: $${amount.toLocaleString("en-US")} received (manual entry)`, data: { amount } });
  return payment;
}

// ---- interactions ----

export async function logInteraction({ entity, id, type, direction = "outbound", note = null, at = null }, actor) {
  const kind = v.oneOf(type, "Type", keys(INTERACTIONS), { required: true });
  const dir = kind === "note" ? null : v.oneOf(direction, "Direction", ["inbound", "outbound"]) || "outbound";
  const text = v.str(note, "Note", { max: 4000, required: kind === "note" });
  const when = v.date(at, "Date") || nowIso();
  const state = await loadState();
  const coll = { inquiry: state.inquiries, opportunity: state.opps, project: state.projects, contact: state.contacts }[entity];
  const rec = coll?.[id];
  if (!rec) throw new HttpError(404, "not_found", "That record doesn't exist.");
  const contactId = entity === "contact" ? id : rec.contactId || null;
  const refs = { contactId, [`${entity}Id`]: id };
  const label = INTERACTIONS.find(([k]) => k === kind)[1];
  const evt = await recordEvent({ type: kind === "note" ? "note_added" : "interaction_logged", actor, at: when, ...refs, summary: kind === "note" ? "Note" : `${label} ${dir === "inbound" ? "from them" : "sent"}`, data: { interaction: kind, direction: dir, note: text } });
  if (kind !== "note") {
    await touchContact(contactId, when);
    if (dir === "outbound") {
      if (entity === "inquiry" && rec.status === "new") await updateInquiry(id, { status: "contacted" }, actor);
      await completeTasksFor(entity, id, actor, { kinds: ["reply"] });
    }
  }
  return evt;
}

// ---- tasks ----

function cleanTask(input, partial) {
  const t = {};
  const has = (k) => !partial || k in input;
  if (has("title")) t.title = v.str(input.title, "Task", { max: 200, required: true });
  if (has("kind")) t.kind = v.oneOf(input.kind, "Kind", keys(TASK_KINDS)) || "follow_up";
  if (has("priority")) t.priority = v.oneOf(input.priority, "Priority", keys(PRIORITIES)) || "normal";
  if (has("dueAt")) t.dueAt = v.date(input.dueAt, "Due date");
  if (has("relatedType")) t.relatedType = v.oneOf(input.relatedType, "Related to", ["inquiry", "opportunity", "project", "contact"]);
  if (has("relatedId")) t.relatedId = v.str(input.relatedId, "Related record", { max: 40 });
  if (has("assigneeId")) t.assigneeId = v.str(input.assigneeId, "Assignee", { max: 40 }) || "owner";
  if (has("notes")) t.notes = v.str(input.notes, "Notes", { max: 2000 });
  return Object.fromEntries(Object.entries(t).filter(([, val]) => val !== undefined));
}

export async function createTask(input, actor, extra = {}) {
  const now = nowIso();
  const task = { id: newId("tsk"), assigneeId: "owner", ...cleanTask(input, false), status: "open", completedAt: null, createdBy: actor, createdAt: now, updatedAt: now, archivedAt: null, ...extra };
  task.isTest ??= looksLikeTest(task.title);
  await put(K.tasks, task);
  await recordEvent({ type: "task_created", actor, taskId: task.id, ...(task.relatedType ? { [`${task.relatedType}Id`]: task.relatedId } : {}), summary: task.title });
  return task;
}

export async function updateTask(id, input, actor, { manager }) {
  let completed = false;
  const saved = await patch(K.tasks, id, (t) => {
    if (!manager && t.assigneeId !== actor) throw new HttpError(403, "forbidden", "That task isn't assigned to you.");
    const next = manager ? { ...t, ...cleanTask(input, true) } : { ...t };
    if (input.action === "complete" && t.status !== "done") {
      next.status = "done";
      next.completedAt = nowIso();
      completed = true;
    } else if (input.action === "reopen") {
      next.status = "open";
      next.completedAt = null;
    }
    if (manager && "archived" in input) next.archivedAt = input.archived ? nowIso() : null;
    return next;
  }, "That task doesn't exist.");
  if (completed) {
    await recordEvent({ type: "task_completed", actor, taskId: id, ...(saved.relatedType ? { [`${saved.relatedType}Id`]: saved.relatedId } : {}), summary: saved.title });
    if (saved.kind === "reply" && saved.relatedType === "inquiry") {
      const inq = (await read(K.inquiries, EMPTY)).items[saved.relatedId];
      if (inq && inq.status === "new") await updateInquiry(inq.id, { status: "contacted" }, actor);
    }
  }
  return saved;
}

async function completeTasksFor(relatedType, relatedId, actor, { kinds }) {
  const done = [];
  await update(K.tasks, EMPTY, (doc) => {
    let changed = false;
    for (const t of Object.values(doc.items)) {
      if (t.relatedType === relatedType && t.relatedId === relatedId && kinds.includes(t.kind) && t.status === "open") {
        Object.assign(t, { status: "done", completedAt: nowIso(), updatedAt: nowIso() });
        done.push(t);
        changed = true;
      }
    }
    return changed ? doc : undefined;
  });
  for (const t of done) await recordEvent({ type: "task_completed", actor, taskId: t.id, [`${relatedType}Id`]: relatedId, summary: t.title });
}

export const enums = { INQUIRY_TYPES, SERVICES, BUDGETS, TIMELINES, HEARD_ABOUT, SOURCES };
