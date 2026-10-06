// Manager portal entry: sign-in, the shell (sidebar on desktop, bottom tabs
// on phones), hash routing, global search, and keyboard shortcuts.
import { api, state, can, html, raw, mount, fmt, icon, toast, closeSheet, ApiError } from "./lib.js";
import { quickAddMenu } from "./actions.js";
import { overview } from "./view-overview.js";
import { pipelineView, opportunityView } from "./view-pipeline.js";
import { peopleView, contactView } from "./view-people.js";
import { tasksView, moneyView, analyticsView, activityView, settingsView } from "./view-more.js";

const app = document.getElementById("app");
try {
  state.period = localStorage.getItem("mp_period") || "30d";
} catch {}

const NAV = [
  { key: "overview", label: "Overview", icon: icon.overview, perm: "crm.read", mobile: true },
  { key: "pipeline", label: "Pipeline", icon: icon.pipeline, perm: "crm.read", mobile: true },
  { key: "people", label: "People", icon: icon.people, perm: "crm.read", mobile: true },
  { key: "tasks", label: "Tasks", icon: icon.tasks, perm: "tasks.read", mobile: true },
  { key: "money", label: "Money", icon: icon.money, perm: "finance.read" },
  { key: "analytics", label: "Analytics", icon: icon.analytics, perm: "analytics.read" },
  { key: "activity", label: "Activity", icon: icon.activity, perm: "activity.read" },
  { key: "settings", label: "Settings", icon: icon.settings, perm: null },
];
const SECTION_OF = { opportunity: "pipeline", contact: "people", more: "more" };

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
      <h1>Manager <em>portal</em></h1>
      <label>Password<input type="password" name="password" autocomplete="current-password" required autofocus></label>
      <button type="submit">Sign in</button>
      <p class="mp-login__msg" role="alert">${message}</p>
      <p class="mp-login__note">Private. Sign-in attempts are rate limited.</p>
    </form>
  </main>`);
  const form = app.querySelector("form");
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const msg = form.querySelector(".mp-login__msg");
    const btn = form.querySelector("button");
    const password = form.elements.password.value;
    if (!password) {
      msg.textContent = "Enter your password.";
      return;
    }
    btn.disabled = true;
    msg.textContent = "";
    try {
      await api("login", { method: "POST", body: { password } });
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

let badges = { overdue: 0, suggested: 0 };

function navLinks(current, { mobile = false } = {}) {
  const items = NAV.filter((n) => !n.perm || can(n.perm)).filter((n) => !mobile || n.mobile);
  return items.map((n) => {
    const count = n.key === "tasks" && badges.overdue ? html`<span class="mp-count mp-count--alert">${badges.overdue}</span>` : "";
    return html`<a href="#/${n.key}" ${current === n.key ? raw('aria-current="page"') : ""}>${n.icon}<span>${n.label}</span>${count}</a>`;
  });
}

function renderShell(section) {
  app.className = "";
  mount(app, html`<div class="mp-shell">
    <aside class="mp-side">
      <a class="mp-brand" href="#/overview"><b>Sean Despain</b><span>Manager portal</span></a>
      <nav class="mp-nav" aria-label="Portal">${navLinks(section)}</nav>
      <div class="mp-side__foot"><span>${state.me.user.name} · ${state.me.user.role.replace("_", " ")}</span><button type="button" data-signout>Sign out</button></div>
    </aside>
    <div class="mp-main">
      <header class="mp-top">
        <a class="mp-top__brand" href="#/overview">Portal</a>
        <div class="mp-search" role="search">
          ${icon.search}
          <input type="search" placeholder="Search people and opportunities" aria-label="Search" data-search autocomplete="off">
          <div class="mp-search__results" data-results hidden></div>
        </div>
        ${can("crm.write") ? html`<button class="mp-btn mp-btn--primary" data-add aria-label="Add">${icon.plus}<span class="mp-hide-phone">New</span></button>` : ""}
      </header>
      <main class="mp-content" id="view-host"></main>
    </div>
    <nav class="mp-bottom" aria-label="Portal">${navLinks(section, { mobile: true })}<a href="#/more" ${section === "more" ? raw('aria-current="page"') : ""}>${icon.more}<span>More</span></a></nav>
  </div>`);
  app.querySelector("[data-signout]").addEventListener("click", signOut);
  app.querySelector("[data-add]")?.addEventListener("click", quickAddMenu);
  wireSearch();
}

function moreView(el) {
  mount(el, html`<header class="mp-head"><div><p class="mp-eyebrow">More</p><h1>Everything <em>else.</em></h1></div></header>
    <nav class="mp-card mp-panel"><ul class="mp-list">${NAV.filter((n) => !n.mobile && (!n.perm || can(n.perm))).map((n) => html`<li><a href="#/${n.key}" style="display:flex;gap:12px;align-items:center;padding:14px 4px;text-decoration:none;font-size:16px"><span style="width:22px;height:22px;display:inline-grid">${n.icon}</span>${n.label}</a></li>`)}
      <li><button type="button" data-signout2 style="all:unset;cursor:pointer;display:block;padding:14px 4px;font-size:16px;color:var(--mp-bad)">Sign out</button></li></ul></nav>`);
  el.querySelector("[data-signout2]").addEventListener("click", signOut);
}

// ---------- search ----------

function wireSearch() {
  const input = app.querySelector("[data-search]");
  const box = app.querySelector("[data-results]");
  let timer;
  let seq = 0;
  const hide = () => (box.hidden = true);
  input.addEventListener("input", () => {
    clearTimeout(timer);
    const q = input.value.trim();
    if (q.length < 2) return hide();
    timer = setTimeout(async () => {
      const mine = ++seq;
      try {
        const r = await api(`search?q=${encodeURIComponent(q)}`);
        if (mine !== seq) return;
        mount(box, html`
          ${r.opportunities.length ? html`<div class="mp-search__group">Opportunities</div>${r.opportunities.map((o) => html`<a href="#/opportunity/${o.id}"><b>${o.title}</b> <span class="mp-muted">· ${o.stageLabel}${o.contactName ? ` · ${o.contactName}` : ""}</span></a>`)}` : ""}
          ${r.contacts.length ? html`<div class="mp-search__group">People</div>${r.contacts.map((c) => html`<a href="#/contact/${c.id}"><b>${c.name}</b> <span class="mp-muted">${c.company ? `· ${c.company}` : ""}${c.email ? ` · ${c.email}` : ""}</span></a>`)}` : ""}
          ${!r.opportunities.length && !r.contacts.length ? html`<div class="mp-empty" style="padding:10px">No matches for "${q}".</div>` : ""}
        `);
        box.hidden = false;
      } catch {
        hide();
      }
    }, 200);
  });
  input.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      input.value = "";
      hide();
      input.blur();
    }
    if (e.key === "Enter") box.querySelector("a")?.click();
  });
  box.addEventListener("click", () => {
    input.value = "";
    hide();
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
  const allowed = NAV.find((n) => n.key === navSection);
  if (navSection !== "more" && (!allowed || (allowed.perm && !can(allowed.perm)))) {
    location.hash = "#/overview";
    return;
  }
  if (currentSection !== navSection || !document.getElementById("view-host")) {
    renderShell(navSection);
    currentSection = navSection;
  }
  const host = document.getElementById("view-host");
  // a fresh element per render, so listeners from the last view never linger
  const view = document.createElement("div");
  host.replaceChildren(view);
  document.title = `${(NAV.find((n) => n.key === navSection) || { label: "More" }).label} · Portal`;
  try {
    if (section === "overview") await overview(view);
    else if (section === "pipeline") await pipelineView(view, query);
    else if (section === "opportunity") await opportunityView(view, id);
    else if (section === "people") await peopleView(view, query);
    else if (section === "contact") await contactView(view, id);
    else if (section === "tasks") await tasksView(view, query);
    else if (section === "money") await moneyView(view, query);
    else if (section === "analytics") await analyticsView(view, query);
    else if (section === "activity") await activityView(view);
    else if (section === "settings") await settingsView(view);
    else if (section === "more") moreView(view);
    window.scrollTo({ top: 0 });
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) return;
    mount(view, html`<div class="mp-card mp-panel"><p class="mp-empty"><b>${err.status === 404 ? "Not found." : "That didn't load."}</b> ${err.message}</p><a class="mp-btn" href="#/overview">Back to overview</a></div>`);
  }
}

async function refreshBadges() {
  if (!can("tasks.read")) return;
  try {
    const { counts } = await api("tasks?view=overdue");
    const changed = counts.overdue !== badges.overdue;
    badges = counts;
    if (changed && currentSection) {
      document.querySelectorAll('.mp-nav a[href="#/tasks"], .mp-bottom a[href="#/tasks"]').forEach((a) => {
        a.querySelector(".mp-count")?.remove();
        if (badges.overdue) a.insertAdjacentHTML("beforeend", `<span class="mp-count mp-count--alert">${badges.overdue}</span>`);
      });
    }
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
  await refreshBadges();
  await route();
}

window.addEventListener("hashchange", route);
window.addEventListener("portal:refresh", async () => {
  await refreshBadges();
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
  if (e.key.toLowerCase() === "n" && !typing && !e.metaKey && !e.ctrlKey && can("crm.write")) quickAddMenu();
});

boot();
