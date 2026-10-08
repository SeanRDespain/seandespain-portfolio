// Settings: account, team accounts (owner only), connections, data export.
import { api, can, html, mount, toast, formSheet, state, label } from "./lib.js";

export async function settingsView(el) {
  mount(el, html`<div class="mp-skel" style="height:300px"></div>`);
  const [integrations, users] = await Promise.all([api("integrations"), can("users.manage") ? api("users") : Promise.resolve(null)]);
  const pill = (ok, okText = "Connected", noText = "Not set up") => html`<span class="mp-badge mp-badge--${ok ? "won" : "warn"} mp-badge--dot">${ok ? okText : noText}</span>`;
  const row = (title, meta, right) => html`<li class="mp-task" style="grid-template-columns:1fr auto"><span><span class="mp-task__title">${title}</span><div class="mp-task__meta">${meta}</div></span>${right}</li>`;
  mount(el, html`
    <header class="mp-head"><div><p class="mp-eyebrow">Settings</p><h1>Portal <em>settings.</em></h1></div></header>
    <div class="mp-ov">
      <section class="mp-card mp-panel mp-span-6">
        <div class="mp-panel__head"><h2>Your account</h2></div>
        <dl class="mp-facts">
          <div><dt>Signed in as</dt><dd>${state.me.user.name}</dd></div>
          <div><dt>Role</dt><dd>${state.me.user.role === "staff" ? "Collaborator" : state.me.user.role === "owner" ? "Owner" : "Manager"}</dd></div>
          <div><dt>Session</dt><dd>Ends after 4 idle hours, 12 hours at most</dd></div>
        </dl>
        <div class="mp-actions" style="margin-top:14px"><button class="mp-btn" data-signout>Sign out</button>${can("export") ? html`<a class="mp-btn" href="/api/manager/export" download>Download all data (JSON)</a>` : ""}</div>
      </section>
      ${can("records.read")
        ? html`<section class="mp-card mp-panel mp-span-6">
            <div class="mp-panel__head"><h2>Connections</h2></div>
            <ul class="mp-list">
              ${row("Jarvis data API", html`Read-only. Base URL ${integrations.jarvis.baseUrl}. Uses ${integrations.jarvis.vars.join(", ")}.`, pill(integrations.jarvis.configured, "Token set", "Token not set"))}
              ${row("Inquiry email alerts", html`Optional, through Resend. Uses ${integrations.email.vars.join(", ")}.`, pill(integrations.email.configured))}
              ${row("Google Analytics 4 in the portal", html`Optional. Uses ${integrations.ga4.vars.join(", ")}.`, pill(integrations.ga4.configured))}
              ${row("Payments / accounting", integrations.payments.note, pill(false, "", "None connected"))}
              ${row("Data storage", `${integrations.storage.provider}, private to this site`, pill(true, "Working"))}
            </ul>
          </section>`
        : ""}
      ${users
        ? html`<section class="mp-card mp-panel mp-span-12">
            <div class="mp-panel__head"><h2>Team</h2><button data-adduser>+ Add a collaborator</button></div>
            <p class="mp-sub" style="margin:0 0 10px">Only add people who actually work on projects with you. Collaborators see just the projects, deliverables, and tasks assigned to them, with no money or client contact details. Managers see everything.</p>
            <ul class="mp-list">${users.items.map((u) =>
              row(
                html`${u.name} <span class="mp-muted">· ${u.username}</span>`,
                `${u.role === "owner" ? "Owner (signs in with the password in Netlify)" : u.role === "staff" ? "Collaborator" : "Manager"}${u.active === false ? " · deactivated" : ""}`,
                u.role === "owner" ? html`<span class="mp-badge">You</span>` : html`<span class="mp-actions"><button class="mp-btn mp-btn--small" data-reset="${u.id}" data-name="${u.name}">New password</button><button class="mp-btn mp-btn--small${u.active === false ? "" : " mp-btn--danger"}" data-toggle="${u.id}" data-active="${u.active === false ? "" : "1"}">${u.active === false ? "Reactivate" : "Deactivate"}</button></span>`,
              ),
            )}</ul>
          </section>`
        : ""}
    </div>
  `);
  el.querySelector("[data-signout]").addEventListener("click", () => window.dispatchEvent(new Event("portal:signout")));
  el.querySelector("[data-adduser]")?.addEventListener("click", () =>
    formSheet({
      title: "Add a collaborator",
      intro: "They'll get a username and a temporary password to share with them privately.",
      fields: [
        [
          { name: "name", label: "Name", required: true, max: 80 },
          { name: "username", label: "Username", required: true, max: 40, placeholder: "first.last" },
        ],
        { name: "role", label: "Access", type: "radio", options: [["staff", "Collaborator: only their assigned work"], ["manager", "Manager: everything"]], value: "staff", required: true },
      ],
      submitLabel: "Create account",
      onSubmit: async (v) => {
        const res = await api("users", { method: "POST", body: v });
        setTimeout(() => showPassword(res.user.name, res.user.username, res.temporaryPassword), 80);
      },
    }),
  );
  el.querySelectorAll("[data-reset]").forEach((b) =>
    b.addEventListener("click", async () => {
      const res = await api(`users/${b.dataset.reset}`, { method: "PATCH", body: { resetPassword: true } });
      showPassword(res.user.name, res.user.username, res.temporaryPassword);
    }),
  );
  el.querySelectorAll("[data-toggle]").forEach((b) =>
    b.addEventListener("click", async () => {
      await api(`users/${b.dataset.toggle}`, { method: "PATCH", body: { active: !b.dataset.active } });
      toast(b.dataset.active ? "Deactivated" : "Reactivated");
      window.dispatchEvent(new Event("portal:refresh"));
    }),
  );
}

function showPassword(name, username, password) {
  const d = document.getElementById("sheet");
  mount(d, html`<div class="mp-form"><h2 id="sheet-title">Share these with ${name}</h2>
    <p class="mp-sub">Shown once. Send them privately; they sign in at seandespain.com/manager/ with "Sign in as a collaborator".</p>
    <dl class="mp-facts"><div><dt>Username</dt><dd class="mp-code">${username}</dd></div><div><dt>Temporary password</dt><dd class="mp-code">${password}</dd></div></dl>
    <div class="mp-form__foot"><button class="mp-btn mp-btn--primary" data-close>Done</button></div></div>`);
  d.querySelector("[data-close]").addEventListener("click", () => {
    d.close();
    window.dispatchEvent(new Event("portal:refresh"));
  });
  if (!d.open) d.showModal();
}

export { label };
