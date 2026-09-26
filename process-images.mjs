import sharp from "sharp";
import fs from "node:fs";

const jobs = [
  // Peace Life
  { in: "raw-assets/peace-life/site-hero.png", out: "public/images/peace-life/site-hero.jpg", w: 1600 },
  { in: "raw-assets/peace-life/03_Seven_Stages_Root_To_Crown.webp", out: "public/images/peace-life/screen-seven-stages.jpg", w: 900 },
  { in: "raw-assets/peace-life/04_75_Plus_Guided_Practices_Inside.webp", out: "public/images/peace-life/screen-practices.jpg", w: 900 },
  { in: "raw-assets/peace-life/05_Learn_Reiki_Hand_Positions.webp", out: "public/images/peace-life/screen-reiki.jpg", w: 900 },
  { in: "raw-assets/peace-life/07_Seven_Layers_Of_You.webp", out: "public/images/peace-life/screen-layers.jpg", w: 900 },
  { in: "raw-assets/peace-life/09_Watch_Your_Progress_Build.webp", out: "public/images/peace-life/screen-progress.jpg", w: 900 },
  { in: "raw-assets/peace-life/peace-life-logo.webp", out: "public/images/peace-life/logo.png", w: 200, png: true },

  // W.I.P Services
  { in: "raw-assets/wip-services/site-hero.png", out: "public/images/wip-services/site-hero.jpg", w: 1600 },
  { in: "raw-assets/wip-services/site-full.png", out: "public/images/wip-services/site-full.jpg", w: 1400 },

  // Qinty
  { in: "raw-assets/qinty/home-en-hero.png", out: "public/images/qinty/home-hero.jpg", w: 1600 },
  { in: "raw-assets/qinty/home-en-full.png", out: "public/images/qinty/home-full.jpg", w: 1400 },
  { in: "raw-assets/qinty/home-es-hero.png", out: "public/images/qinty/home-es-hero.jpg", w: 1600 },

  // Once Upon a Princess
  { in: "raw-assets/once-upon-a-princess/home-hero.png", out: "public/images/once-upon-a-princess/home-hero.jpg", w: 1600 },
  { in: "raw-assets/once-upon-a-princess/princess-detail.png", out: "public/images/once-upon-a-princess/princess-detail.jpg", w: 1400 },
  { in: "raw-assets/once-upon-a-princess/booking-form.png", out: "public/images/once-upon-a-princess/booking-form.jpg", w: 1400 },
];

for (const job of jobs) {
  if (!fs.existsSync(job.in)) {
    console.warn("MISSING", job.in);
    continue;
  }
  fs.mkdirSync(job.out.split("/").slice(0, -1).join("/"), { recursive: true });
  let pipeline = sharp(job.in).resize({ width: job.w, withoutEnlargement: true });
  pipeline = job.png ? pipeline.png({ quality: 90 }) : pipeline.jpeg({ quality: 82 });
  await pipeline.toFile(job.out);
  console.log("Wrote", job.out);
}
