# HEY-187 · launch fixes and acceptance

Branch `feat/HEY-187-launch-fixes`, base `7f34b84` (main, with c58ccb2 and 5997230), accepted code `91c34a9`. Run on
2026-11-27. The screenshots referenced by the request didn't reach this session; the fixes follow the written brief.

## Changes

| Part                | Commit               | Change                                                                                                                                                                                                                                                                                                                                                                                 |
| ------------------- | -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1 Mobile navigation | `3d281df`            | Tap outside closes the menu over a dimmed, blurred backdrop (plain dim with reduced transparency, no fade with reduced motion); Escape and the close button keep working; focus returns to the trigger; a backdrop tap never reaches the page; scroll locked while open                                                                                                                |
| 2 Guest homepage    | `37494da`, `b73fd7a` | Square 60 × 60 mm QR demo (homepage only, label derived from the layout; the 90 × 50 mm preset is untouched), live and scannable while editing; headline "Create a QR code worth scanning." in all 21 locales; grids start from one shrinkable column and long CTAs/badges wrap, so there's no sideways scroll at 320 px in any locale; Sign in moves into the phone menu up to 430 px |
| 3 /developers       | `7e6ef01`            | SDK page and the live REST reference pages (authentication, create, destination, errors) public in production; SDK featured with its npm link and install commands, the verified Quickstart and its API-key requirements; stale Soon / Coming soon / Unpublished / waitlist copy removed in 21 locales; @heyqr/qr-core kept separate as "Not on npm yet"; bulk and scans stay hidden   |
| 4 Terms and Privacy | `91c34a9`            | Draft banner removed in every locale; text, dates and consent links unchanged                                                                                                                                                                                                                                                                                                          |
| 5 QR editor         | `457d79a`            | Corner frame / center thumbnails drawn whole with a margin (48 px); check mark on the tile corner; the Layout tab's focus ring no longer clipped; renderer unchanged                                                                                                                                                                                                                   |

## Part 6 · CMYK (no change)

Coated FOGRA39, GRACoL 2013 and Uncoated FOGRA29 are disabled by the capability list
`AVAILABLE_PROFILES = ["srgb"]` (`src/entities/qr/model/print.ts`), which Print Preview and the server
(`unsupported_profile`, 422) both read. Behind it: no ICC colour engine is installed or deployed and no ICC profile
files are in the repository, because their licences (ECI / Heidelberg for the FOGRA sets, Idealliance for GRACoL) don't
clearly allow bundling them (HEY-196). Same blocker for all three profiles; sRGB export keeps working; no PDF/X-4 label.

## Acceptance (local: production build of `91c34a9`, APP_ENV=dev and APP_ENV=production, Stripe test mode)

| Check                                                                                                                                                                           | Result                                                                                                               |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Lint (0 errors), format, typecheck, `pnpm test` (1,247), `pnpm test:db` (248), build                                                                                            | PASS                                                                                                                 |
| Parts 1, 2, 5 focused checks: Chromium 390 / 834 / 1440, WebKit 390                                                                                                             | PASS (8 / 4 / 4 / 8)                                                                                                 |
| Guest homepage, no horizontal overflow, 21 locales: Chromium 320 / 390 / 834 / 1440, WebKit 320 / 390                                                                           | PASS (21/21 each)                                                                                                    |
| /developers in production mode: 20 public routes 200; bulk and scans 404; 420/420 locale pages; no Soon; overview SDK "Live on npm", REST "Live", qr-core "Not on npm yet"      | PASS                                                                                                                 |
| Terms and Privacy, 21 locales: no draft banner; consent links on sign-in                                                                                                        | PASS                                                                                                                 |
| New account 1 (Chromium 1440): guest → sign-in → Stripe test Checkout → confirming → download → decode → reload / new session → repeat download, 1 order / 1 session / 1 charge | PASS 8/8                                                                                                             |
| New account 2 (WebKit 390): same journey                                                                                                                                        | PASS 8/8                                                                                                             |
| Server warnings during both journeys; browser console warnings and errors across 60 page loads (guest and both accounts at 390 / 834 / 1440)                                    | none                                                                                                                 |
| Public SDK install, export, errors and retry                                                                                                                                    | reused: HEY-173 PASS, HEY-186 PASS                                                                                   |
| Production (https://www.heyqr.me)                                                                                                                                               | read-only: REST v1 live (401 without a key); this branch isn't deployed, so its UI changes are verified locally only |

The first run of account 1 stopped in the harness (the Stripe listener it pauses wasn't running yet); the rerun with a
new account passed. Google sign-in completion is a fixture (the redirect to Google's consent is genuine).

## Still open

- CMYK print profiles: ICC licensing and a colour engine (part 6).
- Legal: the policies still contain unconfirmed `[[…]]` placeholders and an effective date "set on approval"; the pages
  stay `noindex` until those are resolved (docs/legal/REVIEW.md).
- Translations of the new homepage and /developers copy haven't been reviewed by native speakers.
- Deploy this branch and repeat the guest/journey checks on the production origin.
