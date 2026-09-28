import { chromium } from "playwright";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto("http://localhost:4500/work/peace-life/", { waitUntil: "networkidle" });

const buildTop = await page.evaluate(() => document.getElementById("build").offsetTop);
await page.evaluate((y) => window.scrollTo(0, y - 200), buildTop);
await page.waitForTimeout(600);

const active = await page.evaluate(() => document.querySelector(".case__rail a.is-active")?.textContent || null);
console.log("active chapter after scrolling to Build:", active);

// click a rail link and confirm it scrolls
await page.click('.case__rail a[href="#outcome"]');
await page.waitForTimeout(700);
const scrollY = await page.evaluate(() => window.scrollY);
const activeAfterClick = await page.evaluate(() => document.querySelector(".case__rail a.is-active")?.textContent || null);
console.log("scrollY after clicking Outcome:", scrollY, "active:", activeAfterClick);

await browser.close();
