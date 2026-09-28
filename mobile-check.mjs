import { chromium } from "playwright";

const browser = await chromium.launch();

// mobile, normal motion
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
await page.goto("http://localhost:4500/", { waitUntil: "networkidle" });
const h = await page.evaluate(() => document.body.scrollHeight);
for (let y = 0; y < h; y += 300) {
  await page.evaluate((y) => window.scrollTo(0, y), y);
  await page.waitForTimeout(80);
}
await page.evaluate(() => window.scrollTo(0, 0));
await page.waitForTimeout(300);
await page.screenshot({ path: "raw-assets/mobile-home.png", fullPage: true });

await page.goto("http://localhost:4500/work/peace-life/", { waitUntil: "networkidle" });
const h2 = await page.evaluate(() => document.body.scrollHeight);
for (let y = 0; y < h2; y += 300) {
  await page.evaluate((y) => window.scrollTo(0, y), y);
  await page.waitForTimeout(80);
}
await page.evaluate(() => window.scrollTo(0, 0));
await page.waitForTimeout(300);
await page.screenshot({ path: "raw-assets/mobile-case.png", fullPage: true });
await page.close();

// reduced motion
const page2 = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" });
await page2.goto("http://localhost:4500/", { waitUntil: "networkidle" });
await page2.waitForTimeout(400);
await page2.screenshot({ path: "raw-assets/reduced-motion-home.png", fullPage: true });
await page2.close();

await browser.close();
console.log("done");
