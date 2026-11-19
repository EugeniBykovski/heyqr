# Design coverage: Claude Design → app

Reference: Claude Design artifact `5ad84e52-9181-4f2c-a6f5-04e11a8a57c9`, revision **1795122922-cd26** (scope: frames 1.1–8.2).
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

| Frame                              | Route                          | 390 | 834 | 1440 | Notes                                                                                           |
| ---------------------------------- | ------------------------------ | --- | --- | ---- | ----------------------------------------------------------------------------------------------- |
| 2.1 Website · loading              | `/create` first load           | ✅  | ✅  | ✅   | Heading and stepper at once; type cards hold their exact size (HEY-41 skeletons)                |
| 2.2 Content · empty                | `/create?step=content`         | ✅  | ✅  | ✅   | After scanning shows placeholders (final-content-*.png)                                         |
| 2.3 Content · domain               | Content with a URL             | ✅  | ✅  | ✅   | Preview shows the host                                                                          |
| 2.4 Choose mode (custom / branded) | —                              | ❌  | ❌  | ❌   | Branded mode not built                                                                          |
| 2.5 Branded · upload               | —                              | ❌  | ❌  | ❌   | Logo upload exists for the center logo only                                                     |
| 2.6 Branded · reading              | —                              | ❌  | ❌  | ❌   | Palette extraction not built                                                                    |
| 2.7 Branded · three looks          | —                              | ❌  | ❌  | ❌   |                                                                                                 |
| 2.8 Branded · brand card           | —                              | ❌  | ❌  | ❌   | Card layouts (vertical/horizontal) not in the editor model                                      |
| 2.9 Branded · colors changed       | —                              | ❌  | ❌  | ❌   |                                                                                                 |
| 2.10 Export · guest                | `/create/export` (signed out)  | ✅  | ✅  | ✅   | Same surface from the browser draft; Continue with Google carries format, size and transparency |
| 2.11 Paid PNG                      | `/create/export` after payment | ⛔  | ⛔  | ⛔   | Needs Stripe (HEY-8 hosted setup)                                                               |

## 3 · Export & purchase

| Frame                  | Route                              | 390 | 834 | 1440 | Notes                                                                                          |
| ---------------------- | ---------------------------------- | --- | --- | ---- | ---------------------------------------------------------------------------------------------- |
| 3.1 Export · guest     | `/create/export` (signed out)      | ✅  | ✅  | ✅   | Layout, PNG/SVG, PNG size, transparency, order summary, Continue with Google                   |
| 3.2 Google sign-in     | `/sign-in?next=…`                  | 🟡  | 🟡  | 🟡   | Google-only sign-in works up to Google; full sign-in pending the owner's manual check          |
| 3.3 Back from Google   | `/create?resume=1&format=…`        | ✅  | ✅  | ✅   | Saves the draft, opens export with the same settings and the "Signed in with Google" banner    |
| 3.4 Checkout           | Stripe Checkout                    | ⛔  | ⛔  | ⛔   | Stripe not configured locally (optional in dev, HEY-8)                                         |
| 3.5 Cancelled          | `?checkout=cancelled`              | ✅  | ✅  | ✅   | "You weren’t charged" banner; settings kept (fixed: return URLs lacked the code id → 404)      |
| 3.6 Confirming payment | `?checkout=success` before webhook | ✅  | ✅  | ✅   | Controls frozen, preview kept, the page re-checks every 2.5 s; ⛔ live webhook not run locally |
| 3.7 Preparing file     | Download                           | ✅  | ✅  | ✅   | "Preparing your PNG…" in the preview and the action; settings frozen                           |
| 3.8 File ready         | after preparing                    | ✅  | ✅  | ✅   | One action: Download PNG (the user’s own click saves the prepared file)                        |
| 3.9 Downloaded         | after download                     | ✅  | ✅  | ✅   | Real file name from the server (UTF-8 names fixed), Download again                             |
| 3.10 Export error      | API error                          | ✅  | ✅  | ✅   | Payment and settings safe; Try again repeats the same request                                  |
| 3.11 Download again    | `/create/export?qr=…&layout=…`     | ✅  | ✅  | ✅   | Layout tabs per named layout; second layout (Poster) as SVG verified and decoded               |

## 4 · Account

| Frame                     | Route                   | 390 | 834 | 1440 | Notes                                                                                                               |
| ------------------------- | ----------------------- | --- | --- | ---- | ------------------------------------------------------------------------------------------------------------------- |
| 4.1 My QR codes · empty   | `/dashboard` (no codes) | ✅  | ✅  | ✅   | HEY-3                                                                                                               |
| 4.2 My QR codes           | `/dashboard`            | ✅  | ✅  | ✅   | Thumbnail, badges, Edit design, Download / Buy, inline rename (Enter saves, Escape cancels, failures keep the text) |
| 4.3 Details · static      | `/dashboard/qr/[id]`    | 🟡  | 🟡  | 🟡   | Page exists, not aligned                                                                                            |
| 4.4 Details · dynamic     | `/dashboard/qr/[id]`    | 🟡  | 🟡  | 🟡   | Short link, destination form and scans chart exist, not aligned                                                     |
| 4.5 Editing destination   | details page            | 🟡  | 🟡  | 🟡   |                                                                                                                     |
| 4.6 Destination saved     | details page            | 🟡  | 🟡  | 🟡   |                                                                                                                     |
| 4.7 No scans yet          | details page            | 🟡  | 🟡  | 🟡   |                                                                                                                     |
| 4.8 Pricing               | `/pricing`              | 🟡  | 🟡  | 🟡   | Page exists, not aligned                                                                                            |
| 4.10 My QR codes · select | `/dashboard` → Select   | ✅  | ✅  | ✅   | Checkboxes, Select all, count, Cancel, Delete; per-card trash                                                       |
| 4.11 Delete · confirm     | Delete                  | ✅  | ✅  | ✅   | Bottom sheet on phones, dialog from 600 px; consequences per kind of code                                           |
| 4.12 Deleted · undo       | after Delete            | ✅  | ✅  | ✅   | 8-second Undo restores through the server (soft delete, 10-minute window)                                           |
| 4.9 Plan & billing        | `/dashboard/billing`    | 🟡  | 🟡  | 🟡   | Page exists, not aligned; ⛔ portal needs Stripe                                                                    |

## 5 · Loading

| Frame                       | Route                             | 390 | 834 | 1440 | Notes                                                                           |
| --------------------------- | --------------------------------- | --- | --- | ---- | ------------------------------------------------------------------------------- |
| 5.1 Content · loading       | `/create?step=content` first load | ✅  | ✅  | ✅   | Form boxes and the preview shapes; the empty Website preview is static (HEY-41) |
| 5.2 Design · loading        | `/create` first load              | 🟡  | 🟡  | 🟡   | Skeleton matches the Design layout; Type/Content steps need their own           |
| 5.3 Rebuilding branded look | —                                 | ❌  | ❌  | ❌   | Depends on branded mode                                                         |
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
