// Portal entry: sign-in, the shell (sidebar on desktop, bottom tabs on
// phones), hash routing, and global search. Five areas: Overview, Inquiries &
// Opportunities, Projects, Calendar & Tasks, Settings.
import { api, state, can, html, raw, mount, icon, closeSheet, ApiError } from "./lib.js";
import { quickAddMenu } from "./actions.js";
import { overview } from "./view-overview.js";
import { inquiriesView, inquiryView, opportunityView, contactView } from "./view-inquiries.js";
import { projectsView, projectView } from "./view-projects.js";
import { calendarView } from "./view-calendar.js";
import { settingsView } from "./view-settings.js";

const app = document.getElementById("app");
try {
  state.period = localStorage.getItem("mp_period") || "30d";
} catch {}

const NAV = [
  { key: "overview", label: "Overview", short: "Overview", icon: icon.overview, perm: "work.read" },
  { key: "inquiries", label: "Inquiries & Opportunities", short: "Inquiries", icon: icon.inbox, perm: "records.read" },
  { key: "projects", label: "Projects", short: "Projects", icon: icon.folder, perm: "work.read" },
  { key: "calendar", label: "Calendar & Tasks", short: "Calendar", icon: icon.calendar, perm: "work.read" },
  { key: "settings", label: "Settings", short: "Settings", icon: icon.settings, perm: null },
];
const SECTION_OF = { inquiry: "inquiries", opportunity: "inquiries", contact: "inquiries", project: "projects" };

// ---------- sign in ----------

function stars() {
  let s = 7;
  const r = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff), s / 0x7fffffff);
  return raw(Array.from({ length: 90 }, () => `<span style="top:${(r() * 100).toFixed(1)}%;left:${(r() * 100).toFixed(1)}%;width:${(1 + r() * 1.4).toFixed(1)}px;height:${(1 + r() * 1.4).toFixed(1)}px;opacity:${(0.3 + r() * 0.6).toFixed(2)}"></span>`).join(""));
}

function renderLogin(message = "") {
  document.title = "Sign in · Portal";
  app.className = "";
  mount(app, html`<main class="mp-login">
    <div class="mp-login__stars" aria-hidden="true">${stars()}</div>
    <form class="mp-login__card" novalidate>
      <p class="mp-login__eyebrow">Sean Despain</p>
      <h1>Business <em>portal</em></h1>
      <label class="mp-login__user" hidden>Username<input name="username" autocomplete="username" autocapitalize="none" spellcheck="false"></label>
      <label>Password<input type="password" name="password" autocomplete="current-password" required autofocus></label>
      <button type="submit">Sign in</button>
      <p class="mp-login__msg" role="alert">${message}</p>
      <p class="mp-login__note"><a href="#" data-collab>Sign in as a collaborator</a> · attempts are rate limited</p>
    </form>
  </main>`);
  const form = app.querySelector("form");
  app.querySelector("[data-collab]").addEventListener("click", (e) => {
    e.preventDefault();
    const box = form.querySelector(".mp-login__user");
    box.hidden = !box.hidden;
    e.target.textContent = box.hidden ? "Sign in as a collaborator" : "Sign in as Sean";
    (box.hidden ? form.elements.password : form.elements.username).focus();
  });
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const msg = form.querySelector(".mp-login__msg");
    const btn = form.querySelector("button");
    if (!form.elements.password.value) return (msg.textContent = "Enter your password.");
    btn.disabled = true;
    msg.textContent = "";
    try {
      await api("login", { method: "POST", body: { password: form.elements.password.value, username: form.querySelector(".mp-login__user").hidden ? undefined : form.elements.username.value } });
      form.reset();
      await boot();
    } catch (err) {
      msg.textContent = err.message;
      form.elements.password.select();
    } finally {
      btn.disabled = false;
    }
  });
}

// ---------- shell ----------

let overdue = 0;
const allowed = () => NAV.filter((n) => !n.perm || can(n.perm));

function navLinks(current, mobile) {
  return allowed().map((n) => {
    const badge = n.key === "calendar" && overdue ? html`<span class="mp-count mp-count--alert">${overdue}</span>` : "";
    return html`<a href="#/${n.key}" ${current === n.key ? raw('aria-current="page"') : ""}>${n.icon}<span>${mobile ? n.short : n.label}</span>${badge}</a>`;
  });
}

function renderShell(section) {
  app.className = "";
  mount(app, html`<div class="mp-shell">
    <aside class="mp-side">
      <a class="mp-brand" href="#/overview"><b>Sean Despain</b><span>Business portal</span></a>
      <nav class="mp-nav" aria-label="Portal">${navLinks(section, false)}</nav>
      <div class="mp-side__foot"><span>${state.me.user.name} · ${state.me.user.role === "staff" ? "collaborator" : state.me.user.role}</span><button type="button" data-signout>Sign out</button></div>
    </aside>
    <div class="mp-main">
      <header class="mp-top">
        <a class="mp-top__brand" href="#/overview">Portal</a>
        ${can("records.read")
          ? html`<div class="mp-search" role="search">${icon.search}<input type="search" placeholder="Search inquiries, opportunities, projects, people" aria-label="Search" data-search autocomplete="off"><div class="mp-search__results" data-results hidden></div></div>`
          : html`<div style="flex:1"></div>`}
        ${can("records.write") ? html`<button class="mp-btn mp-btn--primary" data-add aria-label="Add">${icon.plus}<span class="mp-hide-phone">New</span></button>` : ""}
      </header>
      <main class="mp-content" id="view-host"></main>
    </div>
    <nav class="mp-bottom" aria-label="Portal" style="grid-template-columns:repeat(${allowed().length},1fr)">${navLinks(section, true)}</nav>
  </div>`);
  app.querySelector("[data-signout]").addEventListener("click", signOut);
  app.querySelector("[data-add]")?.addEventListener("click", quickAddMenu);
  if (can("records.read")) wireSearch();
}

function wireSearch() {
  const input = app.querySelector("[data-search]");
  const box = app.querySelector("[data-results]");
  let timer;
  let seq = 0;
  input.addEventListener("input", () => {
    clearTimeout(timer);
    const q = input.value.trim();
    if (q.length < 2) return (box.hidden = true);
    timer = setTimeout(async () => {
      const mine = ++seq;
      try {
        const r = await api(`search?q=${encodeURIComponent(q)}`);
        if (mine !== seq) return;
        const group = (title, items, route) => (items.length ? html`<div class="mp-search__group">${title}</div>${items.map((x) => html`<a href="#/${route}/${x.id}"><b>${x.title}</b> <span class="mp-muted">${x.sub ? `· ${x.sub}` : ""}</span></a>`)}` : "");
        const any = r.inquiries.length + r.opportunities.length + r.projects.length + r.contacts.length;
        mount(box, html`${group("Inquiries", r.inquiries, "inquiry")}${group("Opportunities", r.opportunities, "opportunity")}${group("Projects", r.projects, "project")}${group("People", r.contacts, "contact")}${any ? "" : html`<div class="mp-empty" style="padding:10px">No matches for "${q}".</div>`}`);
        box.hidden = false;
      } catch {
        box.hidden = true;
      }
    }, 200);
  });
  input.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      input.value = "";
      box.hidden = true;
      input.blur();
    }
    if (e.key === "Enter") box.querySelector("a")?.click();
  });
  box.addEventListener("click", () => {
    input.value = "";
    box.hidden = true;
  });
}
document.addEventListener("click", (e) => {
  if (!e.target.closest(".mp-search")) document.querySelector("[data-results]")?.setAttribute("hidden", "");
});

// ---------- routing ----------

function parseHash() {
  const raw = location.hash.replace(/^#\/?/, "");
  const [path, qs] = raw.split("?");
  const parts = (path || "overview").split("/").filter(Boolean);
  return { section: parts[0] || "overview", id: parts[1] || null, query: new URLSearchParams(qs || "") };
}

let currentSection = null;
async function route() {
  if (!state.me) return;
  closeSheet();
  const { section, id, query } = parseHash();
  const navSection = SECTION_OF[section] || section;
  const entry = NAV.find((n) => n.key === navSection);
  if (!entry || (entry.perm && !can(entry.perm)) || (section === "contact" && !can("records.read"))) {
    location.hash = "#/overview";
    return;
  }
  if (currentSection !== navSection || !document.getElementById("view-host")) {
    renderShell(navSection);
    currentSection = navSection;
  }
  const view = document.createElement("div");
  document.getElementById("view-host").replaceChildren(view);
  document.title = `${entry.label} · Portal`;
  try {
    if (section === "overview") await overview(view);
    else if (section === "inquiries") await inquiriesView(view, query);
    else if (section === "inquiry") await inquiryView(view, id);
    else if (section === "opportunity") await opportunityView(view, id);
    else if (section === "contact") await contactView(view, id);
    else if (section === "projects") await projectsView(view, query);
    else if (section === "project") await projectView(view, id);
    else if (section === "calendar") await calendarView(view, query);
    else if (section === "settings") await settingsView(view);
    window.scrollTo({ top: 0 });
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) return;
    mount(view, html`<div class="mp-card mp-panel"><p class="mp-empty"><b>${err.status === 404 ? "Not found." : "That didn't load."}</b> ${err.message}</p><a class="mp-btn" href="#/overview">Back to overview</a></div>`);
  }
}

async function refreshBadge() {
  try {
    const { counts } = await api("tasks?view=overdue");
    if (counts.overdue === overdue) return;
    overdue = counts.overdue;
    document.querySelectorAll('.mp-nav a[href="#/calendar"], .mp-bottom a[href="#/calendar"]').forEach((a) => {
      a.querySelector(".mp-count")?.remove();
      if (overdue) a.insertAdjacentHTML("beforeend", `<span class="mp-count mp-count--alert">${overdue}</span>`);
    });
  } catch {}
}

// ---------- session ----------

async function signOut() {
  try {
    await api("logout", { method: "POST" });
  } catch {}
  state.me = null;
  currentSection = null;
  renderLogin("Signed out.");
}

async function boot() {
  try {
    state.me = await api("me");
    state.config = state.me.config;
  } catch (err) {
    state.me = null;
    renderLogin(err.status === 401 ? "" : err.message);
    return;
  }
  currentSection = null;
  await refreshBadge();
  await route();
}

window.addEventListener("hashchange", route);
window.addEventListener("portal:refresh", async () => {
  await refreshBadge();
  const y = window.scrollY;
  await route();
  window.scrollTo({ top: y });
});
window.addEventListener("portal:signout", signOut);
window.addEventListener("portal:signedout", (e) => {
  if (!state.me) return;
  state.me = null;
  currentSection = null;
  closeSheet();
  renderLogin(e.detail || "Your session ended. Please sign in again.");
});
document.addEventListener("keydown", (e) => {
  if (!state.me || document.getElementById("sheet").open) return;
  const typing = /input|textarea|select/i.test(document.activeElement?.tagName || "");
  if ((e.key === "/" && !typing) || (e.key.toLowerCase() === "k" && (e.metaKey || e.ctrlKey))) {
    e.preventDefault();
    document.querySelector("[data-search]")?.focus();
  }
});

boot();
