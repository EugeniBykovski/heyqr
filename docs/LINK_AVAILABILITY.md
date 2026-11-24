# Link availability after a trial, a cancellation or a failed renewal

HEY-138 / QR-19.01. What happens to an owner's codes in each case, as the current version behaves. Rules that are
agreed but not yet enforced are listed under **Gaps** with their follow-up; decisions nobody has made yet are under
**Missing decisions**. Pre-payment copy (Pricing rules 4 and 5, the compare row "After you cancel", and the note under
every subscribe button: `plans.terms`) only states what this matrix marks as confirmed.

## Owner matrix

| Situation                                                                                | Redirects of printed Dynamic codes                                                                                            | Downloads, activation, slots                                                                                                                                                                               | Confirmed by                                                                                                                                 |
| ---------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| **1. 7-day trial ends** (no plan)                                                        | The trial's test code stops redirecting at the trial's end time (start + 7 days); scanners get the neutral "not active" page. | No test-code downloads. Taking a plan (the trial page's Activate Starter, paid Checkout only on that click) turns the **same QR and short link** back on, to its current destination.                      | `trialPhase`, `trialCovers` (`server/billing/trial.ts`); `app/r/[code]/route.test.ts` (HEY-121); PostgreSQL "expired trial → plan" (HEY-133) |
| **2a. Cancellation scheduled** for the period end                                        | Unchanged until the period ends.                                                                                              | The plan, its slots and monthly allowances stay until Stripe ends the subscription at the period end. Monthly tiles say "Plan ends {date} · no reset".                                                     | PostgreSQL "status sync" (HEY-134); `usage-tiles.test.tsx` (HEY-136)                                                                         |
| **2b. Final cancellation** (period over)                                                 | **Current version: they keep redirecting** (the short-link route checks a subscription only for the trial's code). See Gap 1. | No plan: Dynamic files can't be downloaded; activation and Resume are refused (`no_plan`); 0 slots.                                                                                                        | `canDownload` (`entitlements.ts`); PostgreSQL HEY-134 / HEY-138                                                                              |
| **3a. Renewal payment fails** (Stripe `past_due`)                                        | Unchanged.                                                                                                                    | The plan stays: slots, allowances and downloads as before, while Stripe retries.                                                                                                                           | `PLAN_STATUSES` (`allowances.ts`); PostgreSQL "plan access by subscription status" (HEY-138)                                                 |
| **3b. Payment not recovered**                                                            | As in 2b (current version).                                                                                                   | When Stripe ends the subscription (`canceled`) or marks it `unpaid`, the plan ends as after a cancellation. **When** that happens is Stripe's retry setting, not a HeyQR rule; no grace period is defined. | Same; see Missing decision 2                                                                                                                 |
| **3c. Payment recovered** (`past_due` → `active`)                                        | Unchanged.                                                                                                                    | The plan carries on; nothing to restore.                                                                                                                                                                   | PostgreSQL HEY-138                                                                                                                           |
| **4. Scan monitoring threshold** (Starter 10,000, Studio 100,000 monthly scans per code) | **Never suspended** by reaching or passing it.                                                                                | No effect; the threshold is for monitoring only.                                                                                                                                                           | `SCAN_MONITOR_THRESHOLDS` (`catalog-core.ts`); PostgreSQL + HTTP check (HEY-135)                                                             |
| **5. Plan ends after a static QR was unlocked**                                          | A static code holds its content in the pattern: printed copies keep working with no server involved.                          | Its files stay downloadable (all layouts and formats): the unlock belongs to the code, not the plan.                                                                                                       | `canDownload` static rule; `entitlements.test.ts` (HEY-87, "outlives the subscription"); PostgreSQL HEY-138                                  |

Scanner-facing pages stay neutral: they never mention the owner's plan, trial or payment (`link-unavailable`, HEY-121).

## Gaps (agreed rule ≠ current behavior)

1. **Dynamic redirects after the plan ends.** The previous Pricing copy (`plans.rules.4d`, `plans.cmp.dynStop`) and the
   backlog (HEY-17: "pause dynamic redirects") say Dynamic short links stop redirecting when the paid period ends. The
   current route keeps redirecting a non-trial Dynamic code whose plan ended. Enforcement: **HEY-142**. Until it ships,
   the customer copy no longer claims they stop; it states only what is enforced (no downloads or activation).
2. **Redirects during a failed renewal.** HEY-17 mentions pausing redirects for `past_due` "with a grace period". The
   current version keeps everything during `past_due`. Enforcement, if confirmed: **HEY-142**.

## Missing decisions

1. Whether a final cancellation stops Dynamic redirects immediately at the period end (as the old copy said) or after a
   delay. Needed before HEY-142 can be enforced and the copy restored.
2. The grace period for a failed renewal: whether there is one, and how long. Nothing defines it; no duration is stated
   anywhere in the product.
3. Stripe's retry ("smart retries" / dunning) setting and its final state (`canceled`, `unpaid`, or left `past_due`).
   With "leave past due", the plan never ends on its own; the setting lives in the Stripe Dashboard and is not checked
   by the code.
