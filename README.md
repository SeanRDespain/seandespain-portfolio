# Sean Despain: Portfolio

Personal portfolio site: Astro static build, five case studies (Peace Life, Jarvis, W.I.P Services,
Qinty, Once Upon a Princess) sourced from `src/data/projects.js`.

## Running it

```bash
npm install
npm run dev
```

Opens on `http://localhost:4500`.

| Command | What it does |
| --- | --- |
| `npm run dev` | Dev server on port 4500 |
| `npm run build` | Static build into `dist/` |
| `npm run preview` | Serve the built site on port 4501 |

## Content model

Everything project-related lives in `src/data/projects.js`, one object per venture, reused by both
the homepage tiles and the `/work/[slug]/` case study pages. Edit that file to update copy; no page
template needs to change. The full audit trail behind every claim in it is in
`../sean-despain-career/evidence-map.md`.

## Design system

Tokens in `src/styles/tokens.css`. The shell (ink / paper / graphite) stays neutral on purpose: each
project's card and case study carries its own accent color, sampled from that venture's real brand
(Peace Life gold/teal, Jarvis and W.I.P gold/deep-green, Qinty forest/terracotta, Once Upon a Princess
lavender/plum), never a color invented for this site.

Type: Instrument Serif (display/headlines), Public Sans (body), IBM Plex Mono (labels/eyebrows/nav).

## Images

Real screenshots only, no stock photography, no fabricated UI. Sources:
- Peace Life: real App Store screenshot assets from the peacelifehealing.com repo, plus a live
  screenshot of the marketing site.
- W.I.P Services, Qinty, Once Upon a Princess: live/local screenshots taken with Playwright
  (`shoot.mjs` + `process-images.mjs`, raw captures kept in `raw-assets/` and not deployed).
- Jarvis: an existing sanitized smoke-test screenshot from the Jarvis repo, explicitly labeled
  "Mock Data: Fallback" in the UI itself. The live product's real client/payroll data is never
  shown here. See the note on the Jarvis case study page.

## Résumé

`public/resume/` holds the master résumé plus all six role-specific variants, each as a PDF (what the
site links to) and a `.docx` (for application portals that want Word). Both formats are generated
from the same markdown in `sean-despain-career/`:

```
cd ../sean-despain-career/tools
node generate-resume-pdf.mjs --all          # every PDF into ../output
node generate-resume.mjs ../X.md ../output/Y.docx
```

Then copy the changed files from `sean-despain-career/output/` into `public/resume/`. The site links
to the hybrid product/creative-technology version by default; swap the linked filename in
`Header.astro`, `Footer.astro`, `index.astro`, `about/index.astro`, and `contact/index.astro` if a
different variant fits better.

## Analytics

Google Analytics 4 (`G-ZMM05DKGDB`) is set up in `src/layouts/Layout.astro`, so it's on every page.
Each page is a full page load, so the standard tag records one page view per page with no extra
routing code. It only reports from `seandespain.com`: localhost, test runs, and the netlify.app
address load the tag but send nothing.

## Manager portal

A private CRM and operations portal at `/manager/`, built for this business: client projects and job
opportunities as two separate pipelines, the people behind them, follow-up tasks, a management view
of project money, and the analytics that say which work brings opportunity in.

- **Inquiries:** the contact page form posts to `POST /api/inquiry`, which creates the contact,
  the opportunity (with UTM, referrer, landing page, and the pages read before reaching out), a
  24-hour Reply task, and the activity history. Logging a reply closes the task and records the
  response time.
- **Configuration:** stages, loss reasons, and lists live in `netlify/lib/model.js`.
- **Storage:** Netlify Blobs (store `sd-portal`), server-side only. Settings → Download all data
  exports everything as JSON.
- **Security:** the owner password exists only as a bcrypt hash in `MANAGER_PORTAL_PASSWORD_HASH`.
  Sessions are opaque HttpOnly/Secure/SameSite=Strict cookies checked on every API call; roles
  (owner, manager, team member, specialist, read only) are enforced on the server.
- **Jarvis:** `GET /api/jarvis/v1/summary` and friends return the normalized
  `jarvis.business_report` (schema 1.0) using an API key created in Settings. Scopes: `read`,
  `read_financial`, `suggest`.

Environment variables (Netlify → Site configuration → Environment variables, Functions scope):

| Variable | Required | Secret |
|---|---|---|
| `MANAGER_PORTAL_PASSWORD_HASH` | yes | yes |
| `GOOGLE_SERVICE_ACCOUNT_EMAIL`, `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY`, `GA4_SEAN_DESPAIN_PROPERTY_ID` | for the Analytics view | key is secret |
| `RESEND_API_KEY`, `NOTIFY_EMAIL` | for new-inquiry emails | key is secret |

`npm run hash-password` turns a new password into a hash at a hidden prompt.

Local: `npm run build`, then `MANAGER_PORTAL_PASSWORD_HASH='<hash of a test password>' npm run portal:dev`
serves the site and functions on port 4510 with storage in `.portal-data/`.
`node scripts/portal-test.mjs` runs the full end-to-end suite (auth, roles, form, workflows,
Jarvis API, desktop and phone UI) against a throwaway password.

## Deploying

Live at seandespain.com and seandespainportfolio.netlify.app. Repo: `SeanRDespain/seandespain-portfolio`
on GitHub, connected to Netlify (build command `npm run build`, publish directory `dist`), with
`seandespain.com` on Netlify DNS. A push to `main` redeploys both URLs automatically.
