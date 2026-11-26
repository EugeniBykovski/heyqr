# Link availability after a trial, a cancellation or a failed renewal

HEY-138 / QR-19.01, enforced by HEY-142 / QR-19.05. What happens to an owner's codes in each case. One rule decides
paid access everywhere (slots, activation, Resume, downloads and the public short link): `hasPlanAccess`
(`server/billing/allowances.ts`). Decisions nobody has made yet are under **Missing decisions**. Pre-payment copy
(Pricing rules 4 and 5, the compare row "After you cancel", and `plans.terms` under every subscribe button) states only
what this matrix confirms.

## Owner matrix

| Situation                                                                                | Redirects of printed Dynamic codes                                                                                                                                                                     | Downloads, activation, slots                                                                                                                                                          | Confirmed by                                                                                                                  |
| ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| **1. 7-day trial ends** (no plan)                                                        | The trial's test code stops redirecting at the trial's end time (start + 7 days); scanners get the neutral "not active right now" page.                                                                | No test-code downloads. Taking a plan (the trial page's Activate Starter, paid Checkout only on that click) turns the **same QR and short link** back on, to its current destination. | `trialPhase`, `trialCovers` (`trial.ts`); `app/r/[code]/route.test.ts` (HEY-121); PostgreSQL "expired trial → plan" (HEY-133) |
| **2a. Cancellation scheduled**                                                           | Unchanged until the cutoff.                                                                                                                                                                            | The plan, slots and allowances stay until the cutoff: Stripe's `cancel_at`, else the period end. Plan & billing says "Ends on {date}".                                                | `hasPlanAccess`; PostgreSQL HEY-134 / HEY-139 / HEY-142                                                                       |
| **2b. The cutoff passes**                                                                | From the cutoff, a live Dynamic code goes to the neutral "not active right now" page (no scan counted), **even if Stripe's final event is delayed**. Its QR ID, slug, destination and design are kept. | No plan: Dynamic files can't be downloaded; activation and Resume are refused (`no_plan`); 0 slots.                                                                                   | `hasPlanAccess`, `activeSubscription`; route and entitlement tests; PostgreSQL HEY-142                                        |
| **2c. A renewal** (no cancellation scheduled)                                            | Unchanged: the period end passing doesn't cut access while Stripe renews.                                                                                                                              | The new period's dates arrive with the webhook.                                                                                                                                       | `hasPlanAccess`; Sandbox test clock (HEY-140)                                                                                 |
| **3a. Renewal payment fails** (Stripe `past_due`)                                        | Unchanged.                                                                                                                                                                                             | The plan stays while the payment is overdue; Plan & billing shows "Payment overdue" with the way to pay.                                                                              | `PLAN_STATUSES`; PostgreSQL HEY-138 / HEY-141                                                                                 |
| **3b. Payment not recovered** (`unpaid` or `canceled`)                                   | As in 2b.                                                                                                                                                                                              | As in 2b. **When** Stripe gives up is its own retry setting; no grace period is defined (Missing decisions 1–2).                                                                      | Same                                                                                                                          |
| **3c. Payment recovered** (`active` again)                                               | The same printed code redirects again, to its current destination.                                                                                                                                     | The plan is back with Stripe's current period.                                                                                                                                        | Route test "after recovery"; PostgreSQL HEY-141 / HEY-142; Sandbox (HEY-141)                                                  |
| **4. Scan monitoring threshold** (Starter 10,000, Studio 100,000 monthly scans per code) | **Never suspended** by reaching or passing it.                                                                                                                                                         | No effect; monitoring only.                                                                                                                                                           | `SCAN_MONITOR_THRESHOLDS`; PostgreSQL + HTTP (HEY-135)                                                                        |
| **5. Plan ends after a static QR was unlocked**                                          | A static code holds its content in the pattern: printed copies keep working with no server involved.                                                                                                   | Its files stay downloadable: the unlock belongs to the code, not the plan.                                                                                                            | `canDownload` static rule; `entitlements.test.ts`; PostgreSQL HEY-138 / HEY-142                                               |

### What the owner sees (HEY-185)

- **My QR codes, QR details and Your studio** call a Dynamic code **Active** only while its scans redirect, by the
  short link's own rule (`scansLive` / `ownerStatus`, `server/billing/access.ts`). In 1, 2b and 3b it shows as
  **Not active**, says why on QR details, and its main action leads to Plan & billing.
- **Plan & billing, 2a:** "Your plan ends on {cutoff}", what stays until then and what happens after, and
  **Keep my plan**: it clears the cancellation on Stripe's same subscription (no Checkout, no charge now) and is offered
  only before the cutoff. The webhook that follows re-reads Stripe's current state, so a late or repeated event can't
  schedule the cancellation again.
- **Plan & billing, 2b (no plan, an earlier one ended or was canceled):** "Your {plan} plan ended on {cutoff}" with
  **Reactivate**, which is that plan's Checkout. The new subscription turns the same short links back on. An unpaid
  renewal (3b, still payable) shows "Payment overdue" with the way to pay it instead (HEY-141).

Manual pauses and deletions are never changed by any of this: a paused or deleted code stays unavailable whatever the
plan says, and comes back only through Resume or Undo. Scanner-facing pages stay neutral: they never mention the owner's
plan, trial or payment (`link-unavailable`, HEY-121).

## Cancelling, undoing and subscribing again (HEY-185)

Verified end to end in Stripe test mode ([docs/qa/HEY-185-subscription-lifecycle.md](qa/HEY-185-subscription-lifecycle.md)):

- **Where:** Plan & billing → Manage subscription → Stripe's Customer Portal. Its configuration cancels **at the period
  end** (Stripe sets `cancel_at` to the period end; `cancel_at_period_end` stays false), with an optional reason.
- **Scheduled (2a):** Plan & billing shows "Cancels" and "Ends on {Stripe's cutoff}"; the plan, downloads and the short
  links stay until then.
- **Undo before the cutoff:** the Portal's "Don't cancel subscription". The **same** subscription continues: no new
  subscription, invoice or charge; Plan & billing shows "Renews on" again.
- **After the cutoff (2b):** Stripe ends the subscription (`customer.subscription.deleted`); stored `canceled`; Plan &
  billing shows "No plan"; the link answers the neutral "not active" page and the files are locked (402). The code
  keeps its status, short code and destination.
- **Subscribing again:** Plan & billing → Choose a plan → Subscribe: a **new** subscription (the ended one is never
  revived, even by a late event). Every Dynamic code still marked live redirects again at the **same** short link, so a
  file exported before the plan ended works again. Owner pauses, deletions and operator takedowns stay as they were.
- **Webhooks:** each event id is applied once; what is stored is Stripe's current subscription, so a repeated or stale
  delivery (e.g. the cancellation event after the undo) changes nothing.

## Reported pages and takedowns (HEY-182)

A visitor's "Report this page" (hosted pages, design 11.0) is stored in `page_report` and limited per visitor; nothing
changes on the page by itself. An operator reviews the queue and decides:

```sh
pnpm moderation queue                          # reported short links not taken down, most reports first
pnpm moderation reports <shortCode>            # every report of one short link
pnpm moderation take-down <shortCode> scam     # scam | malware | illegal | impersonation | other
pnpm moderation restore <shortCode>            # the review found nothing wrong
```

A takedown sets `qr_code.taken_down_at`. From then on the short link, the hosted page and the page's files answer
exactly like a removed code (`resolveShortLink`), whatever the code's status or plan: the owner's Resume or Publish
can't bring it back, and QR details tells the owner it was taken down after a report. The owner's content, published
versions, short link and scans are kept, so `restore` puts the latest published version back at the same link.

## Missing decisions

1. **Grace period after a failed renewal.** None is defined. Today a failed renewal keeps everything while Stripe reports
   `past_due` and ends access when Stripe moves the subscription to `unpaid` or `canceled`; the backlog's HEY-17 mentions
   pausing redirects "with a grace period" but no duration was ever set.
2. **Stripe's retry ("smart retries" / dunning) setting** and its final state (`canceled`, `unpaid`, or left `past_due`).
   With "leave past due", access never ends on its own; the setting lives in the Stripe Dashboard.
3. **Re-subscribing to a smaller plan.** When a plan is taken again after an earlier, larger one ended, every Dynamic
   code still marked live redirects again, even beyond the new plan's slots. Whether some should be paused first is
   not decided.
4. **A cancellation scheduled while its webhook is missing.** The cutoff is known only once the scheduling event has
   been processed; if that event never arrives, access ends when Stripe's final event does.
5. **The design handoff and this matrix disagree on plan end** (Developer handoff · Commerce, "Entitlement states" and
   "Usage counters"): the handoff says a Dynamic code is "paused by plan end", shows the "link paused" page, and frees
   its live slot (`dynamic_active` −1). The product keeps the code's status (so subscribing again brings it back with
   no Resume), shows the neutral "not active right now" page, and counts no slots without a plan. The product behaviour
   matches the pre-payment copy (Pricing rule 4, `plans.terms`, the trial's "the same short link redirects again");
   the handoff should be updated, or the product changed, by a product decision. Related: decision 3.
6. **Resolved (HEY-185): in-app resume.** While a cancellation is scheduled and before its cutoff, Plan & billing offers
   **Keep my plan** next to Manage subscription; it clears the cancellation on the same Stripe subscription (the
   Portal's "Don't cancel subscription" does the same). After the cutoff, Reactivate starts a new subscription.
