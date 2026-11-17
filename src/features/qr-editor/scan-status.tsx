import type { ScanReport } from "@heyqr/qr-core";
import { CircleAlertIcon, ShieldCheckIcon } from "lucide-react";
import { useTranslations } from "next-intl";

/** Shows the scan check of the exact design that will be exported. */
export function ScanStatus({ report }: { report: ScanReport }) {
  const t = useTranslations();
  if (report.ok)
    return (
      <p role="status" className="flex items-center gap-2 rounded-full bg-success-soft px-3 py-1.5 text-label text-success">
        <ShieldCheckIcon aria-hidden className="size-4" />
        {t("editor.scanOk")}
      </p>
    );
  return (
    <ul role="alert" className="flex flex-col gap-2">
      {report.issues.map((issue) => (
        <li key={issue.code} className="flex items-start gap-2 rounded-lg bg-warning-soft px-3 py-2 text-caption font-medium text-warning">
          <CircleAlertIcon aria-hidden className="mt-0.5 size-4 shrink-0" />
          {t(`scan.${issue.code}`)}
        </li>
      ))}
    </ul>
  );
}
