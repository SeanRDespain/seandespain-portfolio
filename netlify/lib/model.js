// The business model for seandespain.com, in one place.
//
// Sean Despain's portfolio and professional-services site. Work flows:
//
//   inquiry (website form or a deliberate manager entry)
//     -> client opportunity (freelance / contract work: proposal, quote)
//          -> project (deliverables, deadline, collaborator, payments)
//     -> employment opportunity (employer, role, application, interviews)
//
// Employment is never a sale: it has its own funnel and never adds to
// quoted value, confirmed work, or cash. Stages and lists below are
// configuration; the portal, metrics, and Jarvis API all read them.

export const BUSINESS = {
  id: "sean-despain",
  slug: "sean-despain",
  name: "Sean Despain",
  source: "seandespain.com",
  timezone: "America/Denver",
  currency: "USD",
};

export const INQUIRY_TYPES = [
  ["client_work", "Client work"],
  ["employment", "Employment / role"],
  ["general", "General question"],
];

export const INQUIRY_STATUSES = [
  ["new", "New", "open"],
  ["contacted", "Contacted", "open"],
  ["converted", "Converted", "closed"],
  ["not_a_fit", "Not a fit", "closed"],
  ["spam", "Spam", "closed"],
  ["closed", "Closed", "closed"],
];

export const OPPORTUNITY_TYPES = {
  client: {
    label: "Client work",
    stages: [
      { key: "discovery", label: "Discovery", type: "open", next: "Understand the scope and budget" },
      { key: "proposal", label: "Proposal sent", type: "open", next: "Follow up on the proposal" },
      { key: "won", label: "Won", type: "won" },
      { key: "lost", label: "Lost", type: "lost" },
    ],
    lossReasons: [
      ["budget", "Budget"],
      ["timing", "Timing"],
      ["went_elsewhere", "Chose someone else"],
      ["not_a_fit", "Not a fit"],
      ["no_response", "Stopped responding"],
    ],
  },
  employment: {
    label: "Employment",
    stages: [
      { key: "interested", label: "Interested", type: "open", next: "Decide whether to apply" },
      { key: "applied", label: "Applied", type: "open", next: "Follow up if there's no reply" },
      { key: "screening", label: "Screening", type: "open", next: "Prepare for the screen" },
      { key: "interviewing", label: "Interviewing", type: "open", next: "Prepare, then follow up" },
      { key: "offer", label: "Offer", type: "open", next: "Decide" },
      { key: "accepted", label: "Accepted", type: "won" },
      { key: "closed", label: "Closed", type: "lost" },
    ],
    lossReasons: [
      ["not_selected", "Not selected"],
      ["withdrew", "I withdrew"],
      ["role_closed", "Role filled or closed"],
      ["compensation", "Compensation"],
      ["no_response", "No response"],
    ],
  },
};

export const PROJECT_STAGES = [
  ["planning", "Planning", "active"],
  ["in_progress", "In progress", "active"],
  ["review", "In review", "active"],
  ["on_hold", "On hold", "paused"],
  ["delivered", "Delivered", "done"],
  ["cancelled", "Cancelled", "done"],
];

export const DELIVERABLE_STATUSES = [
  ["todo", "To do"],
  ["in_progress", "In progress"],
  ["done", "Done"],
];

export const SERVICES = [
  ["app", "App"],
  ["website", "Website"],
  ["software", "Business software"],
  ["brand", "Brand identity"],
  ["marketing", "Marketing & launch"],
  ["multiple", "Several of these"],
  ["not_sure", "Not sure yet"],
];

export const EMPLOYMENT_TYPES = [
  ["full_time", "Full-time"],
  ["contract", "Contract"],
  ["part_time", "Part-time"],
  ["freelance", "Freelance"],
];

export const BUDGETS = [
  ["under_2500", "Under $2,500"],
  ["2500_10000", "$2,500 to $10,000"],
  ["10000_25000", "$10,000 to $25,000"],
  ["25000_plus", "$25,000 or more"],
  ["unsure", "Not sure yet"],
];

export const TIMELINES = [
  ["asap", "As soon as possible"],
  ["1_3_months", "In 1 to 3 months"],
  ["3_plus_months", "3+ months out"],
  ["flexible", "Flexible"],
];

export const HEARD_ABOUT = [
  ["linkedin", "LinkedIn"],
  ["google_organic", "Google search"],
  ["referral", "A referral or word of mouth"],
  ["saw_work", "I saw something Sean built"],
  ["other", "Somewhere else"],
];

export const CONTACT_TYPES = [
  ["client", "Client or prospect"],
  ["recruiter", "Recruiter"],
  ["hiring_manager", "Hiring manager"],
  ["collaborator", "Collaborator"],
  ["other", "Other"],
];

// Where an inquiry or opportunity came from. Classified automatically from
// UTM tags and the referrer when the website captured them; picked by hand
// only for things the website can't see.
export const SOURCES = [
  ["website_direct", "Website (direct)"],
  ["linkedin", "LinkedIn"],
  ["google_organic", "Google search"],
  ["google_ads", "Google Ads"],
  ["referral", "Referral"],
  ["email", "Email"],
  ["instagram", "Instagram"],
  ["facebook", "Facebook"],
  ["job_board", "Job board"],
  ["other_site", "Another website"],
  ["outbound", "My outreach / application"],
  ["unknown", "Unknown"],
];

export const TASK_KINDS = [
  ["follow_up", "Follow-up"],
  ["reply", "Reply"],
  ["interview", "Interview"],
  ["appointment", "Client appointment"],
  ["call", "Call"],
  ["other", "Other"],
];

export const PRIORITIES = [
  ["high", "High"],
  ["normal", "Normal"],
  ["low", "Low"],
];

export const PAYMENT_METHODS = [
  ["bank", "Bank transfer"],
  ["card", "Card"],
  ["check", "Check"],
  ["paypal", "PayPal / Venmo"],
  ["cash", "Cash"],
  ["other", "Other"],
];

export const INTERACTIONS = [
  ["email", "Email"],
  ["call", "Call"],
  ["meeting", "Meeting"],
  ["message", "LinkedIn / message"],
  ["note", "Note"],
];

// History events (internal to the portal; Jarvis reads records instead)
export const EVENT_TYPES = {
  inquiry_received: "Inquiry received",
  inquiry_added: "Inquiry added",
  inquiry_status: "Inquiry status changed",
  inquiry_converted: "Converted to opportunity",
  opportunity_created: "Opportunity created",
  stage_changed: "Stage changed",
  opportunity_won: "Won",
  opportunity_lost: "Lost",
  project_created: "Project created",
  project_updated: "Project updated",
  deliverable_added: "Deliverable added",
  deliverable_updated: "Deliverable updated",
  payment_recorded: "Payment recorded (manual entry)",
  interaction_logged: "Interaction logged",
  note_added: "Note added",
  task_created: "Task created",
  task_completed: "Task completed",
  record_updated: "Updated",
  record_archived: "Archived",
};

export const WORK_PAGES = {
  "/work/peace-life/": "Peace Life case study",
  "/work/jarvis/": "Jarvis case study",
  "/work/wip-services/": "W.I.P Services case study",
  "/work/qinty/": "Organización Qinty case study",
  "/work/once-upon-a-princess/": "Once Upon a Princess case study",
  "/capabilities/": "Capabilities",
  "/about/": "About",
};

export const keys = (pairs) => pairs.map(([k]) => k);
export const labelOf = (pairs, key) => pairs.find(([k]) => k === key)?.[1] ?? key;
export const inquiryIsOpen = (status) => INQUIRY_STATUSES.find(([k]) => k === status)?.[2] === "open";
export const projectPhase = (stage) => PROJECT_STAGES.find(([k]) => k === stage)?.[2] || "active";

export function stageOf(type, key) {
  return OPPORTUNITY_TYPES[type]?.stages.find((s) => s.key === key) || null;
}

/** Records named "[TEST] ..." are labeled test data, kept out of every report. */
export function looksLikeTest(...names) {
  return names.some((n) => typeof n === "string" && /^\s*\[test\]/i.test(n));
}

/**
 * UTM tags win, then the referrer, then what the person told us. With
 * nothing captured at all, a website inquiry is "Website (direct)".
 */
export function classifySource(touch = {}, heard = null) {
  const src = (touch?.utm_source || "").toLowerCase();
  const med = (touch?.utm_medium || "").toLowerCase();
  if (src) {
    if (src.includes("linkedin")) return "linkedin";
    if (src.includes("google")) return /cpc|paid|ads|ppc/.test(med) ? "google_ads" : "google_organic";
    if (src.includes("instagram") || src === "ig") return "instagram";
    if (src.includes("facebook") || src === "fb") return "facebook";
    if (med === "email" || src.includes("mail")) return "email";
    if (med === "referral") return "referral";
    return "other_site";
  }
  let host = "";
  try {
    host = touch?.referrer ? new URL(touch.referrer).hostname.replace(/^www\./, "") : "";
  } catch {
    host = "";
  }
  if (host && !host.endsWith("seandespain.com")) {
    if (host.includes("linkedin") || host === "lnkd.in") return "linkedin";
    if (/(^|\.)google\./.test(host) || host.includes("bing.") || host.includes("duckduckgo")) return "google_organic";
    if (host.includes("instagram")) return "instagram";
    if (host.includes("facebook") || host === "l.facebook.com") return "facebook";
    if (/mail\.|outlook|gmail/.test(host)) return "email";
    if (/indeed|glassdoor|ziprecruiter|wellfound|dice\.com|monster/.test(host)) return "job_board";
    return "other_site";
  }
  if (heard && ["linkedin", "google_organic", "referral"].includes(heard)) return heard;
  return "website_direct";
}

/** Everything the portal UI needs for forms and labels. */
export function publicConfig() {
  return {
    business: BUSINESS,
    inquiryTypes: INQUIRY_TYPES,
    inquiryStatuses: INQUIRY_STATUSES,
    opportunityTypes: OPPORTUNITY_TYPES,
    projectStages: PROJECT_STAGES,
    deliverableStatuses: DELIVERABLE_STATUSES,
    services: SERVICES,
    employmentTypes: EMPLOYMENT_TYPES,
    budgets: BUDGETS,
    timelines: TIMELINES,
    heardAbout: HEARD_ABOUT,
    contactTypes: CONTACT_TYPES,
    sources: SOURCES,
    taskKinds: TASK_KINDS,
    priorities: PRIORITIES,
    paymentMethods: PAYMENT_METHODS,
    interactions: INTERACTIONS,
    eventTypes: EVENT_TYPES,
    workPages: WORK_PAGES,
  };
}
