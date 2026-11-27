# Architecture

One Next.js application serves the public editor, the account area, payments, exports, dynamic redirects,
the API and (later) admin. The QR engine is a separate workspace package so the same code renders the
on-screen preview, the paid server-side files and, later, a public npm/API client.

```
heyqr/
├─ packages/qr-core/          @heyqr/qr-core — pure TS QR engine (no DOM, no Node APIs in the main entry)
│  ├─ src/encode.ts           QR encoder (versions 1–20, ECL L/M/Q/H, masks)
│  ├─ src/render.ts           styled SVG (8 module shapes, 5 eye frames, 5 eye balls, logo/text plates) + scan check
│  ├─ src/compose.ts          layouts: code only, caption, vertical/horizontal cards, 8 frames
│  ├─ src/payload.ts          9 content types → payload strings (Wi-Fi, vCard 3.0, VEVENT, …)
│  ├─ src/raster.ts           Node only: SVG → PNG (resvg)          → "@heyqr/qr-core/raster"
│  └─ src/verify.ts           Node only: ZXing decode at 3 sizes    → "@heyqr/qr-core/verify"
├─ messages/<locale>.json     UI copy (English is the source and fallback)
├─ drizzle/                   generated SQL migrations
└─ src/
   ├─ app/                    routes only (thin): pages, route handlers, layouts
   │  ├─ [locale]/…           localized pages (home, pricing, sign-in, create, create/export, dashboard…)
   │  ├─ api/auth/[...all]    Better Auth
   │  ├─ api/stripe/webhook   Stripe events (signature-verified, idempotent)
   │  ├─ api/export/[layoutId] paid PNG/SVG, issued only after the entitlement check
   │  ├─ api/uploads/presign  presigned S3 PUT for logos
   │  └─ r/[code]             dynamic-code redirect + scan counter (after())
   ├─ widgets/                page sections composed from features (site header, footer, scans chart)
   ├─ features/               user interactions (qr-editor, checkout, auth, language switch, destination form)
   ├─ entities/               domain models and their UI (qr: design model, content forms, preview)
   ├─ shared/                 ui (shadcn primitives), lib (cn, auth client, providers), config
   ├─ server/                 server-only: db, auth, billing, email, storage, qr services, server actions
   ├─ i18n/                   locale registry, routing, navigation, request config
   ├─ env.ts                  validated environment (server vs NEXT_PUBLIC_*)
   └─ proxy.ts                locale negotiation (Next 16 "proxy", formerly middleware)
```

## Layer rules

`app → widgets → features → entities → shared`. Imports only point right. `server/` is importable from
`app`, server components and server actions only (every module starts with `import "server-only"`;
action files use `"use server"`). Each slice exposes one `index.ts`.

`package.json` declares the project's modules free of side effects (`"sideEffects": ["*.css"]`), so the bundler
drops a slice's unused exports: a page that imports one component from `@/entities/qr` or `@/features/qr-editor`
doesn't ship the rest of the slice to the browser. A module that must run when imported for its effects alone
(`import "./x"`) has to be listed there.

## Key flows

**Editing (guest or signed in).** `features/qr-editor` keeps an `EditorDesign` in localStorage,
converts it with `designToLayout` and renders the preview with `composeLayout` from qr-core. The scan
check (`ScanReport`) runs on every change; the Download button is disabled while it fails.

**Saving.** Download → Google sign-in (if needed, returns to `/create?resume=1`) → `saveDraft` server
action → `qr_code` + `qr_layout` rows → `/create/export`.

**Paying.** `startCheckout` creates a Stripe Checkout session (payment for static, subscription for
dynamic). The webhook marks the purchase paid / mirrors the subscription and assigns the short code.
The client never decides entitlement.

**Downloading.** `GET /api/export/[layoutId]?format=png|svg` → session → ownership → `canDownload`
→ compose → embed uploaded images → (PNG) resvg → `Content-Disposition: attachment`. Before payment
the site shows only a watermarked on-screen preview.

**Dynamic redirect.** `/r/[code]` looks up the code, redirects with 302 + `no-store`, and increments
`scan_daily` after the response is sent.

## Data model

`user`, `session`, `account`, `verification` (Better Auth) · `qr_code` (content, model, status, short
code, destination) · `qr_layout` (design JSON) · `purchase` · `subscription` · `scan_daily` · `asset`
· `export_file` (render cache) · `webhook_event` (idempotency).

## Styling

Tailwind utility classes in `className` only. Tokens live in `src/app/globals.css` (`@theme`):
primitives (ink, violet) → semantic tokens (`bg-surface`, `text-muted-foreground`, `bg-primary`) →
type roles (`text-display` … `text-micro`). ESLint rejects hex colours and the default palette in
`className`. Primary buttons use the violet hover pulse from the design.

## Environment and secrets

`src/env.ts` validates every variable at startup. Only `NEXT_PUBLIC_*` values reach the browser.
SDK clients (Stripe, Resend, S3) are created lazily, so `SKIP_ENV_VALIDATION=1 pnpm build` works in CI.
