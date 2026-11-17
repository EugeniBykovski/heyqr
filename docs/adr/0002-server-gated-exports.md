# ADR 0002 — Paid files are produced only by the server

Status: accepted

## Context

Full-size PNG/SVG files are the product. A client-side download button would hand them out for free.

## Decision

The browser shows only a watermarked on-screen preview. `GET /api/export/[layoutId]` checks the session,
ownership and `canDownload` (static: purchased; dynamic: active plan), renders from the stored layout
with qr-core, embeds uploaded images, and streams the file with `Cache-Control: private, no-store`.
Stripe webhooks are the only writer of entitlements.

## Consequences

Exports cost server CPU (resvg); an S3 render cache is planned (HEY-20). Fonts must be bundled for
PNG rendering on Vercel (HEY-19).
