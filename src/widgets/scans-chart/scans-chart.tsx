import { getFormatter, getTranslations } from "next-intl/server";
import { cn } from "@/shared/lib/utils";

/*
 * Design 4.4 / 4.7 "Scans · last 14 days": totals for the period and today, a bar per day with the first, middle and
 * last day labelled, and the empty state before the first scan. Plain HTML bars: readable without JS and by screen
 * readers (table fallback). Counts come from the server's scan events.
 */
export async function ScansChart({ days }: { days: { day: string; count: number }[] }) {
  const t = await getTranslations("qr.scansCard");
  const format = await getFormatter();
  const max = Math.max(1, ...days.map((d) => d.count));
  const total = days.reduce((s, d) => s + d.count, 0);
  const today = days.at(-1)?.count ?? 0;
  // HEY-147: days are UTC calendar days; label them in UTC so a viewer west of UTC doesn't see the day before.
  const label = (d: { day: string } | undefined) =>
    d ? format.dateTime(new Date(`${d.day}T00:00:00Z`), { day: "numeric", month: "short", timeZone: "UTC" }) : "";

  return (
    <figure className="flex flex-col gap-4">
      <figcaption className="flex flex-wrap items-center justify-between gap-3">
        <span className="text-h3">{t("title")}</span>
        <span className="flex gap-2">
          {[
            [total, t("total")],
            [today, t("today")],
          ].map(([v, k]) => (
            <span key={String(k)} className="flex min-w-16 flex-col rounded-md bg-subtle px-3 py-1.5">
              <b className="text-h3 tabular-nums">{v}</b>
              <span className="text-caption text-muted-foreground">{k}</span>
            </span>
          ))}
        </span>
      </figcaption>
      {total === 0 ? (
        <div className="grid h-32 place-items-center rounded-lg border border-dashed border-border px-4 text-center">
          <span className="flex flex-col gap-0.5">
            <span className="text-label">{t("emptyTitle")}</span>
            <span className="text-caption text-muted-foreground">{t("emptyText")}</span>
          </span>
        </div>
      ) : (
        <div>
          <div aria-hidden className="flex h-32 items-end gap-1">
            {days.map((d, i) => (
              <div key={d.day} className="flex h-full flex-1 items-end rounded-xs bg-subtle" title={`${label(d)}: ${d.count}`}>
                <div
                  className={cn("w-full rounded-xs", i === days.length - 1 ? "bg-primary" : "bg-primary/55")}
                  style={{ height: `${(d.count / max) * 100}%` }}
                />
              </div>
            ))}
          </div>
          <div aria-hidden className="mt-1.5 flex justify-between text-caption text-muted-foreground">
            <span>{label(days[0])}</span>
            <span>{label(days[Math.floor(days.length / 2)])}</span>
            <span>{t("today")}</span>
          </div>
        </div>
      )}
      <table className="sr-only">
        <tbody>
          {days.map((d) => (
            <tr key={d.day}>
              <th scope="row">{label(d)}</th>
              <td>{d.count}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}
