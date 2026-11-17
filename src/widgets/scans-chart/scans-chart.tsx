import { getFormatter, getTranslations } from "next-intl/server";

/** 14-day bar chart of scans. Plain HTML bars: readable without JS and by screen readers (table fallback). */
export async function ScansChart({ days }: { days: { day: string; count: number }[] }) {
  const t = await getTranslations("qr");
  const format = await getFormatter();
  const max = Math.max(1, ...days.map((d) => d.count));
  const total = days.reduce((s, d) => s + d.count, 0);

  return (
    <figure className="flex flex-col gap-3">
      <figcaption className="flex items-baseline justify-between gap-3">
        <span className="text-label">{t("scans")}</span>
        <span className="text-h2">{t("scansTotal", { count: total })}</span>
      </figcaption>
      <div aria-hidden className="flex h-32 items-end gap-1">
        {days.map((d) => (
          <div key={d.day} className="flex h-full flex-1 items-end rounded-xs bg-subtle">
            <div className="w-full rounded-xs bg-primary" style={{ height: `${(d.count / max) * 100}%` }} title={`${d.day}: ${d.count}`} />
          </div>
        ))}
      </div>
      <table className="sr-only">
        <tbody>
          {days.map((d) => (
            <tr key={d.day}>
              <th scope="row">{format.dateTime(new Date(d.day), { day: "numeric", month: "short" })}</th>
              <td>{d.count}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}
