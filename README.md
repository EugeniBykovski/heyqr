# Hey QR

Design a QR code that looks like your brand, check that it scans, and download print-ready PNG/SVG files.
Static codes are paid once; dynamic codes (editable destination, scan stats) are a monthly plan.

Design source of truth: the Claude Design canvas (brand, design system, tokens, 45+ screens, handoff).

## Stack

| Area      | Choice                                                                           |
| --------- | -------------------------------------------------------------------------------- |
| App       | Next.js 16 (App Router, `proxy.ts`), React 19, TypeScript strict                 |
| UI        | Tailwind CSS 4 (utility classes only), shadcn/ui on Radix, Lucide icons, DM Sans |
| Data      | PostgreSQL (Neon in production, Docker locally), Drizzle ORM + migrations        |
| Auth      | Better Auth with Google OAuth (sessions in Postgres)                             |
| Payments  | Stripe Checkout (one-time + subscription), webhooks, customer portal             |
| Email     | Resend + React Email                                                             |
| Files     | AWS S3 (or R2 / MinIO) with presigned uploads                                    |
| i18n      | next-intl, 21 languages, English default                                         |
| QR engine | `@heyqr/qr-core` (workspace package, publishable to npm)                         |
| Quality   | ESLint, Prettier, Vitest + Testing Library, commitlint, Husky                    |
| Hosting   | Vercel + Neon                                                                    |

## Getting started

Requirements: Node 24, pnpm 12 (`corepack enable`), Docker.

```bash
pnpm install
cp .env.example .env              # fill in the keys, see docs/INTEGRATIONS.md
pnpm db:up                        # Postgres + MinIO in Docker (or local Postgres, see docs/DATABASE.md)
pnpm db:migrate
pnpm db:seed                      # optional demo data, safe to rerun
pnpm db:verify                    # connectivity, tables and migrations
pnpm dev                          # http://localhost:3000
```

Database targets (local, test, preview, production), migrations, seeding and the preview database: [docs/DATABASE.md](docs/DATABASE.md).

Stripe webhooks locally: `pnpm stripe:listen` (Stripe CLI) and copy the `whsec_…` into `.env.local`.
Email templates: `pnpm email:dev` (http://localhost:3001).

## Scripts

| Script                                          | What it does                                                        |
| ----------------------------------------------- | ------------------------------------------------------------------- |
| `pnpm dev` / `build` / `start`                  | Next.js                                                             |
| `pnpm quality`                                  | lint, format check, typecheck, tests, build (run before every push) |
| `pnpm test`                                     | Vitest (app + qr-core; QR decoding verified with ZXing)             |
| `pnpm db:generate` / `db:migrate` / `db:studio` | Drizzle migrations and studio                                       |
| `pnpm email:dev`                                | React Email preview                                                 |

## Documentation

- [Architecture](docs/ARCHITECTURE.md)
- [Git workflow and Jira integration](docs/GIT_WORKFLOW.md)
- [Integrations, API keys and accounts](docs/INTEGRATIONS.md)
- [Architecture decision records](docs/adr)
- [Backlog](docs/backlog/heyqr-backlog.md) and [Jira import CSV](docs/backlog/jira-import.csv)
