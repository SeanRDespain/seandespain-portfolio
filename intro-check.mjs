// QA for the homepage opening sequence. Slows the page's animation timeline
// down (Chrome DevTools Protocol) so frames can be captured at exact points
// in the sequence, then checks the page is clean and usable once it ends.
//
// usage: node intro-check.mjs <baseUrl> <outDir> [width] [height]
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";

const [base = "http://localhost:4502", outDir = "intro-shots", w = "1440", h = "900"] = process.argv.slice(2);
const width = Number(w);
const height = Number(h);
fs.mkdirSync(outDir, { recursive: true });

const SLOW = 10; // 10x slower than real time
const frames = [150, 600, 1000, 1400, 1750, 1950, 2150, 2400, 2700];

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width, height } });
// stretch the long safety timers by the same factor, so they don't cut the
// slowed-down sequence short
await page.addInitScript((slow) => {
  const orig = window.setTimeout;
  window.setTimeout = (fn, ms, ...rest) => orig(fn, ms >= 4000 ? ms * slow : ms, ...rest);
}, SLOW);
const cdp = await page.context().newCDPSession(page);
await cdp.send("Animation.enable");
await cdp.send("Animation.setPlaybackRate", { playbackRate: 1 / SLOW });

const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));

const t0 = Date.now();
await page.goto(`${base}/?intro`, { waitUntil: "domcontentloaded" });
for (const f of frames) {
  const wait = f * SLOW - (Date.now() - t0);
  if (wait > 0) await page.waitForTimeout(wait);
  await page.screenshot({ path: path.join(outDir, `intro-${width}-${String(f).padStart(4, "0")}.png`) });
}

await cdp.send("Animation.setPlaybackRate", { playbackRate: 1 });
await page.waitForFunction(() => !document.querySelector("[data-intro]"), null, { timeout: 15000 });
await page.waitForTimeout(1200);
await page.screenshot({ path: path.join(outDir, `intro-${width}-end.png`) });

const state = await page.evaluate(() => ({
  introActive: document.documentElement.classList.contains("intro-active"),
  overlay: !!document.querySelector("[data-intro]"),
  seen: sessionStorage.getItem("sd-intro-seen"),
  heroVisible: [...document.querySelectorAll(".hero [data-reveal]")]
    .filter((el) => el.getBoundingClientRect().top < innerHeight * 0.85)
    .every((el) => el.classList.contains("is-visible")),
  auraTransform: getComputedStyle(document.querySelector(".hero__aura")).transform,
  auraOpacity: getComputedStyle(document.querySelector(".hero__aura")).opacity,
}));
console.log("after intro:", JSON.stringify(state));

// second load in the same session: no intro
await page.goto(`${base}/`, { waitUntil: "domcontentloaded" });
const second = await page.evaluate(() => ({
  introActive: document.documentElement.classList.contains("intro-active"),
  overlay: !!document.querySelector("[data-intro]"),
}));
console.log("second load:", JSON.stringify(second));

// skip: a click at ~0.5s should fast-forward the whole thing
const skipPage = await browser.newPage({ viewport: { width, height } });
await skipPage.goto(`${base}/`, { waitUntil: "domcontentloaded" });
await skipPage.waitForTimeout(500);
const clickedAt = await skipPage.evaluate(() => performance.now());
await skipPage.mouse.click(width / 2, height / 2);
await skipPage.waitForFunction(() => !document.querySelector("[data-intro]"), null, { timeout: 10000, polling: 16 });
const goneAt = await skipPage.evaluate(() => performance.now());
console.log("skip: overlay gone", Math.round(goneAt - clickedAt), "ms after the click");

// reduced motion: never plays
const rm = await browser.newPage({ viewport: { width, height }, reducedMotion: "reduce" });
await rm.goto(`${base}/`, { waitUntil: "domcontentloaded" });
console.log("reduced motion:", JSON.stringify(await rm.evaluate(() => ({
  introActive: document.documentElement.classList.contains("intro-active"),
  overlay: !!document.querySelector("[data-intro]"),
}))));

// arriving at a #section link: never plays
const hash = await browser.newPage({ viewport: { width, height } });
await hash.goto(`${base}/#work`, { waitUntil: "domcontentloaded" });
console.log("hash link:", JSON.stringify(await hash.evaluate(() => ({
  introActive: document.documentElement.classList.contains("intro-active"),
}))));

// JS never runs: the CSS failsafe clears the overlay on its own
const nojs = await browser.newPage({ viewport: { width, height } });
await nojs.route(/\.js$/, (route) => route.abort());
await nojs.goto(`${base}/`, { waitUntil: "domcontentloaded" });
await nojs.waitForTimeout(6500);
console.log("module blocked, after 6.5s:", JSON.stringify(await nojs.evaluate(() => {
  const o = document.querySelector("[data-intro]");
  const cs = o && getComputedStyle(o);
  return { introActive: document.documentElement.classList.contains("intro-active"), visibility: cs && cs.visibility, opacity: cs && cs.opacity };
})));

console.log("errors:", errors.length ? errors : "none");
await browser.close();
