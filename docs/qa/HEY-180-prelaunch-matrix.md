# HEY-180 / QR-24.06 — pre-launch regression matrix

Run 2026-11-26 on branch `test/HEY-180-prelaunch-matrix` from `main` at `8ae9ee7`. Local only: an isolated database,
a production build, Stripe **test mode** (Sandbox Checkout and webhooks through the Stripe CLI), no e-mail, no object
storage, Google sign-in replaced by test sessions. Nothing was deployed and nothing was charged.

**UI reference:** the Claude Design handoff `5ad84e52-…` at version `1795603782-11a8` (newer than the revision in
`design-coverage.md`). Read through the Artifact tool; the Jira issue itself couldn't be opened (the connected Atlassian
site has no HEY project), so the handoff comes from the project's own pointer, not from the issue's link. 52 frames of
areas 1–5 (1.2–1.16, 2.1–2.11, 3.1–3.11, 4.1–4.12, 5.1–5.4) were rendered at 390 / 834 / 1440 from the handoff's files.

## Result

|         | UI matrix                                | Font and print matrix                           | Unit tests                                       |
| ------- | ---------------------------------------- | ----------------------------------------------- | ------------------------------------------------ |
| Checks  | 207 (23 scenarios × 9 engine/width runs) | 459 file checks + 66 editor font checks         | 1,055 (131 files), 227 skipped (database suites) |
| PASS    | 205                                      | 456 + 66                                        | all                                              |
| FAIL    | 0 after fixes                            | 0 after review (3 naive edge checks, see Print) | 0                                                |
| NOT RUN | 2                                        | physical print and phone scans                  | —                                                |

Four defects were fixed, each with a regression test that fails without the fix (below). **Two launch blockers remain**
(Caption scripts, and the unverified hosted parts).

## Environment and commands

| Engine                               | Version      | Viewports                         |
| ------------------------------------ | ------------ | --------------------------------- |
| Chromium (Playwright 1.64.1)         | 156.0.8078.4 | 390 × 844, 834 × 1112, 1440 × 900 |
| Firefox (Playwright 1.64.1)          | 157.0        | same                              |
| WebKit (Playwright 1.64.1)           | 27.2         | same                              |
| Native Safari, iOS / Android devices | —            | **NOT RUN** (none available)      |

```sh
createdb heyqr_hey180_e2e && DATABASE_URL=postgres://localhost:5432/heyqr_hey180_e2e pnpm db:migrate
stripe listen --forward-to localhost:3180/api/stripe/webhook --events checkout.session.completed,…   # test mode
APP_ENV=dev PORT=3180 … (test Stripe keys, no Resend, no S3, no Sentry) next build && next start -p 3180
node scripts/qa/ui-matrix.mjs <chromium|firefox|webkit> <390|834|1440>          # header lists its env
pnpm exec tsx scripts/qa/print-matrix.ts                                         # header lists its env
pnpm test
```

Screenshots, failure trees, exported files and the reference renders stayed in the session scratchpad (about 140 MB;
not committed). Re-running the two scripts recreates them.

## 1 · Browser and UI matrix

Each cell: one run of that engine at that width. ¹ verified by a direct probe in all three engines (skeleton during a
4 s delay, then the list) after the harness's phone-menu timing kept missing it. ² harness navigation interrupted; at
390 px the same prepare-and-download path passed in the error/retry row.

| Area     | Scenario                                                                                 | CH 390 | CH 834 | CH 1440 | FF 390   | FF 834 | FF 1440 | WK 390   | WK 834 | WK 1440 |
| -------- | ---------------------------------------------------------------------------------------- | ------ | ------ | ------- | -------- | ------ | ------- | -------- | ------ | ------- |
| Create   | Type step, Website preselected, no overflow                                              | PASS   | PASS   | PASS    | PASS     | PASS   | PASS    | PASS     | PASS   | PASS    |
| Create   | Wi-Fi: empty Continue → field errors, summary, focus on the first invalid field          | PASS   | PASS   | PASS    | PASS     | PASS   | PASS    | PASS     | PASS   | PASS    |
| Create   | Back to Type keeps Wi-Fi and the typed network name                                      | PASS   | PASS   | PASS    | PASS     | PASS   | PASS    | PASS     | PASS   | PASS    |
| Create   | Invalid address error; valid address → Design; Back keeps address and name               | PASS   | PASS   | PASS    | PASS     | PASS   | PASS    | PASS     | PASS   | PASS    |
| Create   | Custom workspace: groups, preview, Scan verified, no overflow; draft survives reload     | PASS   | PASS   | PASS    | PASS     | PASS   | PASS    | PASS     | PASS   | PASS    |
| Branded  | Sample logo → palette → three looks                                                      | PASS   | PASS   | PASS    | PASS     | PASS   | PASS    | PASS     | PASS   | PASS    |
| Branded  | Save, reopen from My QR codes: colors and logo kept                                      | PASS   | PASS   | PASS    | PASS     | PASS   | PASS    | PASS     | PASS   | PASS    |
| Branded  | Exported SVG carries every design color (unlocked with a credit fixture)                 | PASS   | PASS   | PASS    | PASS     | PASS   | PASS    | PASS     | PASS   | PASS    |
| Purchase | Locked: Pay shown, no Download, file API 402                                             | PASS   | PASS   | PASS    | PASS     | PASS   | PASS    | PASS     | PASS   | PASS    |
| Purchase | Stripe test Checkout cancelled: “You weren’t charged”, still 402                         | PASS   | PASS   | PASS    | PASS     | PASS   | PASS    | PASS     | PASS   | PASS    |
| Purchase | Declined card 4000…0002: Stripe shows the decline, no paid order, still 402              | PASS   | PASS   | PASS    | PASS     | PASS   | PASS    | PASS     | PASS   | PASS    |
| Purchase | Card 4242: return, confirmation, webhook grant, PNG downloaded                           | PASS   | PASS   | PASS    | PASS     | PASS   | PASS    | PASS     | PASS   | PASS    |
| Purchase | Repeat export (SVG, PNG 4×) without a second order                                       | PASS   | PASS   | PASS    | PASS     | PASS   | PASS    | PASS     | PASS   | PASS    |
| Account  | Signed out → sign-in                                                                     | PASS   | PASS   | PASS    | PASS     | PASS   | PASS    | PASS     | PASS   | PASS    |
| Account  | Empty account: empty state with Create                                                   | PASS   | PASS   | PASS    | PASS     | PASS   | PASS    | PASS     | PASS   | PASS    |
| Account  | Populated: list, details, paid export 200 for the owner                                  | PASS   | PASS   | PASS    | PASS     | PASS   | PASS    | PASS     | PASS   | PASS    |
| Account  | Delete dialog: Escape closes it, focus back on its trigger                               | PASS   | PASS   | PASS    | PASS     | PASS   | PASS    | PASS     | PASS   | PASS    |
| Account  | Another account: details, edit, export page show not-found; PNG/SVG/PDF/ZIP 404          | PASS   | PASS   | PASS    | PASS     | PASS   | PASS    | PASS     | PASS   | PASS    |
| Loading  | My QR codes skeleton (`aria-busy`) under a controlled RSC delay, then the list           | PASS¹  | PASS   | PASS    | PASS¹    | PASS   | PASS    | PASS¹    | PASS   | PASS    |
| Loading  | Export “Preparing your PNG…” under a 3 s delay, then “ready” and the file                | PASS   | PASS   | PASS    | NOT RUN² | PASS   | PASS    | NOT RUN² | PASS   | PASS    |
| Loading  | Export failure → Try again, settings kept, retry delivers, no second order               | PASS   | PASS   | PASS    | PASS     | PASS   | PASS    | PASS     | PASS   | PASS    |
| Keyboard | Create → Content → Design → Colors by keyboard, reduced motion, every focus stop visible | PASS   | PASS   | PASS    | PASS     | PASS   | PASS    | PASS     | PASS   | PASS    |
| Keyboard | Language menu by keyboard, Escape, focus returns                                         | PASS   | PASS   | PASS    | PASS     | PASS   | PASS    | PASS     | PASS   | PASS    |

Every row also checks for horizontal overflow on the screens it visits; none was found. WebKit tabs with Option-Tab, as
Safari does by default (plain Tab reaches only fields). Reduced motion was on for the keyboard rows; the flows stayed
usable and the reduced-motion media query was confirmed active.

**Payments.** Every purchase run cancelled one Stripe test Checkout, was declined once and paid once with 4242: 24 paid
test orders over all passes, 74 webhook deliveries, all answered 200.
No live key was used. **Not verified:** live mode, 3-D Secure cards, asynchronous payment methods, refunds from the
Dashboard, subscription Checkout through the UI (the Dynamic plan was a fixture).

### Comparison with the handoff

Reference above, app below, at the same widths, for 16 states (1.2, 1.4, 1.6, 2.4, 2.7, 3.3, 3.5, 3.6, 3.9/3.11, 4.1,
4.2, 4.3, 4.11, 5.4, 3.7, 3.10). Reviewed in detail: 3.5, 3.11, 4.1, 5.4; the others were captured, not reviewed line
by line. Mismatches:

- **Fixed:** 3.11 “Download again” said “You’ll finish on Stripe’s secure checkout…” after payment; the handoff says
  “Included in your purchase. Nothing to pay.”
- Export, paid: heading “Download your code” (handoff “Download your file”); a receipt card where the handoff has “To pay
  now $0.00” with the included list; Download again is an outlined button (handoff: primary).
- Header: “Developers” (handoff “API for developers” / “API”).
- Delete dialog opens with focus on the destructive “Delete code” (APG suggests the safer action).
- After Continue, focus drops to `<body>`; the next Tab enters the new step, so order is kept, but the step isn't
  announced.
- Another account's details / edit / export pages show the not-found screen with HTTP 200 (streamed); no data leaks,
  the file routes answer 404.
- Not accessible: the Jira issue and any screens linked only there.

## 2 · Font and print matrix

**Fonts exposed:** Onest (for DM Sans), Literata (Fraunces), Golos Text (Space Grotesk), Prata (Instrument Serif), Caveat,
IBM Plex Mono; weights 400 / 500 / 700 where shipped (Prata 400 only) — 16 faces. **Print presets:** QR + caption on card
90 × 50, A6 105 × 148, sticker 50 × 62 mm; Vertical card 55 × 85 (41 mm code); Horizontal card 90 × 50 (35 mm code);
Frame (bar, 40 mm); QR only at the smallest 10 mm and largest 200 mm. **Formats:** PNG 300 / 600 / 1200 dpi, SVG, PDF,
and the Print Pack (print PDF, editable SVG, specification PDF) at ×1 / ×1.5 / ×2 with bleed 0 / 3 / 5 mm.

| Check (all presets and fonts)                                                            | PASS | FAIL                                                                                                                                                          |
| ---------------------------------------------------------------------------------------- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PNG pixels = mm ÷ 25.4 × dpi                                                             | 98   | 0                                                                                                                                                             |
| PNG resolution metadata (pHYs) = the chosen dpi                                          | 98   | 0 after the fix (98 before)                                                                                                                                   |
| SVG width/height in mm, viewBox aspect                                                   | 66   | 0                                                                                                                                                             |
| PDF page = layout size                                                                   | 33   | 0                                                                                                                                                             |
| Print Pack PDF page ≥ finished size + 2 × bleed; SVG at finished size; spec sheet        | 63   | 0                                                                                                                                                             |
| Quiet zone = 4 modules at 10 mm and 200 mm                                               | 3    | 0                                                                                                                                                             |
| Caption font embedded in the SVG                                                         | 24   | 0                                                                                                                                                             |
| Static decodes to its payload (ZXing, every preset and font)                             | 33   | 0                                                                                                                                                             |
| Dynamic decodes to its permanent short link; the link 302s (no-store) to the destination | 2    | 0                                                                                                                                                             |
| Nothing clipped at the edges                                                             | 31   | 3 → reviewed: card borders are inset by half their stroke (0.30 / 0.315 mm), the frame's fill reaches the edge by design; the script now checks that geometry |
| Editor (Chromium, Firefox, WebKit): font face loaded; caption line breaks = exported SVG | 66   | 0 (4 probe rows for Plex Mono 500/700 read “not loaded” because the probe asked for weight 400; their 500/700 faces were loaded)                              |

Plex Mono: the caption family “IBM Plex Mono” has the same name as the app's own UI mono font, so the browser preview can pick the UI's faces; line breaks matched in every engine, but nothing enforces it.

The 1200 dpi PNG of the 200 mm code exceeds the 8,192 px limit and is refused (422), as the UI's choices say. Long
captions wrapped identically in the editor and the files for all 16 faces.

**Physical:** no printer or phone camera was available. **NOT RUN:** printing at actual size (especially the 10 mm code)
and scanning with phones. Digital decoding above is not a substitute.

## Fixes (regression tests)

| Defect                                                                                                          | Fix                                                                                             | Test                                                               |
| --------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| Print PNGs had no pHYs: a 300 dpi 90 × 50 mm card placed at 375 × 208 mm in layout software                     | `rasterizeSvg({ dpi })` writes pHYs after IHDR; print exports pass their dpi                    | `src/server/qr/png-resolution.test.ts`; HEY-49 parity test updated |
| After payment the note under Download again promised Stripe checkout (handoff 3.11)                             | Paid: “Included in your purchase. Nothing to pay.”; Stripe note only on paths that go to Stripe | `export-surface.test.tsx` (“the note under the main action”)       |
| Seven screens opened a second `<main>` inside the layout's `<main id="main">`                                   | Inner `<main>` → `<div>`                                                                        | `src/app/[locale]/landmarks.test.ts`                               |
| Editor step panels (and the shared TabsContent) were Tab stops with no focus ring (WCAG 2.4.7; seen in Firefox) | `tabIndex={-1}`, as HEY-63 did for the settings panels                                          | `src/shared/ui/tabs.test.tsx`                                      |

Rows rerun after the fixes: the whole UI matrix (second pass) and the whole print matrix.

## Launch blockers

1. **Captions in Chinese, Japanese, Korean, Hindi, Arabic and Thai.** The app offers those interface languages, but the
   caption fonts cover Latin and Cyrillic only. The editor draws such captions with the browser's fallback; the PDF
   draws empty boxes (verified for Han); the PNG uses whatever fonts the server has (here macOS; a production server
   likely has none); the SVG depends on the viewer. A paid print file can carry an unreadable caption. Needs a product
   decision: ship fonts for these scripts, or tell people in the editor that the caption font can't draw them.
2. **Unverified before launch:** live Stripe mode; native Safari and real phones; physical print and phone scans,
   smallest preset first; Google sign-in (sessions were test sessions); paid files through private storage (R2) —
   here, without storage configured, files were streamed and regenerated per request, so the signed-link path was
   not exercised.
