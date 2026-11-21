import type { ScanReport } from "@heyqr/qr-core";
import { CircleAlertIcon, LoaderCircleIcon, ScanLineIcon, ShieldCheckIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import type { ScanDecode } from "./use-scan-check";

/** One-tap fixes the editor can apply and the scan check then verifies (design 1.9). */
export type ScanFix = { kind: "reduceLogo"; size: number } | { kind: "darkenCorners" };

/**
 * Shows the scan check of the design on the canvas, as a polite live region: "Checking scan" while a newer render is
 * built (the shown result would describe older settings), "Scan verified" or "May not scan" with what to fix.
 * `compact` is the design's one-line chip for stage footers; the full version lists every issue and its one-tap fix.
 * The result is always the scanner's own report; a contrast ratio alone is never presented as a pass.
 */
export function ScanStatus({
  report,
  compact = false,
  checking = false,
  onFix,
  decode = null,
}: {
  report: ScanReport;
  compact?: boolean;
  /** Newer settings than the ones this report describes are still rendering. */
  checking?: boolean;
  /** HEY-67: the result of a scan check (decoding) of the current artwork, when one ran; it takes precedence. */
  decode?: ScanDecode | null;
  onFix?: (fix: ScanFix) => void;
}) {
  const t = useTranslations();
  const size = compact ? undefined : "h-8 px-3 text-label";
  if (decode?.kind === "checking" || (checking && !decode))
    return (
      <Badge variant="neutral" role="status" className={size}>
        <LoaderCircleIcon aria-hidden className="animate-spin motion-reduce:animate-none" />
        {t("editor.scanChecking")}
      </Badge>
    );
  if (decode?.kind === "ok")
    return compact ? (
      <Badge variant="success" role="status">
        <ShieldCheckIcon aria-hidden />
        {t("editor.scanOk")}
      </Badge>
    ) : (
      <div role="status" className="flex flex-col gap-1 rounded-md bg-success-soft px-3 py-2 text-caption font-medium text-success">
        <span className="flex items-center gap-1.5 text-label">
          <ShieldCheckIcon aria-hidden className="size-4" />
          {t("editor.scanOk")}
        </span>
        {t("editor.scanCheck.readBack", { value: shortValue(decode.decoded) })}
      </div>
    );
  if (decode?.kind === "unreadable" || decode?.kind === "error") {
    const title = decode.kind === "error" ? t("editor.scanCheck.errorTitle") : t("editor.scanCheck.unreadableTitle");
    const text =
      decode.kind === "error"
        ? t("editor.scanCheck.errorText")
        : decode.decoded
          ? t("editor.scanCheck.mismatch", { value: shortValue(decode.decoded) })
          : t("editor.scanCheck.unreadable");
    return compact ? (
      <Badge variant="warning" role="status" title={text}>
        <CircleAlertIcon aria-hidden />
        {title}
        <span className="sr-only">. {text}</span>
      </Badge>
    ) : (
      <div role="status" className="flex items-start gap-2 rounded-md bg-warning-soft px-3 py-2 text-caption font-medium text-warning">
        <CircleAlertIcon aria-hidden className="mt-0.5 size-4 shrink-0" />
        <span className="flex flex-col gap-0.5">
          <span className="text-label">{title}</span>
          {text}
        </span>
      </div>
    );
  }
  if (checking)
    return (
      <Badge variant="neutral" role="status" className={compact ? undefined : "h-8 px-3 text-label"}>
        <LoaderCircleIcon aria-hidden className="animate-spin motion-reduce:animate-none" />
        {t("editor.scanChecking")}
      </Badge>
    );
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
  const codes = new Set(report.issues.map((i) => i.code));
  // Corner colours can be taken back to the module colour only when the modules themselves read well.
  const canDarken = codes.has("eyes") && !codes.has("contrast") && !codes.has("invert");
  return (
    <ul role="status" className="flex flex-col gap-2">
      {report.issues.map((issue) => (
        <li key={issue.code} className="flex items-start gap-2 rounded-md bg-warning-soft px-3 py-2 text-caption font-medium text-warning">
          <CircleAlertIcon aria-hidden className="mt-0.5 size-4 shrink-0" />
          <span className="flex grow flex-wrap items-center gap-x-3 gap-y-1.5">
            {t(`scan.${issue.code}`)}
            {issue.code === "logo" && onFix && report.maxLogoSize > 0 ? (
              <Button type="button" size="sm" variant="secondary" onClick={() => onFix({ kind: "reduceLogo", size: report.maxLogoSize })}>
                {t("editor.reduceLogo", { size: Math.round(report.maxLogoSize * 100) })}
              </Button>
            ) : null}
            {issue.code === "eyes" && onFix && canDarken ? (
              <Button type="button" size="sm" variant="secondary" onClick={() => onFix({ kind: "darkenCorners" })}>
                {t("editor.darkenCorners")}
              </Button>
            ) : null}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** Design ScanStatus: the read-back value without its scheme, cut at 34 characters. */
function shortValue(v: string): string {
  const bare = v.replace(/^https?:\/\//, "");
  return bare.length > 34 ? `${bare.slice(0, 33)}…` : bare;
}

/**
 * HEY-67: "Check scan" — decodes the current artwork on this device. Focus stays on the button while it runs (it is
 * never disabled); the result is announced by the status next to it. `iconOnly` for the tight phone canvas overlay.
 */
export function ScanCheckButton({
  decode,
  onCheck,
  iconOnly = false,
  className,
}: {
  decode: ScanDecode | null;
  onCheck: () => void;
  iconOnly?: boolean;
  className?: string;
}) {
  const t = useTranslations("editor.scanCheck");
  const busy = decode?.kind === "checking";
  const label = decode?.kind === "error" ? t("retry") : t("run");
  return (
    <Button
      type="button"
      size={iconOnly ? "icon-sm" : "sm"}
      variant="secondary"
      aria-label={iconOnly ? label : undefined}
      aria-busy={busy || undefined}
      aria-disabled={busy || undefined}
      onClick={() => {
        if (!busy) onCheck();
      }}
      className={className}
    >
      {busy ? <LoaderCircleIcon aria-hidden className="animate-spin motion-reduce:animate-none" /> : <ScanLineIcon aria-hidden />}
      {iconOnly ? null : label}
    </Button>
  );
}
