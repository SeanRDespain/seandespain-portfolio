# Jarvis handoff: seandespain.com

**Status: Site API ready; Jarvis connection awaiting its own tab.**

| Piece | State |
|---|---|
| Site data API (this repo) | **Ready.** End-to-end suite passes locally against the real function code (`node scripts/portal-test.mjs`, 99 checks). On production, unauthenticated and wrong-token requests are verified rejected. |
| Production token | **Set and verified** (2026-10-07): `GET /health` with the token returned `200`, `business_id: sean-despain`, `status: ok`. The token value is held by Sean; it is not in this repo. |
| Jarvis connector | **Not connected.** No Jarvis fetch has been verified. Build or verify it in the Jarvis tab using this document. |

## Business identity

| Field | Value |
|---|---|
| `business_id` | `sean-despain` (matches Jarvis's existing organization id `sean-despain`) |
| `business_slug` | `sean-despain` |
| `source` | `seandespain.com` |
| Business | Sean Despain: portfolio and professional services (freelance/contract builds) plus his own job search |
| Reporting timezone | `America/Denver` |
| Currency | `USD` (single currency; amounts are never added across currencies) |

## Connection

- **Base URL:** `https://seandespain.com/api/jarvis/v1`
- **Auth:** `Authorization: Bearer <JARVIS_SITE_API_TOKEN>` on every request. Server-to-server only; no cookies, no CORS.
- **Access:** read-only (`GET` only; anything else returns `405`). Scoped to this business's records.
- **Rate limit:** 120 requests per minute, then `429` with `Retry-After`.
- **Errors:** same envelope fields plus `error: { code, message }`. Codes: `unauthorized` (401), `not_configured` (503, token not set on the site), `invalid` (400), `not_found` (404), `method_not_allowed` (405), `rate_limited` (429).

### Configuration (environment variable names only, never values)

| Where | Variable | Notes |
|---|---|---|
| This site's Netlify deploy | `JARVIS_SITE_API_TOKEN` | Server-only, **secret**, Functions scope, Production context. A long random string (for example 48+ characters). Separate from every staff login. |
| Jarvis's Netlify deploy (suggested names, follow Jarvis's own convention if different) | `SEAN_DESPAIN_SITE_API_BASE_URL` | `https://seandespain.com/api/jarvis/v1` |
| | `SEAN_DESPAIN_SITE_API_TOKEN` | Same value as `JARVIS_SITE_API_TOKEN` above. Secret. |

## Envelope (every response)

```json
{
  "schema_version": "1.0",
  "business_id": "sean-despain",
  "business_slug": "sean-despain",
  "source": "seandespain.com",
  "generated_at": "<ISO 8601 UTC>",
  "data": { },
  "availability": {
    "operational_records": "available",
    "payments_provider": "unavailable",
    "cash_collected": "manual_entry",
    "website_analytics": "unavailable",
    "inquiry_email_notifications": "available | unavailable",
    "portal_ga4_reporting": "available | unavailable"
  },
  "next_cursor": "<only on /records; null on the last page>"
}
```

All timestamps are UTC ISO 8601. `null` means the source is unavailable or the value is unknown; `0` means a verified zero.

## Endpoints

### `GET /health`
Connection check. `data`: `status`, `supported_entities`, `record_counts` (non-archived, non-test), `last_record_update_at`, `reporting_timezone`, `currency`, `read_only`.

```bash
curl -H "Authorization: Bearer $SEAN_DESPAIN_SITE_API_TOKEN" https://seandespain.com/api/jarvis/v1/health
```

```json
{ "schema_version": "1.0", "business_id": "sean-despain", "business_slug": "sean-despain", "source": "seandespain.com", "generated_at": "<ts>",
  "data": { "status": "ok", "supported_entities": ["inquiry", "opportunity", "project", "deliverable", "payment", "task"],
            "record_counts": { "inquiry": <n>, "opportunity": <n>, "project": <n>, "deliverable": <n>, "payment": <n>, "task": <n> },
            "last_record_update_at": "<ts>", "reporting_timezone": "America/Denver", "currency": "USD", "read_only": true },
  "availability": { } }
```

### `GET /summary?from=YYYY-MM-DD&to=YYYY-MM-DD`
Period metrics. `from` and `to` are **inclusive local dates in America/Denver**; the period runs from local midnight at the start of `from` to local midnight after `to` (`from_utc` / `to_utc_exclusive` give the exact UTC instants; DST days are 23 or 25 hours). Defaults to the last 30 days ending today. Maximum span: 731 days. `from` after `to` returns 400.

**Period metrics** count events inside the window. **Snapshot metrics** (open pipeline, unpaid balances, active projects, follow-ups due, open employment) are as of `generated_at`.

```bash
curl -H "Authorization: Bearer $SEAN_DESPAIN_SITE_API_TOKEN" "https://seandespain.com/api/jarvis/v1/summary?from=2026-09-08&to=2026-10-07"
```

```json
{ "...envelope": "...",
  "data": {
    "period": { "from": "2026-09-08", "to": "2026-10-07", "timezone": "America/Denver",
                "from_utc": "2026-09-08T06:00:00.000Z", "to_utc_exclusive": "2026-10-08T06:00:00.000Z", "definition": "<text>" },
    "common": {
      "leads": { "new_inquiries": <n>, "client_work": <n>, "employment": <n>, "general": <n> },
      "confirmed_work": { "projects_started": <n>, "recorded_value": { "amount": <number>, "currency": "USD" } },
      "quoted_value": { "open_pipeline": { "amount": <number>, "currency": "USD" }, "open_with_quote": <n>, "open_without_quote": <n>,
                        "proposals_sent_in_period": <n>, "proposals_value_in_period": { "amount": <number>, "currency": "USD" } },
      "cash_collected": { "amount": <number>, "currency": "USD", "source": "manual_entry", "verified_by_provider": false },
      "verified_payments": null,
      "unpaid_balances": { "amount": <number>, "currency": "USD", "projects": <n>, "source": "manual_entry" },
      "website_analytics": null
    },
    "business_specific": {
      "follow_ups_due": <n>, "follow_ups_overdue": <n>, "active_projects": <n>, "deliverables_open": <n>,
      "employment": { "open_opportunities": <n>, "in_screening_or_interviews": <n>, "interviews_scheduled": <n>, "offers": <n>,
                      "accepted_in_period": <n>, "funnel": [ { "stage": "interested", "label": "Interested", "count": <n> }, "..." ] },
      "client_funnel": [ { "stage": "inquiries", "label": "Client inquiries", "count": <n> }, { "stage": "opportunity", "count": <n> },
                         { "stage": "proposal", "count": <n> }, { "stage": "won", "count": <n> } ],
      "inquiry_response": { "unanswered_over_24h": <n> }
    },
    "availability_notes": { "cash_collected": "<text>", "website_analytics": "<text>" }
  } }
```

### `GET /records?entity=<entity>&updated_since=<ISO>&cursor=<cursor>&limit=<1-500>`
Operational records for sync. Ordered by `(updated_at, id)` ascending; `next_cursor` continues after the last record returned, so writes during a sync never shift pages already read. Default `limit` 100, max 500. `updated_since` is inclusive. Archived records are included with `archived: true` and `archived_at` (this is the deletion marker; nothing is hard-deleted). Labeled test records are never exported.

**Incremental sync:** store the largest `updated_at` you processed; next time pass it as `updated_since` and follow `next_cursor` until it is `null`. Upsert by `id`; treat `archived: true` as removed.

```bash
curl -H "Authorization: Bearer $SEAN_DESPAIN_SITE_API_TOKEN" "https://seandespain.com/api/jarvis/v1/records?entity=inquiry&updated_since=2026-10-01T00:00:00Z&limit=100"
```

```json
{ "...envelope": "...",
  "data": { "entity": "inquiry", "count": 1, "records": [
    { "id": "inq_<id>", "entity": "inquiry", "business_id": "sean-despain", "created_at": "<ts>", "updated_at": "<ts>", "archived": false, "archived_at": null,
      "type": "client_work", "status": "new", "contact_name": "<name>", "organization": "<org or null>", "requested_service": "app",
      "source": "linkedin", "utm": { "utm_source": "linkedin", "utm_medium": "social", "landing_page": "/" },
      "channel": "website_form", "manual_entry": false, "owner": "owner", "next_follow_up_at": "<ts or null>",
      "first_response_at": null, "converted_to": null } ] },
  "next_cursor": "<opaque string or null>" }
```

## Supported entities and fields

Every record: `id` (stable), `entity`, `business_id`, `created_at`, `updated_at`, `archived`, `archived_at`.

| Entity | Fields |
|---|---|
| `inquiry` | `type` (`client_work` / `employment` / `general`), `status` (`new`, `contacted`, `converted`, `not_a_fit`, `spam`, `closed`), `contact_name`, `organization`, `requested_service`, `source`, `utm` (only when actually captured, else `null`), `channel` (`website_form` / `manual`), `manual_entry`, `owner`, `next_follow_up_at`, `first_response_at`, `converted_to` (`{entity, id}`) |
| `opportunity` | `opportunity_type` (`client` / `employment`), `is_sale` (true only for client), `stage`, `stage_status` (`open` / `won` / `lost`), `title`, `organization`, `inquiry_id`, `source`, `manual_entry`, `owner`, `next_follow_up_at`, `expected_decision_at`, `won_at`, `closed_at`, `loss_reason`. Client only: `requested_service`, `quote` (`{amount, currency}`), `proposal_sent_at`, `project_id`. Employment only: `employer`, `role`, `employment_type`, `application_url`, `applied_at`, `next_action` |
| `project` | `title`, `client_name`, `organization`, `opportunity_id`, `stage` (`planning`, `in_progress`, `review`, `on_hold`, `delivered`, `cancelled`), `phase` (`active` / `paused` / `done`), `start_at`, `deadline`, `assignee_id`, `recorded_value`, `collected`, `balance` (each `{amount, currency}`), `payment_status` (`no_value`, `unpaid`, `partial`, `paid`), `payment_source` (`manual_entry`), `deliverables` (`{total, done}`) |
| `deliverable` | `project_id`, `title`, `status` (`todo`, `in_progress`, `done`), `assignee_id`, `due_at`, `completed_at`, `update_count` |
| `payment` | `project_id`, `amount` (`{amount, currency}`), `received_at`, `method`, `source` (`manual_entry`), `verified_by_provider` (false) |
| `task` | `kind` (`follow_up`, `reply`, `interview`, `appointment`, `call`, `other`), `title`, `status` (`open` / `done`), `priority`, `due_at`, `completed_at`, `assignee_id`, `related` (`{entity, id}`) |

Never exported: emails, phone numbers, inquiry messages, notes, deliverable update text, password hashes, tokens.

`stage` keys: client `discovery`, `proposal`, `won`, `lost`. Employment `interested`, `applied`, `screening`, `interviewing`, `offer`, `accepted`, `closed`.

`source` keys: `website_direct` (website form, browser saw no referrer or UTM), `linkedin`, `google_organic`, `google_ads`, `referral`, `email`, `instagram`, `facebook`, `job_board`, `other_site`, `outbound`, `unknown` (nothing was captured).

## Metric definitions

| Metric | Definition |
|---|---|
| New inquiries (leads) | Inquiries created in the period, excluding `spam`, archived, and test records. Split by type. |
| New client inquiries | The `client_work` subset. |
| Follow-ups due | Open tasks of kind follow-up, reply, call, appointment, or interview due before the end of today (America/Denver), including overdue. Snapshot. |
| Active projects | Projects in `planning`, `in_progress`, or `review`. Snapshot. |
| Open employment | Employment opportunities in an open stage. Interviews scheduled = open `interview` tasks due from now on. Never counted as sales. |
| Quoted pipeline | Sum of `quote` on client opportunities in `discovery` or `proposal`. Snapshot. Count of open ones without a quote is reported separately. |
| Confirmed work | Projects created (started) in the period, with their recorded value. |
| Cash collected | Payments with `received_at` in the period. Manual entries; `verified_payments` stays `null` until a payment provider is connected. |
| Unpaid balances | For non-cancelled projects with a recorded value: value minus payments received, summed where above zero. Snapshot. |

Lead counts, confirmed work, quoted value, cash collected, and unpaid balances are separate figures and must not be added together. Employment funnel and client funnel are separate.

## Providers and gaps

| Source | Status | Notes |
|---|---|---|
| Operational records (this site) | Available | Netlify Blobs store `sd-portal`. This site owns inquiries, opportunities, projects, deliverables, tasks. |
| Payment / accounting provider | **Not connected** | Payments are manual entries in the portal. No Stripe, QuickBooks, or other provider for this business. |
| Google Analytics 4 | Read by Jarvis directly | Measurement ID `G-ZMM05DKGDB`. Jarvis's existing variable: `GA4_SEAN_DESPAIN_PROPERTY_ID` (property id, not the measurement id). Not duplicated in this API. Website events: `inquiry_submitted`, `email_clicked`, `contact_clicked`, `resume_downloaded`, `live_project_clicked` (these are interactions, not inquiries). |
| Search Console | Not connected | |
| Inquiry email alerts | Optional | `RESEND_API_KEY`, `NOTIFY_EMAIL` on this site. |

## Checklist for the Jarvis tab

1. Set `SEAN_DESPAIN_SITE_API_BASE_URL` and `SEAN_DESPAIN_SITE_API_TOKEN` (or Jarvis's own naming) in Jarvis's deploy, server-side only.
2. `GET /health`: expect `200`, `business_id: "sean-despain"`, the six entities.
3. Map to the existing organization `sean-despain` in `src/lib/organizations/organization-registry.ts` (currently `dataStatus: "not_connected"`), and update its `data-sources.ts` entry: inquiries now come from this API, not Netlify Forms.
4. Pull `/summary` for KPIs and `/records` per entity with `updated_since` + `next_cursor` for history.
5. Only after a real fetch succeeds, mark the connection as connected in Jarvis and in this file.
