import type { ScanReport } from "@heyqr/qr-core";
import { CircleAlertIcon, ShieldCheckIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";

/**
 * Shows the scan check of the exact design that will be exported, as a polite live region.
 * `compact` is the design's one-line chip for stage footers; the full version lists every fix.
 */
export function ScanStatus({
  report,
  compact = false,
  onReduceLogo,
}: {
  report: ScanReport;
  compact?: boolean;
  /** HEY-51: applies the largest logo size that still scans (report.maxLogoSize) when the logo hides too much. */
  onReduceLogo?: (size: number) => void;
}) {
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
          <span className="flex grow flex-wrap items-center gap-x-3 gap-y-1.5">
            {t(`scan.${issue.code}`)}
            {issue.code === "logo" && onReduceLogo && report.maxLogoSize > 0 ? (
              <Button type="button" size="sm" variant="secondary" onClick={() => onReduceLogo(report.maxLogoSize)}>
                {t("editor.reduceLogo", { size: Math.round(report.maxLogoSize * 100) })}
              </Button>
            ) : null}
          </span>
        </li>
      ))}
    </ul>
  );
}
