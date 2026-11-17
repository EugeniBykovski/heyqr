# Hey QR backlog

Ordered delivery plan. Import `jira-import.csv` into the HEY project (Jira → Settings → System → External system import → CSV). In an empty project the keys come out as HEY-1 … HEY-34 in this order; if Jira assigns different numbers, use the assigned key in branches and commits.

Epics are carried as labels (second label column) so imported keys stay in order; create Jira epics afterwards and bulk-move issues by label if you want an epic view.

## Foundation

### HEY-1 · Project foundation: Next.js 16 stack, architecture, DB schema, qr-core package

**Priority:** Highest

Scaffold the single Next.js 16 app (App Router, React 19, TypeScript strict, Tailwind 4, shadcn/ui on Radix), pnpm workspace with @heyqr/qr-core, Drizzle schema for Postgres, Better Auth (Google), Stripe checkout/webhook, Resend, S3 storage, next-intl with 21 locales, default pages, git conventions (commitlint + Jira key hooks), docs and ADRs.

**Acceptance criteria**

- pnpm quality passes (lint, format, typecheck, test, build)
- qr-core decodes with ZXing for all 8 module styles and 8 frames
- Initial migration drizzle/0000_init.sql generated
- Docs: README, ARCHITECTURE, GIT_WORKFLOW, INTEGRATIONS, ADRs, backlog

### HEY-2 · Environments: Vercel project, Neon Postgres, preview database branches

**Priority:** Highest · **Depends on:** HEY-1

Create the Vercel project linked to GitHub, Neon project with main + preview branches (Neon Vercel integration), and set all environment variables from .env.example for Production / Preview / Development.

**Acceptance criteria**

- Every PR gets a Vercel preview with its own Neon branch
- Migrations run on deploy (pnpm db:migrate in the build step or a GitHub Action)
- No secrets in Git; env documented in .env.example

### HEY-3 · CI quality gates and GitHub for Jira integration

**Priority:** High · **Depends on:** HEY-1

GitHub Actions workflow runs pnpm quality on every PR. Install the GitHub for Jira app on the heyqr repository so branches, commits and PRs named with HEY-<n> show in the ticket's Development panel. Protect main (PR + green CI required).

**Acceptance criteria**

- CI required on main
- A test branch HEY-<n>-x with commit feat(HEY-<n>): … appears on the ticket
- Branch protection on main

## Auth

### HEY-4 · Google OAuth production setup

**Priority:** High · **Depends on:** HEY-2

Google Cloud project, OAuth consent screen (app name, logo, privacy/terms URLs, domain verification), Web client with redirect URIs for production, preview and localhost. Better Auth trusted origins per environment.

**Acceptance criteria**

- Sign-in works on localhost, preview and production
- Consent screen verified/published
- Users table stores name, email, avatar, locale

### HEY-5 · Guest draft → sign-in → saved code flow

**Priority:** High · **Depends on:** HEY-4

A guest designs in /create (draft in localStorage), presses Download, signs in with Google and returns to /create?resume=1; the draft is saved to the account and the user lands on the export step.

**Acceptance criteria**

- Draft survives the OAuth round trip
- Draft saved once (no duplicates on refresh)
- E2E test (Playwright) with a mocked OAuth provider

### HEY-6 · Account settings: delete account and export data (GDPR)

**Priority:** Medium · **Depends on:** HEY-5

Account page with profile, language preference, data export (JSON of codes/layouts/purchases) and account deletion that cancels subscriptions and removes S3 assets.

**Acceptance criteria**

- Deletion cascades in DB and removes S3 objects
- Active subscription is cancelled in Stripe
- Confirmation email via Resend

## Editor

### HEY-7 · Content step: all 9 content types per design

**Priority:** High · **Depends on:** HEY-1

Implement the Content step exactly per artboards S-C01…S-C04: type cards with icons, per-type forms (website, text, Wi-Fi, contact, email, phone, SMS, location, event), inline validation messages (UX only), and the payload preview.

**Acceptance criteria**

- Every type encodes correctly (unit tests per type)
- Forms are keyboard and screen-reader accessible
- Matches 390/834/1440 artboards

### HEY-8 · Design step: shape thumbnails, palettes and style presets

**Priority:** High · **Depends on:** HEY-7

Visual option cards with mini previews for modules, corner frames and corner centers; style presets (Classic, Soft, Dots, …) and brand palettes from the design; hex inputs with contrast guidance.

**Acceptance criteria**

- Thumbnails render from qr-core (no images)
- Scan status updates on every change
- Presets match the Design System sheet

### HEY-9 · Logo upload to S3

**Priority:** High · **Depends on:** HEY-2

Replace the in-browser data URI with an upload: POST /api/uploads/presign → PUT to S3 → store the public URL in the layout. Validate type/size, strip EXIF, rasterize SVG safely, and embed the image at export time.

**Acceptance criteria**

- PNG/JPG/SVG/WebP up to 10 MB
- Uploaded logos show in preview and in PNG/SVG exports
- Unused assets cleaned up by a scheduled job

### HEY-10 · Frame step: frame color, caption font and caption position

**Priority:** Medium · **Depends on:** HEY-8

Customize frame color and caption color, font family/weight, alignment and position (below, above, inside the code), per artboards S-C08…S-C10.

**Acceptance criteria**

- All 8 frames customizable
- Caption auto-fits without clipping
- Scan check covers text inside the code

### HEY-11 · Card layouts: business card, poster, sticker (mm) with brand logo

**Priority:** Medium · **Depends on:** HEY-10

Physical layouts in millimetres (vertical/horizontal cards, poster, round sticker) with optional top logo and brand name, hairline border, bleed-safe sizes; preview at true aspect ratio.

**Acceptance criteria**

- Exports keep physical size (width="90mm")
- PNG export at 300 DPI by default, up to 1200 DPI
- Layouts match the Composition artboards

### HEY-12 · Multiple layouts per QR code

**Priority:** Medium · **Depends on:** HEY-11

Layout manager: add, duplicate, rename, reorder and delete layouts of one code (one payment covers all layouts of a static code).

**Acceptance criteria**

- Layouts persisted with sort order
- Dashboard shows the first layout as the cover
- Export works per layout

### HEY-13 · In-browser ZXing scan verification

**Priority:** Medium · **Depends on:** HEY-8

Run zxing-wasm in a Web Worker on the rendered SVG (debounced) to show “Scan verified” from a real decoder, in addition to the structural check in qr-core.

**Acceptance criteria**

- Worker does not block typing
- Verification at 3 sizes
- Fallback to structural check if wasm fails

### HEY-14 · Responsive and accessibility pass for the editor

**Priority:** High · **Depends on:** HEY-7

Match the 390/834/1440 artboards (sticky preview, bottom action bar on mobile), keyboard navigation through option grids, focus management between steps, axe audit.

**Acceptance criteria**

- No horizontal scroll from 320 px
- axe: zero serious issues
- Visual QA against artboards

## Payments

### HEY-15 · Stripe products, prices, tax and production webhook

**Priority:** Highest · **Depends on:** HEY-2

Create products/prices (static one-time, dynamic monthly), enable Stripe Tax, customer portal configuration, production webhook endpoint /api/stripe/webhook with the required events.

**Acceptance criteria**

- Price IDs set per environment
- Webhook signature verified; idempotent processing
- Customer portal allows cancel and payment method update

### HEY-16 · Checkout flow end-to-end tests

**Priority:** High · **Depends on:** HEY-15

Playwright + Stripe test mode: static purchase unlocks downloads; dynamic subscription assigns a short code; cancelled checkout leaves nothing charged; webhook retries are idempotent.

**Acceptance criteria**

- Tests run in CI against a Stripe test account
- Pending state shown until the webhook arrives

### HEY-17 · Refunds, disputes and subscription lapses

**Priority:** Medium · **Depends on:** HEY-15

Handle charge.refunded, charge.dispute.created and subscription past_due/canceled: revoke download entitlement and pause dynamic redirects with a grace period; notify the user by email.

**Acceptance criteria**

- Entitlements follow Stripe state
- Paused dynamic codes show the link-unavailable page

### HEY-18 · Billing page and plan limits

**Priority:** Medium · **Depends on:** HEY-15

Billing page with invoices (from Stripe), plan status, and enforcement of the active dynamic code limit (DYNAMIC_ACTIVE_CODE_LIMIT).

**Acceptance criteria**

- Creating code N+1 on the plan shows an upgrade prompt
- Invoices downloadable

## Export

### HEY-19 · Bundle fonts for PNG export

**Priority:** Highest · **Depends on:** HEY-1

resvg on Vercel has no system fonts. Bundle DM Sans (and fonts offered for captions) as files and pass them to rasterizeSvg so captions render identically to the preview.

**Acceptance criteria**

- Caption text renders in PNG exports on Vercel
- Snapshot test of a captioned PNG

### HEY-20 · Export cache in S3 and signed downloads

**Priority:** Medium · **Depends on:** HEY-9

Cache rendered files in S3 keyed by layout + format + size + content hash (export_file table) and redirect to a short-lived signed URL instead of rendering on every download.

**Acceptance criteria**

- Second download of the same file is served from S3
- Cache invalidated when the layout changes

### HEY-21 · PDF export (vector, print-ready)

**Priority:** Low · **Depends on:** HEY-11

Vector PDF of a layout at physical size with optional crop marks and bleed, for print shops. The export route currently answers 501 for format=pdf.

**Acceptance criteria**

- PDF opens in Acrobat/Preview at exact mm size
- Text is real text, code is vector

### HEY-22 · Server-side scan verification gate

**Priority:** Medium · **Depends on:** HEY-20

Before issuing a paid file, decode it with ZXing (@heyqr/qr-core/verify) in a separate serverless function (wasm kept out of the main bundle) and refuse files that do not decode.

**Acceptance criteria**

- Unscannable designs cannot be bought
- Verification result stored with the export

## Dynamic links

### HEY-23 · Short link domain and fast redirects

**Priority:** High · **Depends on:** HEY-2

Configure the short domain (e.g. hqr.to) on Vercel pointing to /r/[code]; add rate limiting (Upstash) and cache headers; 404/paused codes go to /link-unavailable.

**Acceptance criteria**

- Redirect p95 < 100 ms
- Rate limit per IP
- Printed codes use NEXT_PUBLIC_SHORT_LINK_BASE

### HEY-24 · Scan analytics

**Priority:** Medium · **Depends on:** HEY-23

Privacy-friendly analytics per scan: day, country (x-vercel-ip-country), device class; no IP storage. Dashboard charts for 7/30/90 days.

**Acceptance criteria**

- Counts recorded after the response (after())
- Charts accessible with table fallback

### HEY-25 · Pause, archive and destination history

**Priority:** Medium · **Depends on:** HEY-23

Pause/resume/archive dynamic codes, destination change history with one-click undo, and validation of destination URLs (no javascript:, data:).

**Acceptance criteria**

- Status changes reflected in redirects immediately
- Undo restores the previous destination

## Email

### HEY-26 · Resend domain and transactional templates

**Priority:** High · **Depends on:** HEY-2

Verify the sending domain in Resend (SPF, DKIM, DMARC). React Email templates: welcome, purchase receipt, subscription started/cancelled/payment failed. Localized subjects.

**Acceptance criteria**

- Emails pass SPF/DKIM
- Templates previewable with pnpm email:dev

## Admin

### HEY-27 · Admin area

**Priority:** Medium · **Depends on:** HEY-17

Role-based /admin: users, codes, purchases, subscriptions, refunds via Stripe, takedown of abusive dynamic links, audit log.

**Acceptance criteria**

- Only admins can access (server-checked)
- All admin actions logged

## Public API & npm

### HEY-28 · Publish @heyqr/qr-core to npm

**Priority:** Medium · **Depends on:** HEY-1

Build the package with tsup (ESM + types), semantic versioning with changesets, README with examples, browser and Node entry points (raster/verify).

**Acceptance criteria**

- npm install @heyqr/qr-core works in a plain Node and a Vite app
- Same version used by the editor and the server

### HEY-29 · Public REST API with API keys (paid)

**Priority:** Low · **Depends on:** HEY-28

Versioned /api/v1 to create codes and render files, API keys per account (hashed), usage metering and Stripe usage-based billing, OpenAPI document.

**Acceptance criteria**

- Keys can be created and revoked
- Rate limits and metering per key

## i18n & marketing

### HEY-30 · Translate the remaining 19 languages

**Priority:** Medium · **Depends on:** HEY-7

Professional translations for es, zh, hi, ar (RTL), pt, fr, de, ja, ko, it, tr, id, vi, pl, uk, be, nl, th, sv. English and Russian exist.

**Acceptance criteria**

- Every locale passes the messages test
- RTL layout reviewed for Arabic

### HEY-31 · SEO: sitemap, hreflang, OG images, landing pages per QR type

**Priority:** Medium · **Depends on:** HEY-30

Localized metadata, sitemap.xml and robots.txt, hreflang alternates, dynamic OG images, and landing pages like /wifi-qr-code.

**Acceptance criteria**

- Lighthouse SEO 100 on home and landings
- All locales listed in hreflang

### HEY-32 · Legal pages and cookie consent

**Priority:** High · **Depends on:** HEY-1

Terms, Privacy Policy, refund policy; cookie consent only if non-essential cookies are used.

**Acceptance criteria**

- Legal text approved
- Linked from footer and Google consent screen

## Ops

### HEY-33 · Observability: Sentry, product analytics, uptime

**Priority:** Medium · **Depends on:** HEY-2

Sentry for client/server errors with source maps, privacy-friendly analytics (Plausible or PostHog), uptime checks for /api/health and the redirect domain.

**Acceptance criteria**

- Errors reported with release tags
- Alerts on webhook failures

### HEY-34 · Launch checklist

**Priority:** High · **Depends on:** HEY-33

Production keys switched to live mode, DNS, backups (Neon PITR), load test of redirects, security review (headers, CSP, rate limits), final design QA.

**Acceptance criteria**

- Checklist signed off
- Rollback plan documented
