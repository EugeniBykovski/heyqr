import { useLocale, useTranslations } from "next-intl";
import { LocalTime } from "@/shared/ui/local-time";

/** HEY-125: the code's recorded destination changes, as stored (most recent first); nothing when none are recorded. */
export function DestinationHistory({
  entries,
}: {
  entries: { id: number; previousUrl: string | null; newUrl: string; changedAt: string }[];
}) {
  const t = useTranslations("qr.dest.history");
  const locale = useLocale();
  if (entries.length === 0) return null;
  return (
    <section aria-labelledby="destination-history" className="flex flex-col gap-2">
      <h3 id="destination-history" className="text-label">
        {t("title")}
      </h3>
      <ol data-slot="destination-history" className="flex flex-col divide-y divide-border rounded-lg border border-border">
        {entries.map((e) => (
          <li key={e.id} className="flex min-w-0 flex-col gap-0.5 px-3.5 py-2.5">
            <span className="text-caption text-muted-foreground">
              <LocalTime iso={e.changedAt} locale={locale} />
            </span>
            <span className="text-body break-all">
              <span className="sr-only">{t("to")} </span>
              {e.newUrl}
            </span>
            {e.previousUrl ? (
              <span className="text-caption break-all text-muted-foreground">{t("from", { url: e.previousUrl })}</span>
            ) : null}
          </li>
        ))}
      </ol>
    </section>
  );
}
