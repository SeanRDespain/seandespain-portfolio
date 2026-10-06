// The business model for seandespain.com, in one place.
//
// This business has two pipelines, not one generic "deals" list:
//   project: someone needs something built (Sean's freelance/contract work)
//   job:     a role with an employer, inbound from a recruiter or outbound
//            when Sean applies
// They differ in stages, in what "value" means (project revenue vs. salary,
// which must never be added together), and in why things are lost.
//
// Stages, reasons, and lists are configuration: rename, reorder, or add a
// stage here and the portal, metrics, and Jarvis report all follow.

export const PIPELINES = {
  project: {
    label: "Client projects",
    noun: "project",
    valueLabel: "Project value",
    valueKind: "revenue",
    stages: [
      { key: "inquiry", label: "New inquiry", type: "open", probability: 0.1, staleDays: 2, next: "Reply and qualify it" },
      { key: "conversation", label: "In conversation", type: "open", probability: 0.3, staleDays: 7, next: "Discovery call, scope, budget" },
      { key: "proposal", label: "Proposal sent", type: "open", probability: 0.5, staleDays: 7, next: "Follow up on the proposal" },
      { key: "active", label: "Underway", type: "won", next: "Deliver and invoice" },
      { key: "delivered", label: "Delivered", type: "won", next: "Collect payment, ask for a referral" },
      { key: "lost", label: "Not moving forward", type: "lost" },
    ],
    lossReasons: [
      ["budget", "Budget"],
      ["timing", "Timing"],
      ["went_elsewhere", "Chose someone else"],
      ["not_a_fit", "Not a fit"],
      ["no_response", "Stopped responding"],
      ["not_genuine", "Spam / not genuine"],
    ],
  },
  job: {
    label: "Job opportunities",
    noun: "role",
    valueLabel: "Compensation",
    valueKind: "compensation",
    stages: [
      { key: "lead", label: "Opportunity", type: "open", probability: 0.05, staleDays: 7, next: "Decide whether to pursue" },
      { key: "applied", label: "Applied", type: "open", probability: 0.1, staleDays: 14, next: "Follow up if there's no reply" },
      { key: "screening", label: "Screening", type: "open", probability: 0.2, staleDays: 7, next: "Prepare for the screen" },
      { key: "interviewing", label: "Interviewing", type: "open", probability: 0.4, staleDays: 10, next: "Prepare, then follow up" },
      { key: "offer", label: "Offer", type: "open", probability: 0.8, staleDays: 5, next: "Decide" },
      { key: "accepted", label: "Accepted", type: "won" },
      { key: "closed", label: "Closed", type: "lost" },
    ],
    lossReasons: [
      ["not_selected", "Not selected"],
      ["withdrew", "I withdrew"],
      ["role_closed", "Role filled or closed"],
      ["compensation", "Compensation"],
      ["no_response", "No response"],
      ["not_a_fit", "Not a fit"],
      ["not_genuine", "Spam / not genuine"],
    ],
  },
};

export const SERVICES = [
  ["app", "App"],
  ["website", "Website"],
  ["software", "Business software"],
  ["brand", "Brand identity"],
  ["marketing", "Marketing & launch"],
  ["multiple", "Several of these"],
  ["other", "Other"],
];

export const EMPLOYMENT = [
  ["full_time", "Full-time"],
  ["contract", "Contract"],
  ["part_time", "Part-time"],
  ["freelance", "Freelance"],
];

// The inquiry form's budget ranges. The midpoint pre-fills the opportunity's
// estimated value so nobody retypes what the client already said.
export const BUDGETS = [
  ["under_2500", "Under $2,500", 1500],
  ["2500_10000", "$2,500 to $10,000", 6000],
  ["10000_25000", "$10,000 to $25,000", 17500],
  ["25000_plus", "$25,000 or more", 35000],
  ["unsure", "Not sure yet", null],
];

export const TIMELINES = [
  ["asap", "As soon as possible"],
  ["1_3_months", "In 1 to 3 months"],
  ["3_plus_months", "3+ months out"],
  ["flexible", "Flexible"],
];

export const CONTACT_TYPES = [
  ["client", "Client or prospect"],
  ["recruiter", "Recruiter"],
  ["hiring_manager", "Hiring manager"],
  ["referral_partner", "Referral partner"],
  ["collaborator", "Collaborator"],
  ["other", "Other"],
];

// Where opportunities come from. Classified automatically from UTM tags and
// the referrer whenever possible; people only pick one for things the website
// can't see (a LinkedIn DM, a referral, an application Sean sent).
export const SOURCES = [
  ["linkedin", "LinkedIn"],
  ["google_organic", "Google search"],
  ["google_ads", "Google Ads"],
  ["direct", "Direct / resume link"],
  ["referral", "Referral"],
  ["email", "Email"],
  ["instagram", "Instagram"],
  ["facebook", "Facebook"],
  ["tiktok", "TikTok"],
  ["job_board", "Job board"],
  ["event", "Event"],
  ["partner", "Partner"],
  ["returning", "Returning client"],
  ["outbound", "My outreach"],
  ["other_site", "Another website"],
  ["unknown", "Unknown"],
];

export const HEARD_ABOUT = [
  ["linkedin", "LinkedIn"],
  ["google_organic", "Google search"],
  ["referral", "A referral or word of mouth"],
  ["saw_work", "I saw something Sean built"],
  ["other", "Somewhere else"],
];

export const TASK_KINDS = [
  ["reply", "Reply"],
  ["follow_up", "Follow up"],
  ["call", "Call / meeting"],
  ["interview", "Interview"],
  ["proposal", "Proposal"],
  ["deliver", "Deliver"],
  ["invoice", "Invoice / payment"],
  ["other", "Other"],
];

export const PRIORITIES = [
  ["high", "High"],
  ["normal", "Normal"],
  ["low", "Low"],
];

export const INTERACTIONS = [
  ["email", "Email"],
  ["call", "Call"],
  ["meeting", "Meeting"],
  ["message", "LinkedIn / message"],
  ["note", "Note"],
];

// First-party business events. Consistent snake_case names, shared with the
// Jarvis report. Only business actions: no button clicks.
export const EVENT_TYPES = {
  form_submitted: "Website inquiry received",
  contact_created: "Contact added",
  contact_updated: "Contact updated",
  opportunity_created: "Opportunity created",
  opportunity_updated: "Opportunity updated",
  stage_changed: "Stage changed",
  proposal_sent: "Proposal sent",
  application_submitted: "Application submitted",
  interview_scheduled: "Interview scheduled",
  offer_received: "Offer received",
  opportunity_won: "Won",
  opportunity_lost: "Lost",
  project_completed: "Project delivered",
  interaction_logged: "Interaction logged",
  note_added: "Note added",
  payment_recorded: "Payment recorded",
  task_created: "Task created",
  task_completed: "Task completed",
  task_suggested: "Task suggested",
  suggestion_approved: "Suggestion approved",
  suggestion_dismissed: "Suggestion dismissed",
};

// stage moves that also mean a named milestone
export const MILESTONES = {
  "project:proposal": "proposal_sent",
  "job:applied": "application_submitted",
  "job:interviewing": "interview_scheduled",
  "job:offer": "offer_received",
  "project:delivered": "project_completed",
};

export const WORK_PAGES = {
  "/work/peace-life/": "Peace Life",
  "/work/jarvis/": "Jarvis",
  "/work/wip-services/": "W.I.P Services",
  "/work/qinty/": "Organización Qinty",
  "/work/once-upon-a-princess/": "Once Upon a Princess",
  "/capabilities/": "Capabilities",
  "/about/": "About",
};

export const keys = (pairs) => pairs.map(([k]) => k);
export const labelOf = (pairs, key) => pairs.find(([k]) => k === key)?.[1] ?? key;

export function stageOf(kind, key) {
  return PIPELINES[kind]?.stages.find((s) => s.key === key) || null;
}
export function firstStage(kind) {
  return PIPELINES[kind].stages[0].key;
}
export function stagesOfType(kind, type) {
  return PIPELINES[kind].stages.filter((s) => s.type === type).map((s) => s.key);
}

/**
 * Turn what the browser saw (UTM tags, referrer) plus what the person told
 * us into one source. UTM tags win, then the referrer, then the person's own
 * answer, then "direct" when there's simply nothing to go on.
 */
export function classifySource(touch = {}, heard = null) {
  const src = (touch.utm_source || "").toLowerCase();
  const med = (touch.utm_medium || "").toLowerCase();
  if (src) {
    if (src.includes("linkedin")) return "linkedin";
    if (src.includes("google")) return /cpc|paid|ads|ppc/.test(med) ? "google_ads" : "google_organic";
    if (src.includes("instagram") || src === "ig") return "instagram";
    if (src.includes("facebook") || src === "fb") return "facebook";
    if (src.includes("tiktok")) return "tiktok";
    if (med === "email" || src.includes("mail")) return "email";
    if (med === "referral") return "referral";
    return "other_site";
  }
  let host = "";
  try {
    host = touch.referrer ? new URL(touch.referrer).hostname.replace(/^www\./, "") : "";
  } catch {
    host = "";
  }
  if (host && !host.endsWith("seandespain.com")) {
    if (host.includes("linkedin") || host === "lnkd.in") return "linkedin";
    if (/(^|\.)google\./.test(host) || host.includes("bing.") || host.includes("duckduckgo")) return "google_organic";
    if (host.includes("instagram")) return "instagram";
    if (host.includes("facebook") || host === "fb.me" || host === "l.facebook.com") return "facebook";
    if (host.includes("tiktok")) return "tiktok";
    if (/mail\.|outlook|gmail/.test(host)) return "email";
    if (/indeed|glassdoor|ziprecruiter|wellfound|angel\.co|dice\.com|monster/.test(host)) return "job_board";
    return "other_site";
  }
  if (heard && ["linkedin", "google_organic", "referral"].includes(heard)) return heard;
  return touch.landing_page ? "direct" : "unknown";
}

/** Strip money from records for roles without finance access. */
export function redactOpportunity(opp) {
  const { value, payments, ...rest } = opp;
  return { ...rest, value: null, payments: [], redacted: true };
}

/** Everything the portal UI needs to render forms and labels. */
export function publicConfig() {
  return {
    pipelines: PIPELINES,
    services: SERVICES,
    employment: EMPLOYMENT,
    budgets: BUDGETS.map(([k, label]) => [k, label]),
    timelines: TIMELINES,
    contactTypes: CONTACT_TYPES,
    sources: SOURCES,
    heardAbout: HEARD_ABOUT,
    taskKinds: TASK_KINDS,
    priorities: PRIORITIES,
    interactions: INTERACTIONS,
    eventTypes: EVENT_TYPES,
    workPages: WORK_PAGES,
  };
}
