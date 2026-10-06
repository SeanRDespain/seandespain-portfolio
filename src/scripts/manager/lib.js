// Shared client helpers for the manager portal: API calls, escaped HTML
// templating (every value is escaped unless explicitly marked raw), number
// and date formatting, small SVG charts, the form sheet, and toasts.

export const state = { me: null, config: null, period: "30d" };
export const can = (p) => Boolean(state.me?.permissions?.includes(p));

// ---------- API ----------

export class ApiError extends Error {
  constructor(message, status, detail) {
    super(message);
    this.status = status;
    this.detail = detail || {};
  }
}

export async function api(path, { method = "GET", body } = {}) {
  const headers = { Accept: "application/json" };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (method !== "GET") headers["X-Portal-Request"] = "1";
  let res;
  try {
    res = await fetch(`/api/manager/${path}`, { method, credentials: "same-origin", headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  } catch {
    throw new ApiError("Can't reach the server. Check your connection.", 0);
  }
  let data = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  if (res.status === 401 && path !== "login") {
    window.dispatchEvent(new CustomEvent("portal:signedout", { detail: data?.error?.message }));
  }
  if (!res.ok) throw new ApiError(data?.error?.message || `Request failed (${res.status}).`, res.status, data?.error);
  return data;
}

// ---------- safe HTML ----------

class Raw {
  constructor(s) {
    this.s = s;
  }
  toString() {
    return this.s;
  }
}
export const raw = (s) => new Raw(String(s));
export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
function part(v) {
  if (v == null || v === false || v === true) return "";
  if (v instanceof Raw) return v.s;
  if (Array.isArray(v)) return v.map(part).join("");
  return esc(v);
}
export function html(strings, ...vals) {
  return new Raw(strings.reduce((out, s, i) => out + s + (i < vals.length ? part(vals[i]) : ""), ""));
}
export const toHtml = (r) => part(r);
export function mount(el, content) {
  el.innerHTML = toHtml(content);
}

// ---------- formatting ----------

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
export const fmt = {
  money(n, { compact = false } = {}) {
    if (n == null) return "-";
    if (compact && Math.abs(n) >= 1000) {
      const k = n / 1000;
      return `$${k >= 100 ? Math.round(k) : Math.round(k * 10) / 10}k`;
    }
    return usd.format(n);
  },
  num: (n) => (n == null ? "-" : new Intl.NumberFormat("en-US").format(n)),
  pct: (r) => (r == null ? "-" : `${Math.round(r * 100)}%`),
  hours(h) {
    if (h == null) return "-";
    if (h < 1) return `${Math.max(1, Math.round(h * 60))}m`;
    if (h < 48) return `${Math.round(h * 10) / 10}h`;
    return `${Math.round((h / 24) * 10) / 10}d`;
  },
  date(iso) {
    if (!iso) return "-";
    const d = new Date(iso);
    const sameYear = d.getFullYear() === new Date().getFullYear();
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric", ...(sameYear ? {} : { year: "numeric" }) });
  },
  dateTime(iso) {
    if (!iso) return "-";
    const d = new Date(iso);
    return `${fmt.date(iso)}, ${d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`;
  },
  rel(iso) {
    if (!iso) return "-";
    const diff = Date.parse(iso) - Date.now();
    const abs = Math.abs(diff);
    const mins = Math.round(abs / 60000);
    const future = diff > 0;
    if (mins < 1) return "just now";
    if (mins < 60) return future ? `in ${mins}m` : `${mins}m ago`;
    const hrs = Math.round(mins / 60);
    if (hrs < 24) return future ? `in ${hrs}h` : `${hrs}h ago`;
    const days = Math.round(hrs / 24);
    if (days === 1) return future ? "tomorrow" : "yesterday";
    if (days < 14) return future ? `in ${days} days` : `${days} days ago`;
    return fmt.date(iso);
  },
  due(iso) {
    if (!iso) return "No date";
    const d = new Date(iso);
    const today = new Date();
    const start = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
    const days = Math.round((start(d) - start(today)) / 86400000);
    const time = d.getHours() || d.getMinutes() ? ` ${d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}` : "";
    if (days === 0) return `Today${time}`;
    if (days === 1) return `Tomorrow${time}`;
    if (days === -1) return `Yesterday`;
    if (days < 0) return `${-days} days late`;
    if (days < 7) return `${d.toLocaleDateString("en-US", { weekday: "short" })}${time}`;
    return fmt.date(iso);
  },
  initials: (name) => (name || "?").split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase(),
};

export const label = (listName, key) => (state.config?.[listName] || []).find(([k]) => k === key)?.[1] ?? key ?? "-";
export const pipeline = (kind) => state.config.pipelines[kind];
export const stage = (kind, key) => pipeline(kind)?.stages.find((s) => s.key === key);

// ---------- icons ----------

const svg = (d) => raw(`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`);
export const icon = {
  overview: svg('<rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/>'),
  pipeline: svg('<path d="M4 5h16M7 12h10M10 19h4"/>'),
  people: svg('<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.8-3.5 3.4-5.5 6.5-5.5s5.7 2 6.5 5.5"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7M18 14.8c1.9.7 3.1 2.4 3.5 5.2"/>'),
  tasks: svg('<rect x="3.5" y="3.5" width="17" height="17" rx="3"/><path d="m8 12 3 3 5-6"/>'),
  money: svg('<path d="M12 3v18M16.5 7.5c0-1.7-2-3-4.5-3s-4.5 1.3-4.5 3S9.5 10.5 12 11s4.5 1.3 4.5 3.3-2 3.2-4.5 3.2-4.5-1.3-4.5-3"/>'),
  analytics: svg('<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>'),
  activity: svg('<path d="M3 12h4l3-8 4 16 3-8h4"/>'),
  settings: svg('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>'),
  search: svg('<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>'),
  plus: svg('<path d="M12 5v14M5 12h14"/>'),
  check: svg('<path d="m5 12.5 4.5 4.5L19 7.5"/>'),
  chevron: svg('<path d="m9 6 6 6-6 6"/>'),
  more: svg('<circle cx="5" cy="12" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="19" cy="12" r="1.4"/>'),
  mail: svg('<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3.5 6.5 8.5 6.5 8.5-6.5"/>'),
  phone: svg('<path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2"/>'),
  note: svg('<path d="M5 4h14v12l-4 4H5z"/><path d="M15 20v-4h4M9 9h6M9 13h4"/>'),
};

// ---------- charts (plain SVG, no library) ----------

export function sparkline(values = [], { w = 120, h = 36, color = "#4f5bd5" } = {}) {
  if (!values.length) return "";
  const max = Math.max(...values, 1);
  const step = values.length > 1 ? w / (values.length - 1) : w;
  const pts = values.map((v, i) => [i * step, h - 3 - (v / max) * (h - 6)]);
  const line = pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const id = `g${Math.random().toString(36).slice(2, 8)}`;
  return raw(
    `<svg class="mp-spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true"><defs><linearGradient id="${id}" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="${color}" stop-opacity=".22"/><stop offset="1" stop-color="${color}" stop-opacity="0"/></linearGradient></defs><polygon points="0,${h} ${line} ${w},${h}" fill="url(#${id})"/><polyline points="${line}" fill="none" stroke="${color}" stroke-width="1.8" vector-effect="non-scaling-stroke"/></svg>`,
  );
}

export function lineChart(points, { h = 170, color = "#4f5bd5", format = fmt.num } = {}) {
  if (!points.length) return html`<p class="mp-empty">No data for this period yet.</p>`;
  const w = 640;
  const pad = { l: 34, r: 8, t: 10, b: 22 };
  const max = Math.max(...points.map((p) => p.value), 1);
  const iw = w - pad.l - pad.r;
  const ih = h - pad.t - pad.b;
  const x = (i) => pad.l + (points.length > 1 ? (i / (points.length - 1)) * iw : iw / 2);
  const y = (v) => pad.t + ih - (v / max) * ih;
  const line = points.map((p, i) => `${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(" ");
  const grid = [0, 0.5, 1].map((f) => `<line x1="${pad.l}" x2="${w - pad.r}" y1="${y(max * f)}" y2="${y(max * f)}" stroke="#ece8df"/><text x="${pad.l - 6}" y="${y(max * f) + 3}" text-anchor="end">${esc(format(Math.round(max * f)))}</text>`).join("");
  return raw(
    `<svg class="mp-chart" viewBox="0 0 ${w} ${h}" role="img" aria-label="Trend chart">${grid}<polygon points="${pad.l},${pad.t + ih} ${line} ${x(points.length - 1)},${pad.t + ih}" fill="${color}" fill-opacity=".08"/><polyline points="${line}" fill="none" stroke="${color}" stroke-width="2"/><text x="${pad.l}" y="${h - 5}">${esc(points[0].label)}</text><text x="${w - pad.r}" y="${h - 5}" text-anchor="end">${esc(points[points.length - 1].label)}</text></svg>`,
  );
}

export function columnChart(points, { h = 160, color = "#2f7d5b", format = (v) => fmt.money(v, { compact: true }) } = {}) {
  const w = 640;
  const pad = { l: 40, r: 6, t: 10, b: 22 };
  const max = Math.max(...points.map((p) => p.value), 1);
  const iw = w - pad.l - pad.r;
  const ih = h - pad.t - pad.b;
  const bw = iw / points.length;
  const bars = points
    .map((p, i) => {
      const bh = (p.value / max) * ih;
      return `<rect x="${(pad.l + i * bw + bw * 0.18).toFixed(1)}" y="${(pad.t + ih - bh).toFixed(1)}" width="${(bw * 0.64).toFixed(1)}" height="${Math.max(bh, p.value ? 2 : 0).toFixed(1)}" rx="3" fill="${color}"><title>${esc(p.label)}: ${esc(format(p.value))}</title></rect><text x="${(pad.l + i * bw + bw / 2).toFixed(1)}" y="${h - 6}" text-anchor="middle">${esc(p.short || p.label)}</text>`;
    })
    .join("");
  return raw(`<svg class="mp-chart" viewBox="0 0 ${w} ${h}" role="img" aria-label="Column chart"><line x1="${pad.l}" x2="${w - pad.r}" y1="${pad.t + ih}" y2="${pad.t + ih}" stroke="#ece8df"/><text x="${pad.l - 6}" y="${pad.t + 8}" text-anchor="end">${esc(format(max))}</text>${bars}</svg>`);
}

export function barList(items, { valueLabel = (i) => fmt.num(i.value), empty = "Nothing here yet." } = {}) {
  if (!items.length) return html`<p class="mp-empty">${empty}</p>`;
  const max = Math.max(...items.map((i) => i.value), 1);
  return html`<div class="mp-bars">${items.map(
    (i) => html`<div class="mp-bars__row"><span>${i.label}</span><span class="mp-bars__track"><span style="width:${raw(((i.value / max) * 100).toFixed(1))}%"></span></span><span class="mp-bars__num">${valueLabel(i)}</span></div>`,
  )}</div>`;
}

// ---------- toast ----------

let toastTimer;
export function toast(message, kind = "ok") {
  const el = document.getElementById("toast");
  el.textContent = message;
  el.dataset.kind = kind;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.hidden = true), 3200);
}

// ---------- sheet + forms ----------

export function closeSheet() {
  const d = document.getElementById("sheet");
  if (d.open) d.close();
  d.innerHTML = "";
}

function toLocalInput(iso, withTime) {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n) => String(n).padStart(2, "0");
  const date = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  return withTime ? `${date}T${pad(d.getHours())}:${pad(d.getMinutes())}` : date;
}

function fieldHtml(f) {
  const id = `f_${f.name}`;
  const req = f.required ? raw(" required") : "";
  const opt = f.optional ? html` <em>(optional)</em>` : "";
  if (f.type === "hidden") return html`<input type="hidden" name="${f.name}" value="${f.value ?? ""}">`;
  if (f.type === "radio") {
    return html`<fieldset><legend>${f.label}</legend>${f.options.map(([k, l]) => html`<label><input type="radio" name="${f.name}" value="${k}"${k === f.value ? raw(" checked") : ""}${req}> ${l}</label>`)}</fieldset>`;
  }
  if (f.type === "checks") {
    return html`<fieldset><legend>${f.label}</legend>${f.options.map(([k, l]) => html`<label><input type="checkbox" name="${f.name}" value="${k}"${(f.value || []).includes(k) ? raw(" checked") : ""}> ${l}</label>`)}</fieldset>`;
  }
  let control;
  if (f.type === "select") {
    control = html`<select class="mp-select" id="${id}" name="${f.name}"${req}>${f.required ? "" : html`<option value="">${f.placeholder || "Not set"}</option>`}${f.options.map(([k, l]) => html`<option value="${k}"${k === f.value ? raw(" selected") : ""}>${l}</option>`)}</select>`;
  } else if (f.type === "textarea") {
    control = html`<textarea class="mp-textarea" id="${id}" name="${f.name}" rows="${f.rows || 4}" maxlength="${f.max || 4000}" placeholder="${f.placeholder || ""}"${req}>${f.value ?? ""}</textarea>`;
  } else if (f.type === "date" || f.type === "datetime") {
    control = html`<input class="mp-input" id="${id}" type="${f.type === "date" ? "date" : "datetime-local"}" name="${f.name}" value="${toLocalInput(f.value, f.type === "datetime")}"${req}>`;
  } else if (f.type === "money") {
    control = html`<input class="mp-input" id="${id}" inputmode="decimal" name="${f.name}" value="${f.value ?? ""}" placeholder="${f.placeholder || "$0"}"${req}>`;
  } else {
    control = html`<input class="mp-input" id="${id}" type="${f.type || "text"}" name="${f.name}" value="${f.value ?? ""}" maxlength="${f.max || 200}" placeholder="${f.placeholder || ""}" autocomplete="off"${req}>`;
  }
  return html`<label for="${id}"><span>${f.label}${opt}</span>${control}</label>`;
}

/**
 * Open a form in the sheet. `fields` may contain arrays to put two fields on
 * one row. `onSubmit(values)` may throw an ApiError; its message is shown.
 */
export function formSheet({ title, intro = null, fields, submitLabel = "Save", onSubmit, danger = null }) {
  const d = document.getElementById("sheet");
  const flat = fields.flat().filter(Boolean);
  d.innerHTML = toHtml(html`<form class="mp-form" novalidate>
    <h2 id="sheet-title">${title}</h2>
    ${intro ? html`<p class="mp-sub">${intro}</p>` : ""}
    ${fields.filter(Boolean).map((f) => (Array.isArray(f) ? html`<div class="mp-form__row">${f.filter(Boolean).map(fieldHtml)}</div>` : fieldHtml(f)))}
    <p class="mp-form__err" hidden></p>
    <div class="mp-form__foot">
      ${danger ? html`<button type="button" class="mp-btn mp-btn--danger" data-danger style="margin-right:auto">${danger.label}</button>` : ""}
      <button type="button" class="mp-btn" data-cancel>Cancel</button>
      <button type="submit" class="mp-btn mp-btn--primary">${submitLabel}</button>
    </div>
  </form>`);
  const form = d.querySelector("form");
  const err = form.querySelector(".mp-form__err");
  form.querySelector("[data-cancel]").addEventListener("click", closeSheet);
  if (danger) form.querySelector("[data-danger]").addEventListener("click", async () => { await danger.onClick(); closeSheet(); });
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!form.reportValidity()) return;
    const values = {};
    for (const f of flat) {
      if (f.type === "checks") values[f.name] = [...form.querySelectorAll(`input[name="${f.name}"]:checked`)].map((i) => i.value);
      else if (f.type === "radio") values[f.name] = form.querySelector(`input[name="${f.name}"]:checked`)?.value || "";
      else {
        const val = form.elements[f.name]?.value ?? "";
        if ((f.type === "date" || f.type === "datetime") && val) values[f.name] = new Date(f.type === "date" ? `${val}T12:00` : val).toISOString();
        else values[f.name] = val;
      }
    }
    const btn = form.querySelector("button[type=submit]");
    btn.disabled = true;
    err.hidden = true;
    try {
      await onSubmit(values);
      closeSheet();
    } catch (ex) {
      err.textContent = ex.message || "That didn't save.";
      err.hidden = false;
    } finally {
      btn.disabled = false;
    }
  });
  d.addEventListener("close", () => (d.innerHTML = ""), { once: true });
  d.showModal();
  form.querySelector("input:not([type=hidden]):not([type=radio]), select, textarea")?.focus();
}

export function confirmSheet({ title, body, confirmLabel = "Confirm", onConfirm }) {
  formSheet({ title, intro: body, fields: [], submitLabel: confirmLabel, onSubmit: onConfirm });
}

export function nextWeekday(days = 1, hour = 9) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  d.setHours(hour, 0, 0, 0);
  return d.toISOString();
}
