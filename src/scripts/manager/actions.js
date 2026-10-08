// The short forms the portal is built around. Each saves through the API
// and refreshes the current view.
import { api, state, can, formSheet, toast, oppType, nextWeekday, isManager } from "./lib.js";

const refresh = () => window.dispatchEvent(new Event("portal:refresh"));
const people = () => [["owner", "Sean"], ...(state.me.users || []).filter((u) => u.id !== "owner" && u.active).map((u) => [u.id, u.name])];
const go = (hash) => (location.hash = hash);

// ---------- inquiries ----------

export function newInquiry() {
  formSheet({
    title: "Log an inquiry",
    intro: "For something that arrived outside the website form: an email, a LinkedIn message, a referral. It's labeled as a manual entry.",
    fields: [
      { name: "type", label: "What is it?", type: "radio", options: state.config.inquiryTypes, value: "client_work", required: true },
      [
        { name: "name", label: "Their name", required: true, max: 120 },
        { name: "email", label: "Email", type: "email", optional: true, max: 254 },
      ],
      [
        { name: "organization", label: "Organization / employer", optional: true, max: 120 },
        { name: "service", label: "Service they asked about", type: "select", options: state.config.services, optional: true },
      ],
      [
        { name: "source", label: "Where it came from", type: "select", options: state.config.sources, value: "linkedin", required: true },
        { name: "status", label: "Have you replied?", type: "select", options: [["new", "Not yet"], ["contacted", "Yes"]], value: "new", required: true },
      ],
      { name: "message", label: "What they asked for", type: "textarea", optional: true, rows: 3 },
      { name: "followUpAt", label: "Follow up on", type: "datetime", optional: true },
    ],
    submitLabel: "Save inquiry",
    onSubmit: async (v) => {
      const { inquiry } = await api("inquiries", { method: "POST", body: { type: v.type, source: v.source, status: v.status, service: v.service, organization: v.organization, message: v.message, followUpAt: v.followUpAt || null, newContact: { name: v.name, email: v.email || undefined, company: v.organization || undefined } } });
      toast("Inquiry saved");
      go(`#/inquiry/${inquiry.id}`);
    },
  });
}

export async function setInquiryStatus(inq, status) {
  try {
    await api(`inquiries/${inq.id}`, { method: "PATCH", body: { status } });
    toast("Updated");
    refresh();
  } catch (e) {
    toast(e.message, "error");
  }
}

export function convertInquiry(inq, to) {
  const client = to === "client";
  formSheet({
    title: client ? "Convert to client work" : "Convert to an employment opportunity",
    intro: client ? "Starts a client opportunity in Discovery. Add a quote now or after the proposal." : "Tracks the role, application, and interviews. Employment never counts as a sale.",
    fields: client
      ? [
          { name: "title", label: "Opportunity", required: true, value: `${inq.organization || inq.contactName}: ${state.config.services.find(([k]) => k === inq.service)?.[1] || "project"}`, max: 160 },
          can("money.write") ? { name: "quote", label: "Quote amount (USD)", type: "money", optional: true } : null,
        ]
      : [
          [
            { name: "role", label: "Role", required: true, max: 120 },
            { name: "employmentType", label: "Type", type: "select", options: state.config.employmentTypes, optional: true },
          ],
          { name: "applicationUrl", label: "Application or posting link", type: "url", optional: true, max: 500 },
        ],
    submitLabel: "Convert",
    onSubmit: async (v) => {
      const body = client ? { to, title: v.title, quote: v.quote } : { to, role: v.role, employmentType: v.employmentType, applicationUrl: v.applicationUrl, title: `${v.role} at ${inq.organization || "employer"}` };
      const { opportunity } = await api(`inquiries/${inq.id}/convert`, { method: "POST", body });
      toast("Converted");
      go(`#/opportunity/${opportunity.id}`);
    },
  });
}

// ---------- opportunities ----------

export function newOpportunity(type = "client") {
  const client = type === "client";
  formSheet({
    title: client ? "New client opportunity" : "New employment opportunity",
    intro: client ? null : "A role you're applying for or were approached about. Tracked separately from client work.",
    fields: client
      ? [
          { name: "title", label: "What's the work?", required: true, placeholder: "Website rebuild for Acme", max: 160 },
          [
            { name: "contactName", label: "Client name", optional: true, max: 120 },
            { name: "contactEmail", label: "Their email", type: "email", optional: true, max: 254 },
          ],
          [
            { name: "organization", label: "Organization", optional: true, max: 120 },
            { name: "service", label: "Service", type: "select", options: state.config.services, optional: true },
          ],
          [
            { name: "source", label: "Source", type: "select", options: state.config.sources, value: "referral", required: true },
            can("money.write") ? { name: "quote", label: "Quote amount (USD)", type: "money", optional: true } : null,
          ],
        ]
      : [
          [
            { name: "role", label: "Role", required: true, max: 120 },
            { name: "organization", label: "Employer", required: true, max: 120 },
          ],
          [
            { name: "employmentType", label: "Type", type: "select", options: state.config.employmentTypes, optional: true },
            { name: "stage", label: "Where is it?", type: "select", options: [["interested", "Interested"], ["applied", "Applied"], ["screening", "Screening"], ["interviewing", "Interviewing"]], value: "applied", required: true },
          ],
          { name: "applicationUrl", label: "Application or posting link", type: "url", optional: true, max: 500 },
          [
            { name: "source", label: "Source", type: "select", options: state.config.sources, value: "outbound", required: true },
            { name: "nextAction", label: "Next action", optional: true, max: 200 },
          ],
          [
            { name: "contactName", label: "Recruiter / contact", optional: true, max: 120 },
            { name: "contactEmail", label: "Their email", type: "email", optional: true, max: 254 },
          ],
        ],
    submitLabel: "Create",
    onSubmit: async (v) => {
      const body = { type, ...v, title: client ? v.title : `${v.role} at ${v.organization}` };
      if (v.contactName) body.newContact = { name: v.contactName, email: v.contactEmail || undefined, company: v.organization || undefined };
      delete body.contactName;
      delete body.contactEmail;
      const { opportunity } = await api("opportunities", { method: "POST", body });
      toast("Created");
      go(`#/opportunity/${opportunity.id}`);
    },
  });
}

export function editOpportunity(o) {
  const client = o.type === "client";
  formSheet({
    title: "Edit opportunity",
    fields: client
      ? [
          { name: "title", label: "Title", required: true, value: o.title, max: 160 },
          [
            { name: "organization", label: "Organization", optional: true, value: o.organization, max: 120 },
            { name: "service", label: "Service", type: "select", options: state.config.services, value: o.service, optional: true },
          ],
          [
            can("money.write") ? { name: "quote", label: "Quote amount (USD)", type: "money", optional: true, value: o.quote?.amount ?? "" } : null,
            { name: "expectedDecisionAt", label: "Expected decision", type: "date", optional: true, value: o.expectedDecisionAt },
          ],
          { name: "nextAction", label: "Next action", optional: true, value: o.nextAction, max: 200 },
        ]
      : [
          [
            { name: "role", label: "Role", optional: true, value: o.role, max: 120 },
            { name: "organization", label: "Employer", optional: true, value: o.organization, max: 120 },
          ],
          [
            { name: "employmentType", label: "Type", type: "select", options: state.config.employmentTypes, value: o.employmentType, optional: true },
            { name: "expectedDecisionAt", label: "Expected decision", type: "date", optional: true, value: o.expectedDecisionAt },
          ],
          { name: "applicationUrl", label: "Application link", type: "url", optional: true, value: o.applicationUrl, max: 500 },
          { name: "nextAction", label: "Next action", optional: true, value: o.nextAction, max: 200 },
        ],
    danger: { label: "Archive", onClick: async () => { await api(`opportunities/${o.id}`, { method: "PATCH", body: { archived: true } }); toast("Archived"); go(`#/inquiries?tab=${o.type}`); } },
    onSubmit: async (v) => {
      if (!client) v.title = `${v.role || o.role || "Role"} at ${v.organization || o.organization || "employer"}`;
      await api(`opportunities/${o.id}`, { method: "PATCH", body: v });
      toast("Saved");
      refresh();
    },
  });
}

export function moveStage(o, stageKey) {
  const t = oppType(o.type);
  const target = t.stages.find((s) => s.key === stageKey);
  const send = async (body) => {
    await api(`opportunities/${o.id}/stage`, { method: "POST", body });
    toast(`Moved to ${target.label}`);
    refresh();
    if (o.type === "client" && stageKey === "won" && !o.projectId) setTimeout(() => createProjectFrom(o), 250);
  };
  if (target.type === "lost") {
    formSheet({
      title: `Mark as ${target.label.toLowerCase()}`,
      fields: [{ name: "lossReason", label: "Why?", type: "radio", options: t.lossReasons, required: true }],
      submitLabel: "Mark it",
      onSubmit: (v) => send({ stage: stageKey, lossReason: v.lossReason }),
    });
  } else send({ stage: stageKey }).catch((e) => toast(e.message, "error"));
}

export function createProjectFrom(o) {
  formSheet({
    title: "Start the project",
    intro: "Won client work becomes a project with deliverables, a deadline, and payments.",
    fields: [
      { name: "title", label: "Project", required: true, value: o.title, max: 160 },
      [
        { name: "deadline", label: "Deadline", type: "date", optional: true },
        { name: "assigneeId", label: "Collaborator", type: "select", options: people(), value: "owner", required: true },
      ],
      can("money.write") ? { name: "value", label: "Recorded value (USD)", type: "money", optional: true, value: o.quote?.amount ?? "" } : null,
    ],
    submitLabel: "Create project",
    onSubmit: async (v) => {
      const { project } = await api(`opportunities/${o.id}/project`, { method: "POST", body: { ...v, assigneeId: v.assigneeId === "owner" ? null : v.assigneeId } });
      toast("Project created");
      go(`#/project/${project.id}`);
    },
  });
}

// ---------- projects ----------

export function newProject() {
  formSheet({
    title: "New project",
    intro: "For work that didn't come through an opportunity here. Won opportunities create their project automatically.",
    fields: [
      { name: "title", label: "Project", required: true, max: 160 },
      [
        { name: "clientName", label: "Client", optional: true, max: 120 },
        { name: "organization", label: "Organization", optional: true, max: 120 },
      ],
      [
        { name: "deadline", label: "Deadline", type: "date", optional: true },
        { name: "assigneeId", label: "Collaborator", type: "select", options: people(), value: "owner", required: true },
      ],
      can("money.write") ? { name: "value", label: "Recorded value (USD)", type: "money", optional: true } : null,
    ],
    submitLabel: "Create project",
    onSubmit: async (v) => {
      const body = { ...v, assigneeId: v.assigneeId === "owner" ? null : v.assigneeId };
      if (v.clientName) body.newContact = { name: v.clientName, company: v.organization || undefined };
      const { project } = await api("projects", { method: "POST", body });
      toast("Project created");
      go(`#/project/${project.id}`);
    },
  });
}

export function editProject(p) {
  formSheet({
    title: "Edit project",
    fields: [
      { name: "title", label: "Project", required: true, value: p.title, max: 160 },
      [
        { name: "stage", label: "Stage", type: "select", options: state.config.projectStages.map(([k, l]) => [k, l]), value: p.stage, required: true },
        { name: "deadline", label: "Deadline", type: "date", optional: true, value: p.deadline },
      ],
      [
        { name: "assigneeId", label: "Collaborator", type: "select", options: people(), value: p.assigneeId || "owner", required: true },
        can("money.write") ? { name: "value", label: "Recorded value (USD)", type: "money", optional: true, value: p.value?.amount ?? "" } : null,
      ],
    ],
    danger: { label: "Archive", onClick: async () => { await api(`projects/${p.id}`, { method: "PATCH", body: { archived: true } }); toast("Archived"); go("#/projects"); } },
    onSubmit: async (v) => {
      await api(`projects/${p.id}`, { method: "PATCH", body: { ...v, assigneeId: v.assigneeId === "owner" ? null : v.assigneeId } });
      toast("Saved");
      refresh();
    },
  });
}

export function addDeliverable(p) {
  formSheet({
    title: "Add a deliverable",
    intro: p.title,
    fields: [
      { name: "title", label: "Deliverable", required: true, placeholder: "Homepage design", max: 160 },
      [
        { name: "assigneeId", label: "Assigned to", type: "select", options: people(), value: p.assigneeId || "owner", required: true },
        { name: "dueAt", label: "Due", type: "date", optional: true, value: p.deadline },
      ],
    ],
    submitLabel: "Add",
    onSubmit: async (v) => {
      await api(`projects/${p.id}/deliverables`, { method: "POST", body: { ...v, assigneeId: v.assigneeId === "owner" ? null : v.assigneeId } });
      toast("Deliverable added");
      refresh();
    },
  });
}

/** Status and a written update. Collaborators use this on their own deliverables. */
export function updateDeliverable(p, d) {
  const fields = [
    { name: "status", label: "Status", type: "radio", options: state.config.deliverableStatuses, value: d.status, required: true },
    { name: "update", label: "Update", type: "textarea", optional: true, rows: 3, placeholder: "What changed, what's left, links to the work" },
  ];
  if (isManager()) {
    fields.unshift({ name: "title", label: "Deliverable", required: true, value: d.title, max: 160 });
    fields.splice(2, 0, [
      { name: "assigneeId", label: "Assigned to", type: "select", options: people(), value: d.assigneeId || "owner", required: true },
      { name: "dueAt", label: "Due", type: "date", optional: true, value: d.dueAt },
    ]);
  }
  formSheet({
    title: isManager() ? "Edit deliverable" : d.title,
    intro: isManager() ? null : p.title,
    fields,
    onSubmit: async (v) => {
      const body = { status: v.status, update: v.update || null };
      if (isManager()) Object.assign(body, { title: v.title, assigneeId: v.assigneeId === "owner" ? null : v.assigneeId, dueAt: v.dueAt || null });
      await api(`projects/${p.id}/deliverables/${d.id}`, { method: "PATCH", body });
      toast("Saved");
      refresh();
    },
  });
}

export function recordPayment(p) {
  formSheet({
    title: "Record a payment",
    intro: "Saved as a manual entry. No payment or accounting provider is connected, so it isn't provider-verified.",
    fields: [
      [
        { name: "amount", label: "Amount received (USD)", type: "money", required: true },
        { name: "receivedAt", label: "Date received", type: "date", value: new Date().toISOString(), required: true },
      ],
      { name: "method", label: "Method", type: "select", options: state.config.paymentMethods, value: "bank", required: true },
      { name: "note", label: "Note", optional: true, max: 300 },
    ],
    submitLabel: "Record payment",
    onSubmit: async (v) => {
      await api(`projects/${p.id}/payments`, { method: "POST", body: v });
      toast("Payment recorded");
      refresh();
    },
  });
}

// ---------- activity on any record ----------

export function logInteraction(entity, id, type = "email") {
  const titles = { email: "Log an email", call: "Log a call", meeting: "Log a meeting", message: "Log a message", note: "Add a note" };
  formSheet({
    title: titles[type],
    fields: [
      type === "note" ? null : [
        { name: "type", label: "What", type: "select", options: state.config.interactions.filter(([k]) => k !== "note"), value: type, required: true },
        { name: "direction", label: "Direction", type: "select", options: [["outbound", "I reached out / replied"], ["inbound", "They reached out"]], value: "outbound", required: true },
      ],
      { name: "note", label: type === "note" ? "Note (private)" : "Summary (private)", type: "textarea", required: type === "note", optional: type !== "note", rows: 4 },
      type === "note" ? null : { name: "at", label: "When", type: "datetime", value: new Date().toISOString(), required: true },
    ],
    submitLabel: type === "note" ? "Add note" : "Log it",
    onSubmit: async (v) => {
      await api("interactions", { method: "POST", body: { entity, id, type: type === "note" ? "note" : v.type, direction: v.direction, note: v.note, at: v.at } });
      toast(type === "note" ? "Note added" : "Logged");
      refresh();
    },
  });
}

// ---------- tasks and appointments ----------

export function addTask({ relatedType = null, relatedId = null, relatedLabel = null, kind = "follow_up", title = "" } = {}) {
  formSheet({
    title: kind === "interview" ? "Schedule an interview" : kind === "appointment" ? "Add a client appointment" : "New task",
    intro: relatedLabel ? `For ${relatedLabel}` : null,
    fields: [
      { name: "title", label: "What", required: true, value: title, max: 200 },
      [
        { name: "dueAt", label: kind === "interview" || kind === "appointment" ? "When" : "Due", type: "datetime", value: nextWeekday(1, 9), required: true },
        { name: "kind", label: "Kind", type: "select", options: state.config.taskKinds, value: kind, required: true },
      ],
      [
        { name: "assigneeId", label: "Who", type: "select", options: people(), value: "owner", required: true },
        { name: "priority", label: "Priority", type: "select", options: state.config.priorities, value: "normal", required: true },
      ],
      { name: "notes", label: "Notes (private)", type: "textarea", optional: true, rows: 2, max: 2000 },
    ],
    submitLabel: "Save",
    onSubmit: async (v) => {
      await api("tasks", { method: "POST", body: { ...v, relatedType, relatedId } });
      toast("Saved");
      refresh();
    },
  });
}

export function editTask(t) {
  formSheet({
    title: "Edit task",
    fields: [
      { name: "title", label: "Task", required: true, value: t.title, max: 200 },
      [
        { name: "dueAt", label: "Due", type: "datetime", value: t.dueAt, required: true },
        { name: "assigneeId", label: "Who", type: "select", options: people(), value: t.assigneeId || "owner", required: true },
      ],
      { name: "notes", label: "Notes (private)", type: "textarea", optional: true, value: t.notes, rows: 3 },
    ],
    danger: { label: "Archive", onClick: async () => { await api(`tasks/${t.id}`, { method: "PATCH", body: { archived: true } }); toast("Archived"); refresh(); } },
    onSubmit: async (v) => {
      await api(`tasks/${t.id}`, { method: "PATCH", body: v });
      toast("Saved");
      refresh();
    },
  });
}

export async function completeTask(id, action = "complete") {
  try {
    await api(`tasks/${id}`, { method: "PATCH", body: { action } });
    toast(action === "complete" ? "Done" : "Reopened");
    refresh();
  } catch (e) {
    toast(e.message, "error");
  }
}

export function quickAddMenu() {
  formSheet({
    title: "Add",
    fields: [
      {
        name: "what", label: "What do you want to add?", type: "radio", required: true, value: "inquiry",
        options: [
          ["inquiry", "An inquiry (email, LinkedIn, referral)"],
          ["client", "A client opportunity"],
          ["employment", "An employment opportunity"],
          ["project", "A project"],
          ["task", "A task or appointment"],
        ],
      },
    ],
    submitLabel: "Continue",
    onSubmit: async (v) => {
      setTimeout(() => {
        if (v.what === "inquiry") newInquiry();
        else if (v.what === "client" || v.what === "employment") newOpportunity(v.what);
        else if (v.what === "project") newProject();
        else addTask();
      }, 60);
    },
  });
}
