# Integrations, accounts and API keys

Everything the app needs from outside, where to get it and which variable it goes into.
Never commit real values: put them in `.env` locally and in Vercel project settings. Every service gets separate dev and production credentials; see [ENVIRONMENTS.md](ENVIRONMENTS.md) for the matrix and Vercel scope mapping.

## Required

| Service                       | What to create                                                                                                                                                                                                                                                                                                                                                                                                                | Variables                                                                                                                  |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| **Neon** (Postgres)           | Project with a production branch (`main`) and a `dev` branch; see [ENVIRONMENTS.md](ENVIRONMENTS.md)                                                                                                                                                                                                                                                                                                                          | `DATABASE_URL`, `DATABASE_URL_UNPOOLED`                                                                                    |
| **Google Cloud** (OAuth)      | OAuth consent screen + OAuth client (Web). Redirect URIs: `http://localhost:3000/api/auth/callback/google`, `https://<domain>/api/auth/callback/google`, preview domains                                                                                                                                                                                                                                                      | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`                                                                                 |
| **Better Auth**               | Random secret: `openssl rand -base64 32`                                                                                                                                                                                                                                                                                                                                                                                      | `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`                                                                                    |
| **Stripe**                    | Account, one Price per offer and currency (USD and PLN: Single QR, Static Pack 3 and 10, Print Pack one-time; Starter and Studio monthly) at the catalog amounts, in `STRIPE_PRICES`, webhook endpoint `https://<domain>/api/stripe/webhook` with events `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `customer.subscription.created/updated/deleted`; Customer portal; Stripe Tax (recommended) | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_STATIC`, `STRIPE_PRICE_DYNAMIC_MONTHLY`, `NEXT_PUBLIC_PRICE_*` |
| **Resend**                    | API key + verified sending domain (SPF, DKIM, DMARC DNS records)                                                                                                                                                                                                                                                                                                                                                              | `RESEND_API_KEY`, `EMAIL_FROM`                                                                                             |
| **Cloudflare R2** (or AWS S3) | Private bucket per environment for uploaded logos (HEY-83: never public, no CORS needed; the server reads and writes it), an "Object Read & Write" token scoped to that bucket (`s3:PutObject`, `s3:GetObject`, `s3:DeleteObject`)                                                                                                                                                                                            | `S3_REGION` (`auto` for R2), `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_ENDPOINT` (R2/MinIO only)        |
| **Vercel**                    | Project linked to GitHub, env vars per environment, main domain                                                                                                                                                                                                                                                                                                                                                               | —                                                                                                                          |
| **Domains + DNS**             | Main domain (e.g. heyqr.app) and a short domain for dynamic codes (e.g. hqr.to)                                                                                                                                                                                                                                                                                                                                               | `NEXT_PUBLIC_APP_URL`, `NEXT_PUBLIC_SHORT_LINK_BASE`                                                                       |

## Recommended

| Service                 | Why                                              | Variables                                            |
| ----------------------- | ------------------------------------------------ | ---------------------------------------------------- |
| **GitHub for Jira**     | Branches/commits/PRs in tickets                  | —                                                    |
| **Upstash Redis**       | Rate limiting for redirects, exports and uploads | `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` |
| **Sentry**              | Error tracking                                   | `SENTRY_DSN` (added with HEY-33)                     |
| **Plausible / PostHog** | Product analytics                                | added with HEY-33                                    |

## Not needed

- QR decoding/verification: ZXing runs locally (wasm), no API key.
- QR rendering and PNG rasterization: in-house (`@heyqr/qr-core` + resvg).
- Fonts: DM Sans via `next/font` (self-hosted at build time).

## CORS for S3 (logo uploads)

```json
[
  {
    "AllowedOrigins": ["http://localhost:3000", "https://heyqr.app"],
    "AllowedMethods": ["PUT", "GET"],
    "AllowedHeaders": ["*"],
    "MaxAgeSeconds": 3000
  }
]
```
