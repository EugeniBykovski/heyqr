# Production domain: https://www.heyqr.me

The canonical production origin is **`https://www.heyqr.me`**. Every app-generated URL comes from environment
variables, so local, test and preview origins stay configurable; nothing in the code names the production host.

| Variable                      | Production value         | What uses it                                                                    |
| ----------------------------- | ------------------------ | ------------------------------------------------------------------------------- |
| `NEXT_PUBLIC_APP_URL`         | `https://www.heyqr.me`   | `metadataBase` (canonical and Open Graph URLs), Stripe return URLs, email links |
| `BETTER_AUTH_URL`             | `https://www.heyqr.me`   | Google OAuth callback; must share the app's origin (enforced)                   |
| `NEXT_PUBLIC_SHORT_LINK_BASE` | `https://www.heyqr.me/r` | what Dynamic codes encode and what the app displays (enforced: `{APP_URL}/r`)   |

## Short links

- A Dynamic code encodes `{NEXT_PUBLIC_SHORT_LINK_BASE}/{slug}`. The export, the QR details page, My QR codes and
  the hosted page all build it with `shortLinkUrl()` (`src/shared/lib/short-link.ts`), so the payload and the
  displayed link are the same address.
- Only `/r/[code]` on the app's origin serves them; there is no host rewrite for a separate short domain. Production
  startup refuses any other base, because it would print codes that never resolve.
- **Never change the base once codes are issued.** A printed code keeps the address it was exported with; the slug is
  stored without the base (`qr_code.short_code`). If the host ever has to move, keep the old host serving `/r/*`.

## Before launch

| Where                | Setting                                                                                                                                                                                                                                             |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| DNS                  | `www.heyqr.me` CNAME to Vercel; apex `heyqr.me` A/ALIAS to Vercel                                                                                                                                                                                   |
| Vercel → Domains     | `www.heyqr.me` as the production domain; `heyqr.me` added with a 308 redirect to `www`. TLS certificates are issued by Vercel once DNS resolves                                                                                                     |
| Google Cloud (OAuth) | Production client: authorized JavaScript origin `https://www.heyqr.me`; authorized redirect URI **`https://www.heyqr.me/api/auth/callback/google`** (the apex is not a valid callback); consent-screen domain `heyqr.me`                            |
| Stripe (live mode)   | Webhook endpoint **`https://www.heyqr.me/api/stripe/webhook`** with the events in [INTEGRATIONS.md](INTEGRATIONS.md); its signing secret in `STRIPE_WEBHOOK_SECRET`; live prices in `STRIPE_PRICES`; Customer portal return URLs use the app origin |
| Resend               | Sending domain `heyqr.me` verified (SPF, DKIM, DMARC); `EMAIL_FROM` on that domain                                                                                                                                                                  |
| Storage CORS         | allowed origin `https://www.heyqr.me`                                                                                                                                                                                                               |

Stripe returns are built from `NEXT_PUBLIC_APP_URL` (`src/server/billing/checkout.ts`, `portal.ts`) and land on real
routes: `/{locale}/create/export?…&checkout=success|cancelled`, `/{locale}/dashboard/billing`,
`/{locale}/dashboard/trial` and `/{locale}/print?…`. Checkout success and cancel URLs are passed per session, so the
Stripe dashboard needs no redirect settings beyond the webhook and the portal.
