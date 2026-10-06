// The handful of actions the portal is built around, shared by every view:
// add an opportunity, contact, or task; log a reply, call, or note; move a
// stage (asking why when something is lost); record money. Each one is a
// short form, and each refreshes the current view when it's done.
import { api, state, can, formSheet, toast, pipeline, nextWeekday, label } from "./lib.js";

const refresh = () => window.dispatchEvent(new Event("portal:refresh"));

export function newOpportunity({ kind = "project", contactId = null, contactName = null } = {}) {
  const p = pipeline(kind);
  const isProject = kind === "project";
  formSheet({
    title: isProject ? "New client project" : "New job opportunity",
    fields: [
      { name: "title", label: isProject ? "What is it?" : "Role and company", required: true, placeholder: isProject ? "Website redesign for Acme" : "Product Designer at Acme", max: 160 },
      contactId
        ? { name: "contactId", type: "hidden", value: contactId }
        : [
            { name: "contactName", label: isProject ? "Client name" : "Recruiter / contact", optional: true, max: 120 },
            { name: "contactEmail", label: "Their email", type: "email", optional: true, max: 254 },
          ],
      [
        { name: "company", label: "Company", optional: true, max: 120 },
        { name: "source", label: "Where it came from", type: "select", options: state.config.sources, value: isProject ? "referral" : "linkedin", required: true },
      ],
      isProject
        ? [
            { name: "service", label: "What they need", type: "select", options: state.config.services, optional: true },
            can("finance.write") ? { name: "estimate", label: "Estimated value", type: "money", optional: true } : null,
          ]
        : [
            { name: "employment", label: "Type", type: "select", options: state.config.employment, optional: true },
            can("finance.write") ? { name: "estimate", label: "Compensation", type: "money", optional: true, placeholder: "Annual or contract total" } : null,
          ],
      [
        { name: "direction", label: "Who reached out?", type: "select", options: [["inbound", "They did"], ["outbound", "I did"]], value: isProject ? "inbound" : "outbound", required: true },
        { name: "stage", label: "Stage", type: "select", options: p.stages.filter((s) => s.type !== "lost").map((s) => [s.key, s.label]), value: p.stages[0].key, required: true },
      ],
      !isProject ? { name: "link", label: "Posting link", type: "url", optional: true, max: 500 } : null,
      { name: "summary", label: "Notes", type: "textarea", optional: true, rows: 3, max: 2000 },
      { name: "needsReply", label: "Do I owe them a reply?", type: "radio", options: [["no", "No"], ["yes", "Yes, add a Reply task"]], value: "no" },
    ],
    submitLabel: "Create",
    onSubmit: async (v) => {
      const body = {
        kind, title: v.title, company: v.company, source: v.source, direction: v.direction, stage: v.stage,
        summary: v.summary, service: v.service, employment: v.employment, link: v.link, estimate: v.estimate,
        needsReply: v.needsReply === "yes",
        contactId: v.contactId || null,
      };
      if (!body.contactId && v.contactName) body.newContact = { name: v.contactName, email: v.contactEmail || undefined, company: v.company || undefined };
      const { opportunity } = await api("opportunities", { method: "POST", body });
      toast("Opportunity created");
      location.hash = `#/opportunity/${opportunity.id}`;
    },
  });
}

export function newContact() {
  formSheet({
    title: "New contact",
    fields: [
      { name: "name", label: "Name", required: true, max: 120 },
      [
        { name: "email", label: "Email", type: "email", optional: true, max: 254 },
        { name: "phone", label: "Phone", optional: true, max: 40 },
      ],
      [
        { name: "company", label: "Company", optional: true, max: 120 },
        { name: "title", label: "Their title", optional: true, max: 120 },
      ],
      { name: "type", label: "Who they are", type: "select", options: state.config.contactTypes, value: "client", required: true },
      { name: "linkedin", label: "LinkedIn URL", type: "url", optional: true, max: 500 },
    ],
    submitLabel: "Add contact",
    onSubmit: async (v) => {
      const { contact } = await api("contacts", { method: "POST", body: v });
      toast("Contact added");
      location.hash = `#/contact/${contact.id}`;
    },
  });
}

export function editContact(contact) {
  formSheet({
    title: "Edit contact",
    fields: [
      { name: "name", label: "Name", required: true, value: contact.name, max: 120 },
      [
        { name: "email", label: "Email", type: "email", optional: true, value: contact.email, max: 254 },
        { name: "phone", label: "Phone", optional: true, value: contact.phone, max: 40 },
      ],
      [
        { name: "company", label: "Company", optional: true, value: contact.company, max: 120 },
        { name: "title", label: "Their title", optional: true, value: contact.title, max: 120 },
      ],
      { name: "type", label: "Who they are", type: "select", options: state.config.contactTypes, value: contact.type, required: true },
      { name: "linkedin", label: "LinkedIn URL", type: "url", optional: true, value: contact.linkedin, max: 500 },
      { name: "notes", label: "Background", type: "textarea", optional: true, value: contact.notes, rows: 3 },
    ],
    onSubmit: async (v) => {
      await api(`contacts/${contact.id}`, { method: "PATCH", body: v });
      toast("Saved");
      refresh();
    },
  });
}

export function editOpportunity(opp) {
  const isProject = opp.kind === "project";
  formSheet({
    title: "Edit opportunity",
    fields: [
      { name: "title", label: "Title", required: true, value: opp.title, max: 160 },
      [
        { name: "company", label: "Company", optional: true, value: opp.company, max: 120 },
        { name: "source", label: "Source", type: "select", options: state.config.sources, value: opp.source, required: true },
      ],
      isProject
        ? [
            { name: "service", label: "Service", type: "select", options: state.config.services, value: opp.service, optional: true },
            { name: "dueAt", label: "Delivery due", type: "date", optional: true, value: opp.dueAt },
          ]
        : [
            { name: "employment", label: "Type", type: "select", options: state.config.employment, value: opp.employment, optional: true },
            { name: "link", label: "Posting link", type: "url", optional: true, value: opp.link, max: 500 },
          ],
      can("finance.write")
        ? [
            { name: "estimate", label: isProject ? "Estimated value" : "Expected compensation", type: "money", optional: true, value: opp.value?.estimate ?? "" },
            { name: "final", label: isProject ? "Agreed value" : "Offered compensation", type: "money", optional: true, value: opp.value?.final ?? "" },
          ]
        : null,
      { name: "expectedCloseAt", label: isProject ? "Expected decision" : "Expected decision", type: "date", optional: true, value: opp.expectedCloseAt },
      { name: "summary", label: "Summary", type: "textarea", optional: true, value: opp.summary, rows: 4, max: 2000 },
    ],
    onSubmit: async (v) => {
      if (!can("finance.write")) {
        delete v.estimate;
        delete v.final;
      }
      await api(`opportunities/${opp.id}`, { method: "PATCH", body: v });
      toast("Saved");
      refresh();
    },
  });
}

export function moveStage(opp, stageKey) {
  const p = pipeline(opp.kind);
  const target = p.stages.find((s) => s.key === stageKey);
  if (target.type === "lost") {
    formSheet({
      title: `Mark as ${target.label.toLowerCase()}`,
      intro: "Knowing why things don't move forward is what improves the next one.",
      fields: [
        { name: "lossReason", label: "Why?", type: "radio", options: p.lossReasons, required: true },
        { name: "note", label: "Anything to remember", type: "textarea", optional: true, rows: 2 },
      ],
      submitLabel: "Mark it",
      onSubmit: async (v) => {
        await api(`opportunities/${opp.id}/stage`, { method: "POST", body: { stage: stageKey, lossReason: v.lossReason, note: v.note || null } });
        toast("Updated");
        refresh();
      },
    });
    return;
  }
  api(`opportunities/${opp.id}/stage`, { method: "POST", body: { stage: stageKey } })
    .then(() => {
      toast(`Moved to ${target.label}`);
      refresh();
      if (target.type === "won" && opp.kind === "project" && stageKey === "active" && can("finance.write") && !opp.value?.final) {
        setTimeout(() => editOpportunity({ ...opp, stage: stageKey }), 300);
      }
    })
    .catch((e) => toast(e.message, "error"));
}

export function logInteraction({ opportunityId = null, contactId = null, type = "email", direction = "outbound" } = {}) {
  const titles = { email: "Log an email", call: "Log a call", meeting: "Log a meeting", message: "Log a message", note: "Add a note" };
  formSheet({
    title: titles[type] || "Log an interaction",
    fields: [
      type === "note" ? null : [
        { name: "type", label: "What", type: "select", options: state.config.interactions.filter(([k]) => k !== "note"), value: type, required: true },
        { name: "direction", label: "Direction", type: "select", options: [["outbound", "I reached out / replied"], ["inbound", "They reached out"]], value: direction, required: true },
      ],
      { name: "note", label: type === "note" ? "Note" : "Summary", type: "textarea", optional: type !== "note", required: type === "note", rows: 4 },
      type === "note" ? null : { name: "at", label: "When", type: "datetime", value: new Date().toISOString(), required: true },
    ],
    submitLabel: type === "note" ? "Add note" : "Log it",
    onSubmit: async (v) => {
      await api("interactions", { method: "POST", body: { opportunityId, contactId, type: type === "note" ? "note" : v.type, direction: v.direction, note: v.note, at: v.at } });
      toast(type === "note" ? "Note added" : "Logged");
      refresh();
    },
  });
}

export function addTask({ relatedType = null, relatedId = null, relatedLabel = null, kind = "follow_up", title = "" } = {}) {
  formSheet({
    title: "New task",
    intro: relatedLabel ? `For ${relatedLabel}` : null,
    fields: [
      { name: "title", label: "What needs to happen", required: true, value: title, max: 200 },
      [
        { name: "dueAt", label: "Due", type: "datetime", value: nextWeekday(1, 9), required: true },
        { name: "priority", label: "Priority", type: "select", options: state.config.priorities, value: "normal", required: true },
      ],
      { name: "kind", label: "Kind", type: "select", options: state.config.taskKinds, value: kind, required: true },
      { name: "notes", label: "Notes", type: "textarea", optional: true, rows: 2, max: 2000 },
    ],
    submitLabel: "Add task",
    onSubmit: async (v) => {
      await api("tasks", { method: "POST", body: { ...v, relatedType, relatedId } });
      toast("Task added");
      refresh();
    },
  });
}

export function editTask(task) {
  formSheet({
    title: "Edit task",
    fields: [
      { name: "title", label: "Task", required: true, value: task.title, max: 200 },
      [
        { name: "dueAt", label: "Due", type: "datetime", value: task.dueAt, required: true },
        { name: "priority", label: "Priority", type: "select", options: state.config.priorities, value: task.priority, required: true },
      ],
      { name: "notes", label: "Notes", type: "textarea", optional: true, value: task.notes, rows: 3 },
    ],
    onSubmit: async (v) => {
      await api(`tasks/${task.id}`, { method: "PATCH", body: v });
      toast("Saved");
      refresh();
    },
  });
}

export async function completeTask(id, action = "complete") {
  try {
    await api(`tasks/${id}`, { method: "PATCH", body: { action } });
    toast(action === "complete" ? "Done" : action === "approve" ? "Approved" : action === "dismiss" ? "Dismissed" : "Reopened");
    refresh();
  } catch (e) {
    toast(e.message, "error");
  }
}

export function recordPayment(opp) {
  formSheet({
    title: "Record money",
    intro: `${opp.title}. Management numbers only, not your accounting books.`,
    fields: [
      { name: "type", label: "What happened", type: "radio", options: [["invoiced", "I sent an invoice"], ["received", "I got paid"]], value: "received", required: true },
      [
        { name: "amount", label: "Amount", type: "money", required: true },
        { name: "at", label: "Date", type: "date", value: new Date().toISOString(), required: true },
      ],
      { name: "note", label: "Note", optional: true, max: 300 },
    ],
    submitLabel: "Record",
    onSubmit: async (v) => {
      await api(`opportunities/${opp.id}/payments`, { method: "POST", body: v });
      toast("Recorded");
      refresh();
    },
  });
}

export function quickAddMenu() {
  formSheet({
    title: "Add",
    fields: [
      {
        name: "what", label: "What do you want to add?", type: "radio", required: true, value: "project",
        options: [
          ["project", "A client project / inquiry"],
          ["job", "A job opportunity"],
          ["contact", "A contact"],
          ["task", "A task"],
        ],
      },
    ],
    submitLabel: "Continue",
    onSubmit: async (v) => {
      setTimeout(() => {
        if (v.what === "project" || v.what === "job") newOpportunity({ kind: v.what });
        else if (v.what === "contact") newContact();
        else addTask();
      }, 60);
    },
  });
}

export { label };
