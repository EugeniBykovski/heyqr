# Design coverage: Claude Design → app

Reference: Claude Design artifact `5ad84e52-9181-4f2c-a6f5-04e11a8a57c9`, revision **1795122922-cd26** (scope: frames 1.1–9.7).
Every "Key screens" frame renders the prototype at **390, 834 and 1440 px**; each width is recorded separately.

Status: ✅ implemented and verified in the browser · 🟡 exists, needs alignment with the frame · ❌ not built ·
⛔ needs a backend or account that isn't available (UI can only be shown with a fixture).

Evidence paths are in the scratchpad screenshots of the run that recorded them (see the PR/commit message), or a
verification script result (named here).

## 1 · Create

| Frame                             | Route / how to reach                    | 390 | 834 | 1440 | Evidence / notes                                                                                                        |
| --------------------------------- | --------------------------------------- | --- | --- | ---- | ----------------------------------------------------------------------------------------------------------------------- |
| 1.1 Home                          | `/`                                     | ✅  | ✅  | ✅   | final-home-{390,834,1440}.png; hero tool, examples, features, types, FAQ, CTA, footer                                   |
| 1.2 Type                          | `/create?step=type` (home "More +")     | ✅  | ✅  | ✅   | final-type-*.png; editor-flow steps 1–3, 11 (cards, Static/Dynamic, bar, Continue)                                      |
| 1.3 Content · contact card        | `/create?step=content`, Contact         | ✅  | ✅  | ✅   | Name / title pairs, optional private name, live phone preview, field errors with a summary banner                       |
| 1.4 Content · Wi-Fi               | `/create?step=content`, Wi-Fi           | ✅  | ✅  | ✅   | Security segmented control, Show/Hide in the form only, hidden-network option; the preview always masks the password    |
| 1.5 Content · text                | `/create?step=content`, Text            | ✅  | ✅  | ✅   | "N of 300 characters" hint, newlines kept; older longer texts stay usable                                               |
| 1.6 Design · colors               | `/create?step=design` → Colors          | ✅  | ✅  | ✅   | Grouped settings; six colour roles (modules, corners, background, frame, caption), swatches, HEX, role reset, Reset all |
| 1.7 Design · pattern              | Design → Pattern                        | ✅  | ✅  | ✅   | 8 module shapes, 5 corner frames, 5 corner centers, each with a renderer-drawn crop                                     |
| 1.8 Design · size                 | Design → Size                           | ✅  | ✅  | ✅   | HEY-35/36 units, QR size vs layout size, presets; stage footer shows layout, QR and file dimensions                     |
| 1.9 Scan check failed             | `/create?step=design` with low contrast | 🟡  | 🟡  | 🟡   | Issues list shown; design offers one-tap fixes (reduce logo, increase contrast, swap colours)                           |
| 1.10 Full-screen preview          | Design, expand button (< 1024 px)       | ✅  | ✅  | —    | Dialog with the same canvas, dimensions and scan check; Done returns focus to the expand button                         |
| 1.11 Icon library                 | Design → Logo → Icon library            | ✅  | ✅  | ✅   | 38 searchable vector icons, plate or colour tile; upload, size 10–46 %, backing, position (centre / top of card)        |
| 1.12 Quick styles · Undo · canvas | Design → Layout; stage bar              | ✅  | ✅  | ✅   | Six quick styles + Surprise me (one undo step each), Undo/Redo, Light/Dark/Clear canvas, Fit/Actual size                |
| 1.13 Language switch              | header                                  | ✅  | ✅  | ✅   | Searchable panel, 21 languages with flags, native and English names, 2 columns, full width on phones; Arabic → RTL      |
| 1.14 Content · event              | `/create?step=content`, Event           | ✅  | ✅  | ✅   | Date + start/end times over start/end; date-only = all-day VEVENT; preview shows the localised date and times           |
| 1.15 Frame gallery                | Design → Frame                          | ✅  | ✅  | ✅   | No frame + 8 live thumbnails, 16-character text, quick phrases, frame and text colours, colour presets                  |
| 1.16 Caption in the code          | Design → Caption → Position             | ✅  | ✅  | ✅   | Below / above / in the code; the scan check flags text that hides too much                                              |

## 2 · Branded, end to end

| Frame                              | Route                          | 390 | 834 | 1440 | Notes                                                                                                                                                                                 |
| ---------------------------------- | ------------------------------ | --- | --- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2.1 Website · loading              | `/create` first load           | ✅  | ✅  | ✅   | Heading and stepper at once; type cards hold their exact size (HEY-41 skeletons)                                                                                                      |
| 2.2 Content · empty                | `/create?step=content`         | ✅  | ✅  | ✅   | After scanning shows placeholders (final-content-*.png)                                                                                                                               |
| 2.3 Content · domain               | Content with a URL             | ✅  | ✅  | ✅   | Preview shows the host                                                                                                                                                                |
| 2.4 Choose mode (custom / branded) | Design, new draft              | ✅  | ✅  | ✅   | Two live examples of the same code; fixed: previews drew past their cards (QrPreview now keeps the layout's ratio inside its box)                                                     |
| 2.5 Branded · upload               | Design → Brand                 | ✅  | ✅  | ✅   | Drop zone, photos or files, sample logo; fixed: tall uploads overflowed the 48 px thumbnail (wide/tall/square PNG and SVG checked)                                                    |
| 2.6 Branded · reading              | Design → Brand                 | ✅  | ✅  | ✅   | File name + "Reading colors…"; last design stays; newer files win (stale results dropped)                                                                                             |
| 2.7 Branded · three looks          | Design → Brand                 | ✅  | ✅  | ✅   | Palette roles, contrast note; fixed: the Brand card look thumbnail was cropped (nested code SVG stretched)                                                                            |
| 2.8 Branded · brand card           | Design → Brand → Brand card    | ✅  | ✅  | ✅   | Shared renderer `brandHeader`: logo in a bounded box with its own aspect ratio, name measured and wrapped/reduced beside it, never cut; same in editor, PNG, SVG, print PDF (decoded) |
| 2.9 Branded · colors changed       | Design → Brand → roles         | ✅  | ✅  | ✅   | Only the QR changes; the scan check judges the new colours (sage accent flagged with its fix)                                                                                         |
| 2.10 Export · guest                | `/create/export` (signed out)  | ✅  | ✅  | ✅   | Same surface from the browser draft; Continue with Google carries format, size and transparency                                                                                       |
| 2.11 Paid PNG                      | `/create/export` after payment | ⛔  | ⛔  | ⛔   | Needs Stripe (HEY-8 hosted setup)                                                                                                                                                     |

## 3 · Export & purchase

| Frame                  | Route                              | 390 | 834 | 1440 | Notes                                                                                             |
| ---------------------- | ---------------------------------- | --- | --- | ---- | ------------------------------------------------------------------------------------------------- |
| 3.1 Export · guest     | `/create/export` (signed out)      | ✅  | ✅  | ✅   | Layout, PNG/SVG, PNG size, transparency, order summary, Continue with Google                      |
| 3.2 Google sign-in     | `/sign-in?next=…`                  | 🟡  | 🟡  | 🟡   | Google-only sign-in works up to Google; full sign-in pending the owner's manual check             |
| 3.3 Back from Google   | `/create?resume=1&format=…`        | ✅  | ✅  | ✅   | Saves the draft, opens export with the same settings and the "Signed in with Google" banner       |
| 3.4 Checkout           | Stripe Checkout                    | ⛔  | ⛔  | ⛔   | Hosted Stripe Checkout; the request fails from this environment, so no live run (no charges made) |
| 3.5 Cancelled          | `?checkout=cancelled`              | ✅  | ✅  | ✅   | "You weren’t charged" banner; settings kept (fixed: return URLs lacked the code id → 404)         |
| 3.6 Confirming payment | `?checkout=success` before webhook | ✅  | ✅  | ✅   | Controls frozen, preview kept, the page re-checks every 2.5 s; ⛔ live webhook not run locally    |
| 3.7 Preparing file     | Download                           | ✅  | ✅  | ✅   | "Preparing your PNG…" in the preview and the action; settings frozen                              |
| 3.8 File ready         | after preparing                    | ✅  | ✅  | ✅   | One action: Download PNG (the user’s own click saves the prepared file)                           |
| 3.9 Downloaded         | after download                     | ✅  | ✅  | ✅   | Real file name from the server (UTF-8 names fixed), Download again                                |
| 3.10 Export error      | API error                          | ✅  | ✅  | ✅   | Payment and settings safe; Try again repeats the same request                                     |
| 3.11 Download again    | `/create/export?qr=…&layout=…`     | ✅  | ✅  | ✅   | Layout tabs per named layout; second layout (Poster) as SVG verified and decoded                  |

## 4 · Account

| Frame                     | Route                        | 390 | 834 | 1440 | Notes                                                                                                                                                                                               |
| ------------------------- | ---------------------------- | --- | --- | ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 4.1 My QR codes · empty   | `/dashboard` (no codes)      | ✅  | ✅  | ✅   | HEY-3                                                                                                                                                                                               |
| 4.2 My QR codes           | `/dashboard`                 | ✅  | ✅  | ✅   | Thumbnail, badges, Edit design, Download / Buy, inline rename (Enter saves, Escape cancels, failures keep the text)                                                                                 |
| 4.3 Details · static      | `/dashboard/qr/[id]`         | ✅  | ✅  | ✅   | Type/model/status badges, New layout, Content · Fixed in the code, inclusions, layouts with dims, Edit, PNG/SVG or Buy, Open Print Preview / Set up for print                                       |
| 4.4 Details · dynamic     | `/dashboard/qr/[id]`         | ✅  | ✅  | ✅   | Short link · Permanent with Copy, destination, Scans · last 14 days with Total / Today and day labels                                                                                               |
| 4.5 Editing destination   | details → Change destination | ✅  | ✅  | ✅   | https:// + address, hint with the short link, Save destination / Cancel; server validates                                                                                                           |
| 4.6 Destination saved     | details page                 | ✅  | ✅  | ✅   | Saved badge and "Previously …" after the server confirmed the save                                                                                                                                  |
| 4.7 No scans yet          | details page                 | ✅  | ✅  | ✅   | Empty state when the 14 days have no scans                                                                                                                                                          |
| 4.8 Pricing               | `/pricing`                   | ✅  | ✅  | ✅   | One-time (Free, Single QR) and Monthly (Dynamic) groups, live-slot box, comparison table (scrolls on phones). Packs, Starter/Studio and Print Pack are not offered by the backend, so not published |
| 4.10 My QR codes · select | `/dashboard` → Select        | ✅  | ✅  | ✅   | Checkboxes, Select all, count, Cancel, Delete; per-card trash                                                                                                                                       |
| 4.11 Delete · confirm     | Delete                       | ✅  | ✅  | ✅   | Bottom sheet on phones, dialog from 600 px; consequences per kind of code                                                                                                                           |
| 4.12 Deleted · undo       | after Delete                 | ✅  | ✅  | ✅   | 8-second Undo restores through the server (soft delete, 10-minute window)                                                                                                                           |
| 4.9 Plan & billing        | `/dashboard/billing`         | ✅  | ✅  | ✅   | Plan status, live Dynamic usage vs limit, renewal, payment method via Stripe portal, Compare plans, purchases with dates                                                                            |

## 7 · Plans, checkout & limits

| Frame                              | Route                | 390 | 834 | 1440 | Notes                                                                                                           |
| ---------------------------------- | -------------------- | --- | --- | ---- | --------------------------------------------------------------------------------------------------------------- |
| 7.1 Pricing · local currency       | `/pricing` → GBP/PLN | ✅  | ✅  | ✅   | Viewer preference; currencies without price points say checkout is in the charged currency (no invented prices) |
| 7.2–7.7 Print Pack, Studio, limits | Export               | ⛔  | ⛔  | ⛔   | No Print Pack, plans, credits or unlock counters in the backend; not shown as purchasable                       |

## 6 · Signed-in home

| Frame                       | Route                   | 390 | 834 | 1440 | Notes                                                                                                                                                                             |
| --------------------------- | ----------------------- | --- | --- | ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 6.1 Home · signed in        | `/` signed in           | ✅  | ✅  | ✅   | Studio: the user’s own codes, scans and plan usage (server-rendered, per user)                                                                                                    |
| 6.1 Home · guest            | `/` signed out          | ✅  | ✅  | ✅   | Sample workspace (labelled, inert); Start 7-day free trial → sign in → `/dashboard/trial`; Sign in; Create. Signed in: Studio offers the trial only when the server says eligible |
| 6.2 Home · new account      | `/` signed in, no codes | ✅  | ✅  | ✅   | Studio empty state with one action                                                                                                                                                |
| 6.x Print Pack introduction | —                       | ⛔  | ⛔  | ⛔   | Print Pack is not offered by the backend; not published                                                                                                                           |

## 8 · Print Pack & Print Preview

| Frame                                    | Route                                | 390 | 834 | 1440 | Notes                                                                                                                                                                                           |
| ---------------------------------------- | ------------------------------------ | --- | --- | ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 8.1 Print Preview · generating           | `/print?qr=&layout=`                 | ✅  | ✅  | ✅   | Captured by holding `POST /api/print/preview` (CDP fixture); page ratio kept; logo cell "Checking…"; purchase line from the server, not guessed                                                 |
| 8.2 Print Preview · locked, logo warning | `/print`                             | ✅  | ✅  | ✅   | 120 px logo: 210 ppi at 150 % with warning, 316 ppi after Use 100% size; zoom Fit/100/200 (200 % scrolls inside the stage on phones), guides toggle; price unset → only purchase is unavailable |
| 8.3 Print Preview · pending              | `/print?checkout=success`            | ✅  | ✅  | ✅   | Back from Stripe before the webhook: "Confirming your payment…", rechecked every 3 s; unlocked only by the webhook                                                                              |
| 8.4 Print Preview · Studio allowance     | —                                    | ⛔  | ⛔  | ⛔   | No Studio plan or included Print Packs                                                                                                                                                          |
| 8.5 Print Preview · unlocked             | `/print`, `GET /api/print/files/:id` | ✅  | ✅  | ✅   | Print PDF (page + bleed + crop marks, vector, fonts embedded), editable SVG at finished size, specifications PDF; 402 locked, 409 stale render key                                              |
| 8.6 QR details · add Print Pack          | `/dashboard/qr/:id`                  | ✅  | ✅  | ✅   | Every mm layout card: Open Print Preview (locked or not, price set or not); px layouts: Set up for print → Edit design → Size → saved in mm → Print Preview                                     |
| 8.7 QR details · Print Pack files        | `/dashboard/qr/:id`                  | ✅  | ✅  | ✅   | Repeat downloads at default settings; Open Print Preview                                                                                                                                        |
| CMYK profiles, 100% K                    | `/print`                             | ✅  | ✅  | ✅   | Shown as unavailable: no ICC conversion in this deployment; files are sRGB with HEX values                                                                                                      |

## 9 · Trial & usage

| Frame                              | Route                                   | 390 | 834 | 1440 | Notes                                                                                                                                                                            |
| ---------------------------------- | --------------------------------------- | --- | --- | ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 9.1 Trial · active                 | `/dashboard/trial`                      | ✅  | ✅  | ✅   | Verified in the app (dev DB): started from Home, test code via Export "Use your free trial", short link 302s, scans; Activate = Dynamic plan (Stripe); account menu "Free trial" |
| 9.2 Trial · ending                 | `/dashboard/trial`                      | ✅  | ✅  | ✅   | Last day; the design's "Remind me by email" is not offered (no scheduled reminders)                                                                                              |
| 9.3 Trial · expired                | `/dashboard/trial`, `/r/<code>`         | ✅  | ✅  | ✅   | The test code's redirect goes to "This link is paused"; the code shows Paused; nothing deleted                                                                                   |
| 9.4 Trial · upgraded               | `/dashboard/trial`                      | ✅  | ✅  | ✅   | An active Dynamic plan after a trial; same short link redirects (checked with a subscription fixture)                                                                            |
| 9.5 My QR codes · during the trial | `/dashboard`, `/dashboard/billing`      | ✅  | ✅  | ✅   | Trial banner with days left; trial slot usage (live count)                                                                                                                       |
| 9.6 My QR codes · Studio usage     | —                                       | ⛔  | ⛔  | ⛔   | Studio plan, monthly unlocks and Print Packs are not offered                                                                                                                     |
| 9.7 Plan & billing · Studio        | —                                       | ⛔  | ⛔  | ⛔   | Same                                                                                                                                                                             |
| Trial · Print Pack sample          | `/dashboard/trial`, `/api/print/sample` | ✅  | ✅  | ✅   | Demo QR (Little Fern brand card → app home), same print code as a bought Print Pack; 403 without a running trial                                                                 |

## Missing integrations and what they block

| Capability (handoff)                                                      | Status in this deployment                                          | Workflows affected                                                                    |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------- |
| Print service: PDF page preview, print files, render keys, CMYK profiles  | Built, sRGB only (no ICC/CMYK conversion)                          | CMYK profiles and 100% K on Print Preview                                             |
| Print Pack entitlement (+price, Studio allowance)                         | Per-code add-on via `STRIPE_PRICE_PRINT_PACK`; no Studio allowance | Export Print Pack switch (7.2–7.4), Home Print Pack section, 8.4                      |
| Plans Starter / Studio, monthly static unlocks, static credits, usage API | Not implemented (one Dynamic plan, one static price)               | Pricing packs/plans, Export limits 7.5–7.7, Billing counters                          |
| 7-day trial                                                               | Built (server dates, one test Dynamic slot, no card)               | Activation names the existing Dynamic plan; the design's "Starter" plan doesn't exist |
| Multi-currency price points (GBP, PLN)                                    | One charged currency (env)                                         | Pricing shows an explicit "charged in USD" notice                                     |
| Stripe Checkout (live)                                                    | Configured but not reachable from this environment                 | Pay → checkout redirect; cancel/confirm states verified with URL states only          |
| Translations other than EN/RU                                             | Fallback to English                                                | Arabic layout is RTL but text is English (punctuation order in RTL)                   |

## 5 · Loading

| Frame                       | Route                             | 390 | 834 | 1440 | Notes                                                                           |
| --------------------------- | --------------------------------- | --- | --- | ---- | ------------------------------------------------------------------------------- |
| 5.1 Content · loading       | `/create?step=content` first load | ✅  | ✅  | ✅   | Form boxes and the preview shapes; the empty Website preview is static (HEY-41) |
| 5.2 Design · loading        | `/create` first load              | 🟡  | 🟡  | 🟡   | Skeleton matches the Design layout; Type/Content steps need their own           |
| 5.3 Rebuilding branded look | Design, Branded                   | ✅  | ✅  | ✅   | "Updating branded design… keep editing" over the last ready canvas              |
| 5.4 My QR codes · loading   | `/dashboard` loading              | ✅  | ✅  | ✅   | HEY-3 (verified with a temporary delay)                                         |

## Components, breakpoints and system boards

| Board                                                                              | Status  | Notes                                                                                                            |
| ---------------------------------------------------------------------------------- | ------- | ---------------------------------------------------------------------------------------------------------------- |
| Brand, Design System, Tokens                                                       | ✅      | HEY-189 + 4f8a token update                                                                                      |
| Components (buttons, fields, selection, stepper, banners, dialog, toast, skeleton) | ✅ / 🟡 | Primitives aligned (HEY-189); ScanStatus one-tap fixes and BrandUpload/BrandPalette/BrandedVariantCard not built |
| ContentPreview                                                                     | 🟡      | All 9 types render; loading shimmer and dynamic short-link step simplified                                       |
| Home · 320 → 2560                                                                  | ✅      | Verified at 390/834/1440; other widths follow the same rules                                                     |
| Editor · Design · 320 → 2560                                                       | 🟡      | Layout matches; Size/quick styles/full-screen missing                                                            |
| Developer handoff                                                                  | 🟡      | Adaptive rules and validation followed; purchase-state machine partly (see 3.x)                                  |
