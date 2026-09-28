import { chromium } from "playwright";

const [, , url, out, width = 1440, height = 900] = process.argv;
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: Number(width), height: Number(height) } });
await page.goto(url, { waitUntil: "networkidle" });

const docHeight = await page.evaluate(() => document.body.scrollHeight);
for (let y = 0; y < docHeight; y += 400) {
  await page.evaluate((y) => window.scrollTo(0, y), y);
  await page.waitForTimeout(100);
}
await page.evaluate(() => window.scrollTo(0, 0));
await page.waitForTimeout(300);

await page.screenshot({ path: out, fullPage: true });
await browser.close();
console.log("done:", out);
