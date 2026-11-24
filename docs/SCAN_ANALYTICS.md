# Scan analytics

HEY-145 / HEY-146. What a scan of a Dynamic QR records, what isn't counted, and who can read it.

## What is stored

One row per code and day in `scan_daily`: `qr_code_id`, `day`, `count`. Nothing else is written for a scan: no IP
address, user agent, cookie, referrer, location, or destination (with or without its query string). The count is added
after the redirect has been sent (`after()` in `/r/[code]`), in one atomic statement (`incrementScan`); a failed write is
logged by its error name only and never affects the redirect.

## What counts

A request to `/r/<code>` counts as one scan when **all** of these hold (`isCountableScan` and `resolveShortLink`):

1. the code redirects: it exists, isn't deleted or paused, has a destination, and its owner has access (HEY-142);
2. the method is `GET`;
3. it isn't a browser prefetch or prerender;
4. it isn't marked as test traffic.

Every request that fails 2–4 still gets exactly the same answer (302, `Cache-Control: no-store`, the same destination);
only the counter skips it. Unavailable links (1) are never counted.

## Deliberately excluded, and how it's recognised

| Traffic                                 | How it's identified                                                                                                  |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Link checkers, uptime probes, `curl -I` | `HEAD` (or any method other than `GET`)                                                                              |
| Browser prefetch / prerender of a link  | `Sec-Purpose`, `Purpose`, `X-Purpose` or `X-Moz` containing `prefetch`, `prerender` or `preview`                     |
| QA scripts, monitors, support checks    | the header `x-heyqr-test` with any value other than `0` (send `x-heyqr-test: 1`)                                     |
| Editor and Export previews              | they encode `/r/preview`, which never resolves to a code: the slug alphabet has no `i`, so `preview` can't be issued |
| The editor's scan check                 | it decodes the image in the browser and never requests the short link                                                |

Not excluded: any other `GET`, including link-preview bots of chat apps and crawlers that don't send one of these signals.
No user-agent or IP-based filtering is done (neither is read nor stored).

## Who can read it

Owners only: `scansByDay` (QR details, the trial page) reads a code's counts only for its owner; another account gets
zeros. The studio summary sums the signed-in owner's own codes. Reports return a day and a number per entry.

## Historical counts

Counts recorded before HEY-146 may include HEAD requests and prefetches. Nothing about those requests was stored, so they
can't be told apart afterwards: existing totals are kept as they are, and the filter applies to new traffic only.
