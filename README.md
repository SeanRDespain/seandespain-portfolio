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

## Business portal

A private operations portal at `/manager/` for this business. Five areas:

- **Overview:** what needs attention, plus seven verified numbers: new client inquiries,
  follow-ups due, active projects, open employment opportunities and interviews, quoted
  pipeline, cash collected, and unpaid balances. Client and employment funnels stay separate.
- **Inquiries & Opportunities:** website form submissions (saved automatically, retry-safe)
  and manual entries; conversion to client work (proposal, quote) or employment (employer, role,
  application link, interviews, next action); contacts.
- **Projects:** won client work with deliverables, deadline, collaborator, recorded value, and
  payments (manual entries; no payment provider is connected).
- **Calendar & Tasks:** follow-ups, interviews, client appointments, deadlines, deliverables.
- **Settings:** account, collaborator accounts, connections, data export.

Managers (Sean) see everything. Collaborators get their own username and see only the
projects, deliverables, and tasks assigned to them, without money or client contact details.
Every API route enforces this on the server. Records named "[TEST] ..." are labeled test data
and excluded from all reporting and from the Jarvis API.

Code: `netlify/functions` (`inquiry.mjs`, `manager-api.mjs`, `jarvis-api.mjs`) and
`netlify/lib` (`model.js` holds stages and lists, `crm.js` the records, `metrics.js` the numbers
and exports, `auth.js` sign-in and roles). Storage: Netlify Blobs store `sd-portal`.

The Jarvis data API (`/api/jarvis/v1/health`, `/summary`, `/records`) is documented in
**JARVIS-HANDOFF.md**.

Environment variables (Netlify → Site configuration → Environment variables, Functions scope,
Production):

| Variable | Required | Secret |
|---|---|---|
| `MANAGER_PORTAL_PASSWORD_HASH` | yes (owner sign-in) | yes |
| `JARVIS_SITE_API_TOKEN` | for Jarvis | yes |
| `RESEND_API_KEY`, `NOTIFY_EMAIL` | for new-inquiry emails | key is secret |
| `GOOGLE_SERVICE_ACCOUNT_EMAIL`, `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY`, `GA4_SEAN_DESPAIN_PROPERTY_ID` | for GA4 numbers in the portal | key is secret |

`npm run hash-password` turns a new owner password into a hash at a hidden prompt.

Local: `npm run build`, then
`MANAGER_PORTAL_PASSWORD_HASH='<hash of a test password>' JARVIS_SITE_API_TOKEN='<test token>' npm run portal:dev`
serves the site and functions on port 4510 with storage in `.portal-data/`.
`node scripts/portal-test.mjs` runs the full end-to-end suite against a throwaway password.

## Deploying

Live at seandespain.com and seandespainportfolio.netlify.app. Repo: `SeanRDespain/seandespain-portfolio`
on GitHub, connected to Netlify (build command `npm run build`, publish directory `dist`), with
`seandespain.com` on Netlify DNS. A push to `main` redeploys both URLs automatically.
