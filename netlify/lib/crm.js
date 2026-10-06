// CRM data layer: contacts, opportunities, tasks, and the activity history.
//
// Records are deliberately small. Anything the system can work out is
// computed (a contact's status, time in stage, response time, next follow-up)
// instead of being typed in and drifting out of date. Every meaningful change
// writes an activity event, so the history builds itself.
import { HttpError, newId, nowIso, v } from "./http.js";
import { read, update } from "./store.js";
import {
  PIPELINES, SERVICES, EMPLOYMENT, BUDGETS, TIMELINES, CONTACT_TYPES, SOURCES, HEARD_ABOUT,
  TASK_KINDS, PRIORITIES, INTERACTIONS, MILESTONES, keys, stageOf, firstStage, classifySource,
} from "./model.js";

const K = {
  contacts: "crm/contacts",
  opps: "crm/opportunities",
  tasks: "crm/tasks",
  events: (iso) => `events/${iso.slice(0, 7)}`,
};
const EMPTY = { items: {} };

export async function loadState() {
  const [contacts, opps, tasks] = await Promise.all([read(K.contacts, EMPTY), read(K.opps, EMPTY), read(K.tasks, EMPTY)]);
  return { contacts: contacts.items, opps: opps.items, tasks: tasks.items };
}

// ---- activity events ----

export async function recordEvent({ type, summary, actor, contactId = null, opportunityId = null, taskId = null, data = {}, at = null }) {
  const evt = { id: newId("evt"), type, at: at || nowIso(), actor: actor || "system", summary, contactId, opportunityId, taskId, data };
  await update(K.events(evt.at), { items: [] }, (doc) => {
    doc.items.push(evt);
    return doc;
  });
  return evt;
}

/** Newest first. Walks back month by month until it has enough. */
export async function listEvents({ limit = 50, before = null, contactId = null, opportunityId = null, since = null } = {}) {
  const out = [];
  const cursor = new Date(before || Date.now());
  const sinceMs = since ? Date.parse(since) : null;
  for (let i = 0; i < 24 && out.length < limit; i++) {
    const month = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() - i, 1)).toISOString();
    const doc = await read(K.events(month), { items: [] });
    const items = doc.items
      .filter((e) => (!before || e.at < before) && (!contactId || e.contactId === contactId) && (!opportunityId || e.opportunityId === opportunityId) && (!sinceMs || Date.parse(e.at) >= sinceMs))
      .sort((a, b) => b.at.localeCompare(a.at));
    out.push(...items);
    if (sinceMs && Date.parse(month) < sinceMs) break;
  }
  return out.slice(0, limit);
}

// ---- contacts ----

function cleanContact(input, partial = false) {
  const c = {};
  const set = (k, val) => {
    if (val !== undefined && (!partial || k in input)) c[k] = val;
  };
  set("name", v.str(input.name, "Name", { max: 120, required: !partial }));
  set("email", v.email(input.email));
  set("phone", v.str(input.phone, "Phone", { max: 40 }));
  set("company", v.str(input.company, "Company", { max: 120 }));
  set("title", v.str(input.title, "Title", { max: 120 }));
  set("type", v.oneOf(input.type, "Type", keys(CONTACT_TYPES)) || (partial ? undefined : "client"));
  set("linkedin", v.url(input.linkedin, "LinkedIn"));
  set("notes", v.str(input.notes, "Notes", { max: 4000 }));
  if (partial && "name" in input && !c.name) throw new HttpError(400, "invalid", "Name is required.");
  return c;
}

export async function createContact(input, actor, extra = {}) {
  const now = nowIso();
  const data = cleanContact(input);
  if (data.email) {
    const existing = Object.values((await read(K.contacts, EMPTY)).items).find((x) => x.email === data.email);
    if (existing) throw new HttpError(409, "duplicate", `${existing.name} already has that email.`, { id: existing.id });
  }
  const contact = { id: newId("con"), ...data, owner: actor === "website" ? "owner" : actor, createdAt: now, updatedAt: now, lastInteractionAt: null, ...extra };
  await update(K.contacts, EMPTY, (doc) => {
    doc.items[contact.id] = contact;
    return doc;
  });
  await recordEvent({ type: "contact_created", actor, contactId: contact.id, summary: `${contact.name} added` });
  return contact;
}

export async function updateContact(id, input, actor) {
  const patch = cleanContact(input, true);
  let saved;
  await update(K.contacts, EMPTY, (doc) => {
    if (!doc.items[id]) throw new HttpError(404, "not_found", "That contact doesn't exist.");
    saved = doc.items[id] = { ...doc.items[id], ...patch, updatedAt: nowIso() };
    return doc;
  });
  await recordEvent({ type: "contact_updated", actor, contactId: id, summary: `${saved.name} updated`, data: { fields: Object.keys(patch) } });
  return saved;
}

async function touchContact(id, at) {
  if (!id) return;
  await update(K.contacts, EMPTY, (doc) => {
    const c = doc.items[id];
    if (!c) return undefined;
    if (c.lastInteractionAt && c.lastInteractionAt >= at) return undefined;
    c.lastInteractionAt = at;
    return doc;
  });
}

// ---- opportunities ----

function cleanOpportunity(input, kind, partial = false) {
  const o = {};
  const has = (k) => !partial || k in input;
  if (has("title")) o.title = v.str(input.title, "Title", { max: 160, required: !partial });
  if (has("company")) o.company = v.str(input.company, "Company", { max: 120 });
  if (has("source")) o.source = v.oneOf(input.source, "Source", keys(SOURCES)) || (partial ? undefined : "unknown");
  if (has("direction")) o.direction = v.oneOf(input.direction, "Direction", ["inbound", "outbound"]) || (partial ? undefined : "inbound");
  if (has("expectedCloseAt")) o.expectedCloseAt = v.date(input.expectedCloseAt, "Expected date");
  if (has("summary")) o.summary = v.str(input.summary, "Summary", { max: 2000 });
  if (kind === "project") {
    if (has("service")) o.service = v.oneOf(input.service, "Service", keys(SERVICES));
    if (has("dueAt")) o.dueAt = v.date(input.dueAt, "Due date");
  } else {
    if (has("roleTitle")) o.roleTitle = v.str(input.roleTitle, "Role", { max: 120 });
    if (has("employment")) o.employment = v.oneOf(input.employment, "Employment", keys(EMPLOYMENT));
    if (has("link")) o.link = v.url(input.link, "Posting link");
  }
  if (has("estimate")) o.estimate = v.money(input.estimate, "Estimated value");
  if (has("final")) o.final = v.money(input.final, "Agreed value");
  return o;
}

function contactName(state, id) {
  return state?.contacts?.[id]?.name || null;
}

export async function createOpportunity(input, actor, { attribution = null, budget = null, timeline = null, needsReply = false } = {}) {
  const kind = v.oneOf(input.kind, "Kind", Object.keys(PIPELINES), { required: true });
  const clean = cleanOpportunity(input, kind);
  const contactId = input.contactId ? v.str(input.contactId, "Contact", { max: 40 }) : null;
  const contacts = (await read(K.contacts, EMPTY)).items;
  if (contactId && !contacts[contactId]) throw new HttpError(400, "invalid", "That contact doesn't exist.");
  const stage = input.stage ? v.oneOf(input.stage, "Stage", PIPELINES[kind].stages.map((s) => s.key)) : firstStage(kind);
  const now = nowIso();
  const { estimate, final, ...fields } = clean;
  const opp = {
    id: newId("opp"),
    kind,
    ...fields,
    contactId,
    stage,
    stageEnteredAt: now,
    stageHistory: [{ stage, at: now }],
    owner: actor === "website" ? "owner" : actor,
    value: { estimate: estimate ?? null, final: final ?? null, basis: estimate != null ? "manual" : null },
    payments: [],
    budget,
    timeline,
    attribution,
    lossReason: null,
    wonAt: null,
    closedAt: null,
    createdAt: now,
    updatedAt: now,
  };
  if (budget) {
    const mid = BUDGETS.find(([k]) => k === budget)?.[2] ?? null;
    if (mid != null && opp.value.estimate == null) opp.value = { ...opp.value, estimate: mid, basis: "inquiry_budget" };
  }
  await update(K.opps, EMPTY, (doc) => {
    doc.items[opp.id] = opp;
    return doc;
  });
  const who = contactName({ contacts }, contactId);
  await recordEvent({ type: "opportunity_created", actor, opportunityId: opp.id, contactId, summary: `${opp.title}${who ? ` (${who})` : ""}`, data: { kind, source: opp.source, direction: opp.direction } });
  if (needsReply) {
    await createTask({ title: `Reply to ${who || opp.title}`, kind: "reply", priority: "high", relatedType: "opportunity", relatedId: opp.id, dueAt: new Date(Date.now() + 24 * 3600e3).toISOString() }, actor === "website" ? "system" : actor);
  }
  return opp;
}

export async function updateOpportunity(id, input, actor, { canFinance = true } = {}) {
  let saved;
  let changed = [];
  await update(K.opps, EMPTY, (doc) => {
    const opp = doc.items[id];
    if (!opp) throw new HttpError(404, "not_found", "That opportunity doesn't exist.");
    const patch = cleanOpportunity(input, opp.kind, true);
    if (("estimate" in patch || "final" in patch) && !canFinance) throw new HttpError(403, "forbidden", "Your account can't change values.");
    const { estimate, final, ...fields } = patch;
    const next = { ...opp, ...fields, updatedAt: nowIso() };
    if ("contactId" in input) next.contactId = input.contactId || null;
    if (estimate !== undefined) next.value = { ...opp.value, estimate, basis: "manual" };
    if (final !== undefined) next.value = { ...next.value, final };
    changed = Object.keys(patch);
    saved = doc.items[id] = next;
    return doc;
  });
  await recordEvent({ type: "opportunity_updated", actor, opportunityId: id, contactId: saved.contactId, summary: `${saved.title} updated`, data: { fields: changed } });
  return saved;
}

export async function changeStage(id, { stage, lossReason = null, note = null }, actor) {
  let before;
  let saved;
  await update(K.opps, EMPTY, (doc) => {
    const opp = doc.items[id];
    if (!opp) throw new HttpError(404, "not_found", "That opportunity doesn't exist.");
    const target = stageOf(opp.kind, stage);
    if (!target) throw new HttpError(400, "invalid", "That stage doesn't exist for this pipeline.");
    if (opp.stage === stage) return undefined;
    if (target.type === "lost" && !PIPELINES[opp.kind].lossReasons.some(([k]) => k === lossReason)) {
      throw new HttpError(400, "invalid", "Pick why it didn't move forward.", { field: "lossReason" });
    }
    const now = nowIso();
    before = opp.stage;
    const next = { ...opp, stage, stageEnteredAt: now, stageHistory: [...opp.stageHistory, { stage, at: now }], updatedAt: now };
    if (target.type === "won" && !opp.wonAt) next.wonAt = now;
    if (target.type === "lost") {
      next.lossReason = lossReason;
      next.closedAt = now;
    } else {
      next.lossReason = null;
      if (target.type === "open") {
        next.closedAt = null;
        next.wonAt = null;
      }
    }
    if (opp.kind === "project" && stage === "delivered") next.closedAt = now;
    if (opp.kind === "job" && target.type === "won") next.closedAt = now;
    saved = doc.items[id] = next;
    return doc;
  });
  if (!saved) return null;
  const s = stageOf(saved.kind, stage);
  await recordEvent({ type: "stage_changed", actor, opportunityId: id, contactId: saved.contactId, summary: `${saved.title}: ${stageOf(saved.kind, before)?.label} → ${s.label}`, data: { from: before, to: stage, lossReason } });
  const milestone = MILESTONES[`${saved.kind}:${stage}`] || (s.type === "won" && !stagesOfWonBefore(saved, before) ? "opportunity_won" : s.type === "lost" ? "opportunity_lost" : null);
  if (milestone) await recordEvent({ type: milestone, actor, opportunityId: id, contactId: saved.contactId, summary: saved.title, data: { stage, lossReason } });
  if (note) await logInteraction({ opportunityId: id, type: "note", note }, actor);
  // moving a new inquiry forward counts as having replied
  if (before === firstStage(saved.kind)) await completeReplyTasks({ opportunityId: id, contactId: saved.contactId }, actor);
  await touchContact(saved.contactId, nowIso());
  return saved;
}

function stagesOfWonBefore(opp, before) {
  return stageOf(opp.kind, before)?.type === "won";
}

export async function recordPayment(id, { type, amount, note, at }, actor) {
  const kind = v.oneOf(type, "Type", ["invoiced", "received"], { required: true });
  const amt = v.money(amount, "Amount");
  if (!amt) throw new HttpError(400, "invalid", "Enter an amount.", { field: "amount" });
  const when = v.date(at, "Date") || nowIso();
  let saved;
  await update(K.opps, EMPTY, (doc) => {
    const opp = doc.items[id];
    if (!opp) throw new HttpError(404, "not_found", "That opportunity doesn't exist.");
    if (opp.kind !== "project") throw new HttpError(400, "invalid", "Payments only apply to client projects.");
    opp.payments = [...opp.payments, { id: newId("pay"), type: kind, amount: amt, at: when, note: v.str(note, "Note", { max: 300 }) }];
    opp.updatedAt = nowIso();
    saved = opp;
    return doc;
  });
  await recordEvent({ type: "payment_recorded", actor, opportunityId: id, contactId: saved.contactId, summary: `${saved.title}: ${kind === "received" ? "received" : "invoiced"} $${amt.toLocaleString("en-US")}`, data: { type: kind, amount: amt } });
  return saved;
}

// ---- interactions and notes ----

export async function logInteraction({ opportunityId = null, contactId = null, type, direction = "outbound", note = null, at = null }, actor) {
  const kind = v.oneOf(type, "Type", keys(INTERACTIONS), { required: true });
  const dir = kind === "note" ? null : v.oneOf(direction, "Direction", ["inbound", "outbound"]) || "outbound";
  const text = v.str(note, "Note", { max: 4000, required: kind === "note" });
  const when = v.date(at, "Date") || nowIso();
  if (opportunityId) {
    const opp = (await read(K.opps, EMPTY)).items[opportunityId];
    if (!opp) throw new HttpError(404, "not_found", "That opportunity doesn't exist.");
    contactId = contactId || opp.contactId;
  } else if (contactId) {
    if (!(await read(K.contacts, EMPTY)).items[contactId]) throw new HttpError(404, "not_found", "That contact doesn't exist.");
  } else {
    throw new HttpError(400, "invalid", "Choose a contact or opportunity.");
  }
  const label = INTERACTIONS.find(([k]) => k === kind)[1];
  const evt = await recordEvent({
    type: kind === "note" ? "note_added" : "interaction_logged",
    actor, opportunityId, contactId, at: when,
    summary: kind === "note" ? "Note" : `${label} ${dir === "inbound" ? "from them" : "sent"}`,
    data: { interaction: kind, direction: dir, note: text },
  });
  if (kind !== "note") {
    await touchContact(contactId, when);
    if (dir === "outbound") await completeReplyTasks({ opportunityId, contactId }, actor);
  }
  return evt;
}

// ---- tasks ----

function cleanTask(input, partial = false) {
  const t = {};
  const has = (k) => !partial || k in input;
  if (has("title")) t.title = v.str(input.title, "Task", { max: 200, required: !partial });
  if (has("kind")) t.kind = v.oneOf(input.kind, "Kind", keys(TASK_KINDS)) || (partial ? undefined : "follow_up");
  if (has("priority")) t.priority = v.oneOf(input.priority, "Priority", keys(PRIORITIES)) || (partial ? undefined : "normal");
  if (has("dueAt")) t.dueAt = v.date(input.dueAt, "Due date");
  if (has("relatedType")) t.relatedType = v.oneOf(input.relatedType, "Related to", ["opportunity", "contact"]);
  if (has("relatedId")) t.relatedId = v.str(input.relatedId, "Related record", { max: 40 });
  if (has("notes")) t.notes = v.str(input.notes, "Notes", { max: 2000 });
  return Object.fromEntries(Object.entries(t).filter(([, val]) => val !== undefined));
}

export async function createTask(input, actor, { suggested = null } = {}) {
  const data = cleanTask(input);
  const now = nowIso();
  const task = {
    id: newId("tsk"), ...data, owner: input.owner || "owner",
    status: suggested ? "suggested" : "open", suggestedBy: suggested, completedAt: null, createdAt: now, createdBy: actor,
  };
  await update(K.tasks, EMPTY, (doc) => {
    doc.items[task.id] = task;
    return doc;
  });
  const rel = await relatedIds(task);
  await recordEvent({ type: suggested ? "task_suggested" : "task_created", actor, taskId: task.id, ...rel, summary: task.title });
  return task;
}

async function relatedIds(task) {
  if (task.relatedType === "opportunity") {
    const opp = (await read(K.opps, EMPTY)).items[task.relatedId];
    return { opportunityId: task.relatedId, contactId: opp?.contactId || null };
  }
  if (task.relatedType === "contact") return { contactId: task.relatedId };
  return {};
}

export async function updateTask(id, input, actor) {
  const patch = cleanTask(input, true);
  const action = input.action;
  let saved;
  let event = null;
  await update(K.tasks, EMPTY, (doc) => {
    const t = doc.items[id];
    if (!t) throw new HttpError(404, "not_found", "That task doesn't exist.");
    const next = { ...t, ...patch };
    if (action === "complete" && t.status !== "done") {
      next.status = "done";
      next.completedAt = nowIso();
      event = "task_completed";
    } else if (action === "reopen") {
      next.status = "open";
      next.completedAt = null;
    } else if (action === "approve" && t.status === "suggested") {
      next.status = "open";
      event = "suggestion_approved";
    } else if (action === "dismiss" && t.status === "suggested") {
      next.status = "dismissed";
      event = "suggestion_dismissed";
    }
    saved = doc.items[id] = next;
    return doc;
  });
  if (event) await recordEvent({ type: event, actor, taskId: id, ...(await relatedIds(saved)), summary: saved.title });
  return saved;
}

/** Logging a reply (or moving an inquiry forward) closes its "Reply" task. */
async function completeReplyTasks({ opportunityId, contactId }, actor) {
  const done = [];
  await update(K.tasks, EMPTY, (doc) => {
    let changed = false;
    for (const t of Object.values(doc.items)) {
      const match = (opportunityId && t.relatedType === "opportunity" && t.relatedId === opportunityId) || (contactId && t.relatedType === "contact" && t.relatedId === contactId);
      if (match && t.kind === "reply" && t.status === "open") {
        t.status = "done";
        t.completedAt = nowIso();
        done.push(t);
        changed = true;
      }
    }
    return changed ? doc : undefined;
  });
  for (const t of done) await recordEvent({ type: "task_completed", actor, taskId: t.id, opportunityId, contactId, summary: t.title });
}

// ---- website inquiries ----

/**
 * One website inquiry becomes: a contact (matched by email, so a returning
 * person isn't duplicated), an opportunity in the right pipeline (or none for
 * a general question), a "Reply" task due in 24 hours, and the events that
 * record it. Attribution is captured, never typed.
 */
export async function ingestInquiry(form, attribution) {
  const now = nowIso();
  const contacts = (await read(K.contacts, EMPTY)).items;
  let contact = Object.values(contacts).find((c) => c.email && c.email === form.email);
  const source = classifySource(attribution?.first || attribution?.latest || {}, form.heard);
  const latestSource = classifySource(attribution?.latest || {}, form.heard);

  if (!contact) {
    contact = await createContact(
      { name: form.name, email: form.email, company: form.company, type: form.type === "job" ? "recruiter" : "client" },
      "website",
      { firstSource: source },
    );
  }
  await touchContact(contact.id, now);

  const submitted = (opportunityId) =>
    recordEvent({
      type: "form_submitted", actor: "website", contactId: contact.id, opportunityId, at: now,
      summary: `${form.name}: ${form.type === "project" ? "project inquiry" : form.type === "job" ? "job / role inquiry" : "general question"}`,
      data: { formType: form.type, source, latestSource, message: form.message },
    });

  let opp = null;
  if (form.type === "project" || form.type === "job") {
    const titleBase = form.company || form.name;
    opp = await createOpportunity(
      {
        kind: form.type,
        title: form.type === "project" ? `Project inquiry: ${titleBase}` : `Role: ${titleBase}`,
        company: form.company,
        contactId: contact.id,
        source,
        direction: "inbound",
        summary: form.message,
      },
      "website",
      { attribution: { ...attribution, latestSource }, budget: form.budget, timeline: form.timeline, needsReply: true },
    );
    await submitted(opp.id);
  } else {
    await submitted(null);
    await createTask({ title: `Reply to ${form.name}`, kind: "reply", priority: "high", relatedType: "contact", relatedId: contact.id, dueAt: new Date(Date.now() + 24 * 3600e3).toISOString(), notes: form.message }, "system");
  }
  return { contact, opportunity: opp };
}

export const enums = { SOURCES, HEARD_ABOUT, BUDGETS, TIMELINES };
