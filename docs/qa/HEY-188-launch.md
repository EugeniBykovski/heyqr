# HEY-188 · documentation, CMYK print export and launch

Branch `feat/HEY-188-launch`, base `f414d37` (main, deployed to production), accepted code `7b64aa4`. Run on 2026-11-27.
Jira HEY-188 couldn't be read (the Atlassian connector has no access to that site); acceptance follows the request
text, including the updated criteria (CMYK required for launch, Terms and Privacy effective 2026-11-27).

**Verdict: BLOCKED.** Uncoated FOGRA29 can't ship (licence), and the release isn't deployed, so the production checks
of the CMYK downloads haven't run.

## Baseline

| Check                                                    | Result                                                                                                   |
| -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Production commit                                        | `f414d37` (main; GitHub status "Vercel: Deployment has completed")                                       |
| c58ccb2, 5997230 (HEY-172 docs) and HEY-187 in that main | yes, all three                                                                                           |
| Production health                                        | ok, `production` database, 22/22 migrations                                                              |
| Production /developers before this branch                | 200; sidebar names `@heyqr/qr-core 0.1.0`; `/developers/rest/sdk` 200; REST v1 answers 401 without a key |

## Changes

| Commit                          | Change                                                                                                                                                                                                                                                                                                                   |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `cba2b86`                       | /developers leads with the published SDK: sidebar `@simplex-packages/heyqr-sdk 0.1.0 · Live on npm`, a full-width SDK card with package and version, and an SDK section with the npm link, npm / pnpm / Yarn install tabs and a link to `/developers/rest/sdk#quickstart`; qr-core titled as its own library; 21 locales |
| `43c58aa`, `6a98428`            | Terms and Privacy show "Effective 27 November 2026 · Last updated 27 November 2026" in each locale's date format; Privacy names the Neon region (aws-us-east-2, read from the Neon project); the English-only notice no longer promises a translation on approval                                                        |
| `bbf7198`, `1604014`, `7b64aa4` | Colour-managed CMYK print PDF (lcms-wasm 1.0.5, MIT): DeviceCMYK vector artwork, CMYK raster logos at native resolution, a GTS_PDFX OutputIntent embedding the exact ICC; unknown profile 422, missing or wrong profile 503, never a silent sRGB file; sRGB PDF byte-identical to before; see `docs/PRINT_CMYK.md`       |

## CMYK per profile

| Profile          | ICC file                                                    | Licence (ICC registry)                                                                                                                                                            | Status                                                                                                                                                                                    |
| ---------------- | ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| sRGB             | —                                                           | —                                                                                                                                                                                 | unchanged, PASS                                                                                                                                                                           |
| Coated FOGRA39   | `Coated_Fogra39L_VIGC_300.icc` (VIGC, v2.1) in `assets/icc` | "may be used, embedded, exchanged, and shared without restriction"; not altered or sold                                                                                           | PASS locally (2 layouts)                                                                                                                                                                  |
| GRACoL 2013      | `GRACoL2013_CRPC6.icc` (Idealliance, v4.2) in `assets/icc`  | same wording                                                                                                                                                                      | PASS locally (2 layouts)                                                                                                                                                                  |
| Uncoated FOGRA29 | none shipped                                                | ECI's `ISOuncoated.icc`: "Heidelberger Druckmaschinen AG, All Rights Reserved", no licence published; Adobe's: click-through EULA that doesn't cover PDFs generated for customers | **BLOCKED**: disabled ("not available"), request refused; can be provisioned from private storage (`PRINT_ICC_FOGRA29_KEY`, `PRINT_ICC_FOGRA29_SHA256`) once the owner confirms a licence |

Downloaded PDFs (real Print Preview → prepare → download, Chromium 1440, a 400 px PNG logo card and a frame with a
library icon) were inspected: DeviceCMYK only, OutputIntent profile byte-identical to the ICC (`prtr`/CMYK), MediaBox /
TrimBox / BleedBox in mm, QR / frame / icon / caption vector, logo a 400 × 400 CMYK image, and pdftoppm at 300 dpi
decodes with ZXing. FOGRA39 files are about 7.8 MB (the 8.6 MB profile is embedded unaltered). PDF/X preflight: **not
run** (no preflight tool), so the files keep the "PDF 1.7" label and no PDF/X-4 marker.

## Acceptance (local production build of `7b64aa4`, Stripe test mode)

| Check                                                                                                                                                                                  | Result                              |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| Lint (0 errors), format, typecheck, `pnpm test` (1,258), `pnpm test:db` (248), build; ICC files and the WASM traced into both print routes                                             | PASS                                |
| /developers signed out (APP_ENV=production): `/developers`, `/en/developers`, `/ru/developers` at 1440, `/developers` and `/ru/developers` at WebKit 390                               | PASS 35/35                          |
| Terms and Privacy × 21 locales: effective and updated date in the locale's format, no draft or approval note, `noindex`                                                                | PASS 42/42                          |
| Footer and sign-in consent links → the published `/terms` and `/privacy` (200)                                                                                                         | PASS                                |
| CMYK downloads: sRGB, FOGRA39, GRACoL × 2 layouts; FOGRA29 disabled and refused when not provisioned                                                                                   | PASS 6/6 downloads; FOGRA29 BLOCKED |
| New account 1 (Chromium 1440): guest → design → sign-in → saved draft → Stripe test Checkout → confirming → download → decode → reload / new session → download again from My QR codes | PASS 8/8                            |
| New account 2 (WebKit 390): same journey                                                                                                                                               | PASS 8/8                            |
| Server warnings during both journeys                                                                                                                                                   | none                                |
| SDK install (credential-free) and the shipped Quickstart                                                                                                                               | reused: HEY-173 PASS (unchanged)    |
| SDK export, errors, retry                                                                                                                                                              | reused: HEY-186 PASS (unchanged)    |
| Homepage, menu, editor, no-overflow at 320 – 1440 in 21 locales                                                                                                                        | reused: HEY-187 PASS (unchanged)    |

Sign-in for both accounts: the redirect to Google's consent is genuine, the return is a fixture (a session written as
Better Auth does).

## Deployment and rollback

Not deployed. The release workflow is merge to `main` → Vercel production. The GitHub and Vercel CLIs aren't signed in
here, so the merge can't be done from this session. Production stays on `f414d37`; rollback is redeploying that
deployment (Vercel → Deployments → Promote). There are no runtime rollout flags for these features: docs visibility is
code (`visibility` in `registry.ts`, design-preview pages hidden when `APP_ENV=production`), and FOGRA39 / GRACoL need no
environment variables.

## Pending

1. Owner: a licence for an Uncoated FOGRA29 profile that allows embedding in customer PDFs, then provisioning per
   `docs/PRINT_CMYK.md`.
2. Push, pull request and merge to `main`; then on https://www.heyqr.me: download and inspect a PDF per CMYK profile,
   and smoke-test the homepage, /developers and the SDK guide in English and Russian, the npm link and signed-in entry
   points.
3. Owner input for the remaining legal placeholders (docs/legal/REVIEW.md): legal entity and address, support and
   privacy emails, minimum age, governing law, liability, notice periods, availability, legal bases, retention,
   transfer safeguards, DPO / representative, and the storage provider (R2 or S3). The pages stay `noindex` until then.
4. PDF/X-4 preflight (a tool such as callas pdfToolbox or Acrobat Preflight) before any PDF/X-4 label.
5. Native-speaker review of the new strings.
