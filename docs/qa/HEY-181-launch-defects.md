# HEY-181 / QR-24.07 — launch defects: payment, scanning, access

Run 2026-11-26 from `main` at `ebba8dc` (HEY-180 merged) in a separate worktree, branch `fix/HEY-181-launch-defects`.
Local only: isolated database `heyqr_hey181_e2e`, production build on port 3181, Stripe **test mode** (Sandbox
Checkout, the Stripe CLI forwarding webhooks), no e-mail, no object storage, test sessions instead of Google sign-in.

**Evidence used:** the HEY-180 matrix and report (`docs/qa/HEY-180-prelaunch-matrix.md`). **Missing:** the Jira issue
and any linked traces (the connected Atlassian site has no HEY project), and HEY-180's screenshots and traces, which
lived in a session scratchpad. A focused baseline on the current build stood in for them.

## Baseline on the current build (before fixes)

| Area                         | Run                                                        | Result                                                                                                                                     |
| ---------------------------- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Payment and export           | HEY-180 purchase rows, Chromium and WebKit at 1440 and 390 | 20 / 20 PASS                                                                                                                               |
| Access                       | HEY-180 account rows, same runs                            | 20 / 20 PASS                                                                                                                               |
| Scanning and access journeys | `scripts/qa/critical-journeys.ts` (25 checks)              | 25 PASS (after correcting 3 checks of the script itself: these pages stream, so signed-out visitors get a streamed redirect with HTTP 200) |
| Paid print files             | `scripts/qa/print-matrix.ts`                               | HEY-180 blocker reproduced (below)                                                                                                         |

Fixes already on `main` from HEY-180 (print PNG dpi, the paid-export note, landmarks, focus stops) were confirmed present
and kept passing.

## Defect

**D1 · Paid files with unreadable captions (launch blocker: incorrect paid export).** Expected: the downloaded files show
the caption that was designed. Actual: every file embeds only the caption font, so characters it lacks print as empty
boxes in the PDF and depend on the server's or viewer's fonts in the PNG and SVG, while the editor preview looks right
(the browser falls back to its own fonts). Reproduced with a Han caption (PDF: eight boxes). Wider than HEY-180 found:
coverage differs by font, so locales the app offers are affected even in Latin script —

| Font               | Can't draw (examples)                                 |
| ------------------ | ----------------------------------------------------- |
| all six            | Chinese, Japanese, Korean, Hindi, Arabic, Thai, emoji |
| Prata              | Polish ż ł ć ę ś ą ź ń, Turkish Ğ ş İ                 |
| Golos Text, Caveat | Vietnamese ườố                                        |

**Fix (root cause: no glyph coverage check anywhere).** `unsupportedCaptionChars` in `@heyqr/qr-core` reads each face's
own code points (the generated caption metrics), so the browser and the server decide the same way.

- Editor: the caption field (Caption group, Frame, the home quick start) and the brand card name refuse undrawable
  characters and say which ones and why; a font change that leaves some marks the field invalid, so Export stops
  there with focus on the field. Nothing is truncated.
- Server: `createLayoutRecord`, the write check behind every save, Edit design, Add layout and the public API, refuses
  such a layout; the API answers `422 invalid_request` with `layouts[i].layout.caption.text` naming the characters.
  Nothing is stored, so no Checkout can start for it.
- Not done: shipping fonts for these scripts (a product decision and several MB of fonts). Layouts saved before this
  change are still exported as they are.

**Regression tests:** `src/entities/qr/model/caption-coverage.test.ts`, `caption.test.tsx` (refusal, font change,
Export blocked), `db.integration.test.ts` (“caption font coverage on save”: 422, nothing stored). HEY-43's emoji case
now uses a combining sequence the fonts draw; emoji captions are refused like other undrawable text.

## Verification after the fix

| Critical check                                                                                                                           | Where                                                                                | Result                                                                     |
| ---------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ | -------------------------------------------------------------------------- |
| Create QR → paid export locked (402) → test Checkout cancelled → declined card → 4242 → first download → repeat export                   | ui-matrix purchase rows, Chromium 156 / Firefox 157 / WebKit 27.2 × 390 / 834 / 1440 | **PASS** 45 / 45                                                           |
| Duplicate webhook delivery (Stripe `events resend` of a processed checkout event)                                                        | Stripe CLI → local webhook                                                           | **PASS**: 200, paid orders, events, unlocks and credits unchanged          |
| Entitlement persists after reload, repeat export without a second order                                                                  | ui-matrix                                                                            | **PASS**                                                                   |
| Static export decodes to its payload                                                                                                     | critical-journeys (ZXing)                                                            | **PASS**                                                                   |
| Dynamic export decodes to its permanent short link → destination; destination change reaches the same file                               | critical-journeys                                                                    | **PASS**                                                                   |
| Paused / deleted → unavailable page; resume / undo → same link back; plan ended → “not active”                                           | critical-journeys                                                                    | **PASS**                                                                   |
| Operator-blocked codes                                                                                                                   | —                                                                                    | **N/A**: no blocking mechanism exists (reports are stored for review only) |
| Signed out / owner / second account on files, Download all, print files, receipts, details, edit, export, public API, destination change | critical-journeys + ui-matrix account rows (9 runs)                                  | **PASS**                                                                   |
| Sign-in resumes the target, localized (`/de/create/export?…` → back there)                                                               | server gates and sign-in redirect                                                    | **PASS** (Google OAuth itself NOT RUN)                                     |
| Undrawable caption: error, Export blocked, clears when fixed                                                                             | probe, three engines × 1440 / 390                                                    | **PASS**                                                                   |
| Affected HEY-180 rows: Create, Branded, Keyboard                                                                                         | ui-matrix, 9 runs                                                                    | **PASS** 90 / 90                                                           |
| Print matrix (fonts, presets, Print Pack, uncovered scripts refused on save)                                                             | print-matrix                                                                         | **PASS** 393 / 393                                                         |
| Unit / PostgreSQL suites, lint, typecheck, build                                                                                         | `pnpm test`, `pnpm test:db`, `pnpm lint`, `pnpm typecheck`, `pnpm build`             | **PASS** 1,060 / 235                                                       |
| Physical phone scans of printed codes                                                                                                    | —                                                                                    | **NOT RUN** (no device)                                                    |

Commands: see the headers of `scripts/qa/ui-matrix.mjs`, `scripts/qa/print-matrix.ts` and
`scripts/qa/critical-journeys.ts`; environment as in HEY-180 with port 3181 and database `heyqr_hey181_e2e`.

## Remaining

- **Payment:** no defect found; live mode, 3-D Secure and Google sign-in end to end are unverified.
- **Scanning:** no defect found; physical scans unverified.
- **Access:** no defect found.
- **Product decision still open:** captions in the scripts above are now refused instead of exported broken; offering
  them needs fonts for those scripts.
- Paid files through private storage (R2 signed links) remain unverified locally.
