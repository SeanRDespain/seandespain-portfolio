// First-party attribution for the inquiry form.
//
// Remembers, in this browser only, how the visitor first arrived (first
// touch), how they arrived most recently (latest touch), and which pages they
// read. Nothing is sent anywhere unless they submit the inquiry form, and it
// holds no personal information: UTM tags, a referring site, and page paths.
// It's how the portal can say "this lead came from LinkedIn and read the
// Jarvis case study first" without anyone typing it in.
const FIRST = "sd_first_touch";
const LATEST = "sd_latest_touch";
const PAGES = "sd_pages";
const SESSION = "sd_session_seen";
const MAX_PAGES = 25;
const KEEP_MS = 60 * 86_400_000;

function safe(fn, fallback = null) {
  try {
    return fn();
  } catch (e) {
    return fallback;
  }
}

function currentTouch() {
  const params = new URLSearchParams(location.search);
  const touch = { landing_page: location.pathname, at: new Date().toISOString() };
  for (const k of ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"]) {
    const val = params.get(k);
    if (val) touch[k] = val.slice(0, 150);
  }
  const ref = document.referrer;
  if (ref && safe(() => new URL(ref).host !== location.host, false)) touch.referrer = ref.slice(0, 500);
  return touch;
}

if (!location.pathname.startsWith("/manager")) {
  safe(() => {
    const touch = currentTouch();
    const hasCampaign = Boolean(touch.utm_source);
    const newSession = !sessionStorage.getItem(SESSION);
    if (!localStorage.getItem(FIRST)) localStorage.setItem(FIRST, JSON.stringify(touch));
    if (newSession || hasCampaign) localStorage.setItem(LATEST, JSON.stringify(touch));
    sessionStorage.setItem(SESSION, "1");

    const now = Date.now();
    const pages = (safe(() => JSON.parse(localStorage.getItem(PAGES)), []) || []).filter((p) => now - p.at < KEEP_MS && p.p !== location.pathname);
    pages.push({ p: location.pathname, at: now });
    localStorage.setItem(PAGES, JSON.stringify(pages.slice(-MAX_PAGES)));
  });
}

/** What the inquiry form attaches to a submission. */
export function getAttribution() {
  return safe(
    () => ({
      first: JSON.parse(localStorage.getItem(FIRST) || "null"),
      latest: JSON.parse(localStorage.getItem(LATEST) || "null"),
      pages: (JSON.parse(localStorage.getItem(PAGES) || "[]") || []).map((x) => x.p),
    }),
    { first: null, latest: null, pages: [] },
  );
}
