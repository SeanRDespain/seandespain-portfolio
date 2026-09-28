// Structured project data: single source of truth for the homepage tiles,
// the case study pages, and (later) role-specific landing pages. Every claim
// here is backed by a real project file or Sean's own prior resume; see
// ../../../sean-despain-career/evidence-map.md for the full audit trail.

export const projects = [
  {
    slug: "peace-life",
    name: "Peace Life",
    short: "Peace Life",
    tagline: "A 140-scene guided wellness app, live on the App Store.",
    kind: "App + marketing site",
    years: "2021–Present",
    role: "Co-Founder, CEO, Creative & Product Lead",
    accent: { a: "var(--pl-gold)", b: "var(--pl-teal)" },
    live: "https://www.peacelifehealing.com",
    appStore: "https://apps.apple.com/us/app/peace-life/id6453560734",
    summary:
      "A guided seven-chakra wellness journey built in Unity for iOS, paired with a marketing site built from a blank file. Sean designed the product's progression system, built the engineering behind it, and directed the brand end to end.",
    whatItIs:
      "Peace Life guides people through the seven chakras with Reiki hand positions, meditation, breathwork, journaling, and sound: a self-assessment first, then a daily practice path across 140+ scenes.",
    whyItExisted:
      "Sean co-founded Peace Life to bring a structured, gamified approach to wellness practice that most meditation apps treat as a flat content library rather than a guided journey.",
    role_detail:
      "Co-Founder, CEO, and the only creative and product lead: design, engineering, brand, and marketing all ran through the same person.",
    designed: [
      "The full guided-journey UX: chakra progression stages, self-assessment, journaling, and an unlock/paywall flow across 140+ scenes.",
      "The 'luminous premium healing' visual system for the web: a chakra-accented palette and a Cormorant Garamond + Manrope type system.",
    ],
    built: [
      "The Unity/C# app itself, including a Firebase-backed auth and data layer.",
      "A remote-content manifest system that lets copy, images, and colors update after launch without an app-store release.",
      "A freemium paywall and contextual unlock flow.",
      "peacelifehealing.com from a single blank file: no framework, hand-written CSS/JS.",
      "GA4 and JSON-LD instrumentation, conversion-event tracking, and the App Store screenshot set.",
    ],
    challenges: [
      "An iOS-only bug where a chakra unlock panel silently failed on real devices but worked in the Editor, traced to Unity stripping an `EditorOnly`-tagged object out of device builds.",
      "Keeping post-launch content editable (copy, images, unlock colors) without forcing users through an app-store update cycle, solved with the remote manifest system.",
    ],
    outcome: "Shipped and live on the App Store.",
    status: "Live",
    tech: ["Unity", "C#", "Firebase", "HTML/CSS/JS", "Netlify", "GA4", "JSON-LD"],
    images: [
      { src: "/images/peace-life/site-hero.jpg", alt: "Peace Life marketing site hero: 'Reiki, meditation, and chakra practice. Every day.'" },
      { src: "/images/peace-life/screen-seven-stages.jpg", alt: "App Store screenshot: the seven chakra stages, root to crown" },
      { src: "/images/peace-life/screen-practices.jpg", alt: "App Store screenshot: 75+ guided practices" },
      { src: "/images/peace-life/screen-reiki.jpg", alt: "App Store screenshot: learn Reiki hand positions" },
    ],
    heroImage: "/images/peace-life/site-hero.jpg",
  },
  {
    slug: "jarvis",
    name: "Jarvis: Legacy Command Center",
    short: "Jarvis",
    tagline: "A multi-organization business platform running four real companies.",
    kind: "Internal business software",
    years: "2025–Present",
    role: "Designer & Full-Stack Developer",
    accent: { a: "var(--jarvis-gold)", b: "var(--jarvis-green)" },
    live: "https://jarviscommandcentral.netlify.app",
    summary:
      "A Next.js operations dashboard originally built for W.I.P Services, extended into a command center that runs W.I.P, Qinty, Once Upon a Princess, and Peace Life as separate, isolated workspaces.",
    whatItIs:
      "A CRM, payroll, calendar, and reporting dashboard with live integrations (QuickBooks, an internal portal API, Netlify, ElevenLabs voice) and a real-time integration-health monitor.",
    whyItExisted:
      "Running several small ventures at once meant scattered spreadsheets and disconnected tools. Jarvis centralizes operations for all of them behind one interface, without merging their data.",
    role_detail:
      "Sole designer and developer: architecture, UI, integrations, and the security work described below.",
    designed: [
      "The multi-organization data model and workspace-switching UX, so four separate businesses share one shell without their data mixing.",
      "The integration-health monitor's UX, surfacing connection status for every external system in one place.",
      "The interaction model for a server-side voice assistant (ElevenLabs text-to-speech with a browser-speech fallback).",
    ],
    built: [
      "The full Next.js 15 / TypeScript / Tailwind application, with no traditional database. Persistence runs on a mock-store-plus-Netlify-Blobs pattern.",
      "Live integrations with QuickBooks and an internal portal API.",
      "An authentication gate (signed-cookie session), added after finding the dashboard had shipped without one, exposing live client and payroll data to anonymous requests.",
    ],
    challenges: [
      "Found and closed a real security gap: the deployed dashboard had no auth layer at all before this fix.",
      "Root-caused a production-only React rendering crash to a server (UTC) vs. browser (local) timezone mismatch in date formatting, and fixed the underlying formatting layer rather than patching each symptom.",
    ],
    outcome: "Deployed and in active use, with live QuickBooks and internal-portal integrations connected.",
    status: "Live",
    tech: ["Next.js 15", "TypeScript", "Tailwind CSS", "Netlify Blobs", "QuickBooks API", "ElevenLabs API"],
    images: [
      { src: "/images/jarvis/dashboard-mock.jpg", alt: "Jarvis command center dashboard (sanitized demo data)" },
    ],
    heroImage: "/images/jarvis/dashboard-mock.jpg",
    note: "Screenshots use sanitized demo data. The live product runs real client, payroll, and financial information that is never shown publicly.",
  },
  {
    slug: "wip-services",
    name: "W.I.P Services",
    short: "W.I.P Services",
    tagline: "A 50-person staffing company, and the digital systems built to run it.",
    kind: "Company founded + website & internal tools",
    years: "2017–Present",
    role: "Founder & President; ongoing website/systems builder",
    accent: { a: "var(--wip-gold)", b: "var(--wip-green)" },
    live: "https://wipservicesllc.com",
    summary:
      "Founded a construction-staffing agency that scaled to 50+ employees and contractors across Park City, Deer Valley, Heber, and Midway, then years later built the company's public site, lead funnels, and the portal API that Jarvis reads from.",
    whatItIs:
      "A public marketing site plus an employee/manager portal in one repository, with a generated-page build pipeline, real-quote testimonials, and two lead-generation funnels.",
    whyItExisted:
      "The staffing business needed a credible public presence and a lead pipeline; the portal exists so office staff can manage jobs without spreadsheets.",
    role_detail:
      "Founded and ran the staffing operation from 2017–2019. Later personally designed and built its digital presence: the marketing site, the portal, and the build tooling behind both.",
    designed: [
      "A generated-page architecture (edit source partials, run a build script, get static pages) so content changes never require hand-editing HTML.",
      "A real-quote testimonial system and an operational 'services completed' counter used as social proof.",
    ],
    built: [
      "The public site and an employee/manager portal in one repo, plus the portal API layer that Jarvis's integration-health system reads from.",
      "An image-optimization pipeline for the site's before/after project photography.",
      "Two named lead-generation forms for separate service lines.",
    ],
    challenges: [
      "Advised the owner (a scope call Sean made and the owner confirmed) to present drywall, paint, and flooring as repair-and-remodel support rather than standalone trade services until licensing is confirmed: a compliance judgment, not just a design one.",
      "Found an unauthenticated API endpoint exposing employee pay rates and contact information; flagged and scoped as a fix.",
    ],
    outcome: "Founded a company that scaled to 50+ workers; its public site and portal are live today.",
    status: "Live",
    tech: ["Node.js", "Netlify Forms", "vanilla HTML/CSS/JS", "image optimization pipeline"],
    images: [
      { src: "/images/wip-services/site-hero.jpg", alt: "W.I.P Services homepage: 'Construction cleaning and jobsite labor for Utah builders'" },
    ],
    heroImage: "/images/wip-services/site-hero.jpg",
  },
  {
    slug: "qinty",
    name: "Organización Qinty",
    short: "Qinty",
    tagline: "A bilingual retreat and conservation site with zero unverified claims.",
    kind: "Bilingual program site",
    years: "2026",
    role: "Director of South America (Natural Worship) & site builder",
    accent: { a: "var(--qinty-forest)", b: "var(--qinty-terracotta)" },
    summary:
      "A retreat, traditional-healing, and rainforest-conservation project near Tarapoto, Peru, that Sean directs on the ground and whose bilingual site he built around a strict content-verification system.",
    whatItIs:
      "A static, photography-led, English/Spanish site covering five retreats, a safety and ethics register, and the people who lead them, Sean among them.",
    whyItExisted:
      "As Director of South America for the nonprofit Natural Worship, Sean needed a site that could serve international guests and donors without ever overstating what the program can verify, a real constraint in conservation and traditional-medicine spaces where claims are easy to overstate.",
    role_detail:
      "Directs the program's marketing, activities, and international partnerships, and is one of its four ceremony facilitators. Built the site itself.",
    designed: [
      "A three-tier content-governance system (verified / source / proposed) so no conservation figure, price, or medical claim ships without confirmation, enforced by an automated audit script, not just a style guide.",
      "The five-retreat structure, the safety/ethics register, and the bilingual information architecture (translated, never machine-translated, for ceremonial and legal text).",
    ],
    built: [
      "An Astro 7 static site with a hand-written CSS token system and self-hosted variable fonts.",
      "A media-provenance pipeline that labels every image as real photography, labeled atmosphere art, or a documented placeholder, so the site never passes off a stock photo as the real place.",
      "A multilingual sitemap and per-page JavaScript splitting.",
    ],
    challenges: [
      "Building a site for a real, physical, safety-sensitive program (jungle retreats, traditional medicine) where nearly every page could be tempted to embellish, solved by gating unverified sections behind feature flags until Qinty confirms them.",
    ],
    outcome: "Site built and content-audited; retreat and conservation details await final confirmation before flags are switched on.",
    status: "Built, pre-launch",
    tech: ["Astro", "hand-written CSS", "self-hosted variable fonts", "i18n routing"],
    images: [
      { src: "/images/qinty/home-hero.jpg", alt: "Qinty homepage: aerial drone photograph of the Amazon rainforest canopy above the retreat" },
    ],
    heroImage: "/images/qinty/home-hero.jpg",
  },
  {
    slug: "once-upon-a-princess",
    name: "Once Upon a Princess",
    short: "Once Upon a Princess",
    tagline: "Ten original characters and a booking funnel built around one goal.",
    kind: "Brand + booking site",
    years: "2026",
    role: "Founder, Brand & Product Designer",
    accent: { a: "var(--oup-lavender)", b: "var(--oup-plum)" },
    summary:
      "A children's princess-party company Sean founded, brand and all: ten original characters designed to avoid any resemblance to protected IP, and a static site built around a single conversion goal.",
    whatItIs:
      "A static Astro site built around one action for parents booking a birthday party: check availability.",
    whyItExisted:
      "Sean founded this as its own brand, and it needed an identity as distinctive as the character-licensed competitors it competes against, without borrowing anyone else's IP.",
    role_detail:
      "Founder, and designer/builder of the brand and the site.",
    designed: [
      "Ten original princess characters and a full visual system: an arch motif borrowed from castle windows, a gold 'invitation' hairline device around the booking flow, and a crown mark reused as the logo, favicon, and closing call-to-action.",
      "A single-goal booking funnel that asks only for an age band for the child (no name, address, or photo), a privacy decision made explicit on the form itself.",
    ],
    built: [
      "A data-driven Astro site where adding a princess auto-populates her card, detail page, booking option, and sitemap entry.",
      "A full WCAG AA accessibility pass: labeled forms, 44px touch targets, visible focus states, and full support for reduced motion.",
    ],
    challenges: [
      "Designing a fairy-tale brand with real visual richness while guaranteeing, in three places on the site, that none of it resembles a protected character, a constraint that shaped the character designs from the first sketch, not as a legal disclaimer bolted on after.",
    ],
    outcome: "Site built and accessibility-checked; live launch pending final photography and a connected booking backend.",
    status: "Built, pre-launch",
    tech: ["Astro", "inline SVG illustration", "WCAG AA accessibility pass"],
    images: [
      { src: "/images/once-upon-a-princess/home-hero.jpg", alt: "Once Upon a Princess homepage hero with the illustrated castle mark" },
      { src: "/images/once-upon-a-princess/princess-detail.jpg", alt: "A princess detail page" },
    ],
    heroImage: "/images/once-upon-a-princess/home-hero.jpg",
  },
];

export function getProject(slug) {
  return projects.find((p) => p.slug === slug);
}
