# Integrations, accounts and API keys

Everything the app needs from outside, where to get it and which variable it goes into.
Never commit real values: put them in `.env.local` locally and in Vercel project settings.

## Required

| Service                       | What to create                                                                                                                                                                                                                                                                                         | Variables                                                                                                                  |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------- |
| **Neon** (Postgres)           | Project + database; enable the Vercel integration for preview branches                                                                                                                                                                                                                                 | `DATABASE_URL`                                                                                                             |
| **Google Cloud** (OAuth)      | OAuth consent screen + OAuth client (Web). Redirect URIs: `http://localhost:3000/api/auth/callback/google`, `https://<domain>/api/auth/callback/google`, preview domains                                                                                                                               | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`                                                                                 |
| **Better Auth**               | Random secret: `openssl rand -base64 32`                                                                                                                                                                                                                                                               | `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`                                                                                    |
| **Stripe**                    | Account, 2 products/prices (static one-time, dynamic monthly), webhook endpoint `https://<domain>/api/stripe/webhook` with events `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `customer.subscription.created/updated/deleted`; Customer portal; Stripe Tax (recommended) | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_STATIC`, `STRIPE_PRICE_DYNAMIC_MONTHLY`, `NEXT_PUBLIC_PRICE_*` |
| **Resend**                    | API key + verified sending domain (SPF, DKIM, DMARC DNS records)                                                                                                                                                                                                                                       | `RESEND_API_KEY`, `EMAIL_FROM`                                                                                             |
| **AWS S3** (or Cloudflare R2) | Bucket for logos and export cache, CORS for PUT from the app origin, IAM user limited to that bucket (`s3:PutObject`, `s3:GetObject`, `s3:DeleteObject`)                                                                                                                                               | `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_ENDPOINT` (R2/MinIO only), `S3_PUBLIC_URL`       |
| **Vercel**                    | Project linked to GitHub, env vars per environment, main domain                                                                                                                                                                                                                                        | —                                                                                                                          |
| **Domains + DNS**             | Main domain (e.g. heyqr.app) and a short domain for dynamic codes (e.g. hqr.to)                                                                                                                                                                                                                        | `NEXT_PUBLIC_APP_URL`, `NEXT_PUBLIC_SHORT_LINK_BASE`                                                                       |

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
