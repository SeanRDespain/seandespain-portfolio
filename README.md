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

`public/resume/` holds the master résumé plus all six role-specific variants (`.docx`, ATS-friendly).
The header/footer link to the hybrid product/creative-technology version by default; swap the linked
filename in `src/components/Header.astro` and `Footer.astro` per application if a different variant
fits better.

## Deploying

Live at seandespain.com and seandespainportfolio.netlify.app. Repo: `SeanRDespain/seandespain-portfolio`
on GitHub, connected to Netlify (build command `npm run build`, publish directory `dist`), with
`seandespain.com` on Netlify DNS. A push to `main` redeploys both URLs automatically.
