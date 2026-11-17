import type { ScanReport } from "@heyqr/qr-core";
import { CircleAlertIcon, ShieldCheckIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { Badge } from "@/shared/ui/badge";

/**
 * Shows the scan check of the exact design that will be exported, as a polite live region.
 * `compact` is the design's one-line chip for stage footers; the full version lists every fix.
 */
export function ScanStatus({ report, compact = false }: { report: ScanReport; compact?: boolean }) {
  const t = useTranslations();
  if (report.ok)
    return (
      <Badge variant="success" role="status" className={compact ? undefined : "h-8 px-3 text-label"}>
        <ShieldCheckIcon aria-hidden />
        {t("editor.scanOk")}
      </Badge>
    );
  if (compact)
    return (
      <Badge variant="warning" role="status">
        <CircleAlertIcon aria-hidden />
        {t("editor.scanFailed")}
      </Badge>
    );
  return (
    <ul role="status" className="flex flex-col gap-2">
      {report.issues.map((issue) => (
        <li key={issue.code} className="flex items-start gap-2 rounded-md bg-warning-soft px-3 py-2 text-caption font-medium text-warning">
          <CircleAlertIcon aria-hidden className="mt-0.5 size-4 shrink-0" />
          {t(`scan.${issue.code}`)}
        </li>
      ))}
    </ul>
  );
}
