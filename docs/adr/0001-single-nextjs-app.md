# ADR 0001 — One Next.js application

Status: accepted

## Context

Hey QR needs a public editor, account area, payments, exports, dynamic redirects, admin and an API.

## Decision

Build all of them in one Next.js 16 App Router application deployed on Vercel, with route handlers for
the API, webhooks and redirects, and server actions for mutations. Business rules live on the server
(`src/server`); the client renders and calls.

## Consequences

One deployment, one auth/session model, shared types end to end. The redirect route can be moved to a
separate edge project later if traffic requires it. Cache Components stay disabled until the pages
that read the session are split from static content.
