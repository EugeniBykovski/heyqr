/**
 * HEY-198 "Your studio" figures on the signed-in home, computed from the account's own data (studioSummary,
 * accountUsage). Pure, so the rules below are testable without a database.
 *
 * - Paid: a static code that was bought, or a Dynamic code that was activated (it has its permanent short code).
 *   Drafts are the rest.
 * - Scans: the sum of the account's 14 daily totals (UTC days, today included).
 * - Week over week: the last 7 days against the 7 before, shown only when both weeks are comparable: the account's
 *   scan history reaches back to the first day of the 14-day window (its first recorded scan is on or before it) and
 *   the earlier week has at least one scan. Otherwise the earlier week is partly before the account scanned anything,
 *   and a percentage would mislead, so it is left out.
 * - Dynamic codes: live Dynamic codes against the plan's limit (HEY-136 accountUsage); remaining = limit − used,
 *   never below 0. Without a plan the limit is 0 and the tile says so.
 * - Files ready: the layouts that can be downloaded now (studioSummary.filesReady: paid static codes and active
 *   Dynamic codes), as in HEY-198's first version.
 * - Top code: the Dynamic code with the most scans in the 14 days, when any code was scanned.
 */
export type StudioMetricsInput = {
  codes: readonly {
    id: string;
    name: string;
    model: "static" | "dynamic";
    purchasedAt: Date | null;
    shortCode: string | null;
  }[];
  /** 14 daily totals, oldest first (ownerScanSummary). */
  scans: readonly { day: string; count: number }[];
  scansByCode: ReadonlyMap<string, { total: number }>;
  /** The account's first day with a recorded scan (YYYY-MM-DD), or null. */
  firstScanDay: string | null;
  filesReady: number;
  dynamic: { used: number; limit: number };
};

export type StudioMetrics = {
  total: number;
  paid: number;
  drafts: number;
  scans: number;
  /** Fractional change of the last 7 days against the 7 before (0.25 = +25%), or null when not comparable. */
  weekOverWeek: number | null;
  dynamic: { used: number; limit: number; remaining: number };
  filesReady: number;
  top: { id: string; name: string; scans: number } | null;
};

export function studioMetrics(input: StudioMetricsInput): StudioMetrics {
  const { codes, scans, scansByCode, firstScanDay, filesReady, dynamic } = input;
  const paid = codes.filter((c) => (c.model === "static" ? c.purchasedAt !== null : c.shortCode !== null)).length;
  const sum = (days: readonly { count: number }[]) => days.reduce((s, d) => s + d.count, 0);
  const half = Math.floor(scans.length / 2);
  const earlier = sum(scans.slice(0, half));
  const later = sum(scans.slice(half));
  const windowStart = scans[0]?.day;
  const comparable = Boolean(windowStart && firstScanDay && firstScanDay <= windowStart) && earlier > 0;
  const top =
    codes
      .filter((c) => c.model === "dynamic")
      .map((c) => ({ id: c.id, name: c.name, scans: scansByCode.get(c.id)?.total ?? 0 }))
      .filter((c) => c.scans > 0)
      .sort((a, b) => b.scans - a.scans || a.name.localeCompare(b.name))[0] ?? null;
  return {
    total: codes.length,
    paid,
    drafts: codes.length - paid,
    scans: earlier + later,
    weekOverWeek: comparable ? (later - earlier) / earlier : null,
    dynamic: { used: dynamic.used, limit: dynamic.limit, remaining: Math.max(0, dynamic.limit - dynamic.used) },
    filesReady,
    top,
  };
}
