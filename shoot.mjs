import { chromium } from "playwright";
import fs from "node:fs";

const jobs = JSON.parse(fs.readFileSync(process.argv[2], "utf-8"));

const browser = await chromium.launch();
for (const job of jobs) {
  const page = await browser.newPage({ viewport: { width: job.width || 1440, height: job.height || 900 } });
  await page.goto(job.url, { waitUntil: "networkidle", timeout: 30000 });
  if (job.waitMs) await page.waitForTimeout(job.waitMs);
  await page.screenshot({ path: job.out, fullPage: !!job.fullPage });
  await page.close();
  console.log("Shot:", job.out);
}
await browser.close();
