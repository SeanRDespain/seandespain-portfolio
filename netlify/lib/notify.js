// Optional email alert to Sean when a website inquiry arrives, through
// Resend's API. Off until RESEND_API_KEY and NOTIFY_EMAIL are set; an inquiry
// is always saved to the portal first, so a mail failure never loses a lead.
import { labelOf, BUDGETS, TIMELINES } from "./model.js";

export function notifyConfigured() {
  return Boolean(process.env.RESEND_API_KEY && process.env.NOTIFY_EMAIL);
}

export async function notifyNewInquiry({ form, sourceLabel, portalUrl }) {
  if (!notifyConfigured()) return { sent: false, reason: "not_configured" };
  const kind = form.type === "project" ? "Project inquiry" : form.type === "job" ? "Job / role inquiry" : "Question";
  const lines = [
    `${kind} from ${form.name}${form.company ? ` (${form.company})` : ""}`,
    `Email: ${form.email}`,
    form.budget ? `Budget: ${labelOf(BUDGETS, form.budget)}` : null,
    form.timeline ? `Timeline: ${labelOf(TIMELINES, form.timeline)}` : null,
    `Came from: ${sourceLabel}`,
    "",
    form.message,
    "",
    `Open it in the portal: ${portalUrl}`,
    "Reply to this email to answer them directly.",
  ].filter((l) => l !== null);
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: process.env.NOTIFY_FROM || "seandespain.com <onboarding@resend.dev>",
        to: [process.env.NOTIFY_EMAIL],
        reply_to: form.email,
        subject: `New ${kind.toLowerCase()}: ${form.name}`,
        text: lines.join("\n"),
      }),
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) console.error("[portal] inquiry email failed:", res.status);
    return { sent: res.ok };
  } catch (err) {
    console.error("[portal] inquiry email failed:", err.message);
    return { sent: false };
  }
}
