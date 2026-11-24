import { getFormatter, getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import type { TrialPhase } from "@/server/billing/trial";
import { cn } from "@/shared/lib/utils";
import { Button } from "@/shared/ui/button";

/*
 * Design 9.5 "My QR codes · during the trial" (also on Plan & billing): the trial's state with days left, and its one
 * live test slot, shown apart from anything monthly. Renders nothing when the account has never started a trial.
 * HEY-136: the action fits the state. While the trial runs: its details. When it is ending or has ended: Activate
 * Starter, which opens the trial page; the paid Checkout starts only from that page's own button.
 */
export async function TrialBar({ phase, slotUsed, showUsage = false }: { phase: TrialPhase; slotUsed?: boolean; showUsage?: boolean }) {
  if (phase.state === "none") return null;
  const [t, format] = await Promise.all([getTranslations("trial"), getFormatter()]);
  const end = format.dateTime(phase.endsAt, { month: "long", day: "numeric" });
  const days = phase.state === "active" || phase.state === "ending" ? phase.daysLeft : 0;
  const tone = phase.state === "expired" ? "warn" : phase.state === "ending" ? "ending" : phase.state === "upgraded" ? "ok" : "active";
  return (
    <div className="flex flex-col gap-3">
      <div
        role="status"
        className={cn(
          "flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-lg px-4 py-3 text-[0.9375rem]",
          tone === "active" && "bg-violet-50 text-violet-900 shadow-[inset_3px_0_0_var(--color-violet-500)]",
          tone === "ending" && "bg-warning-soft text-warning shadow-[inset_3px_0_0_currentColor]",
          tone === "warn" && "bg-danger-soft text-danger shadow-[inset_3px_0_0_currentColor]",
          tone === "ok" && "bg-success-soft text-success shadow-[inset_3px_0_0_currentColor]",
        )}
      >
        <span>
          <b className="font-semibold">{t(`bar.${phase.state}.title`, { days, end })}</b> {t(`bar.${phase.state}.text`, { end })}
        </span>
        <Button asChild size="sm" variant={phase.state === "expired" || phase.state === "ending" ? "primary" : "secondary"}>
          <Link href="/dashboard/trial">{phase.state === "expired" || phase.state === "ending" ? t("bar.activate") : t("bar.open")}</Link>
        </Button>
      </div>
      {showUsage && phase.state !== "upgraded" ? (
        <div className="flex max-w-sm flex-col gap-1.5 rounded-lg border border-violet-200 bg-surface p-3.5 shadow-[inset_3px_0_0_var(--color-violet-500)]">
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-label">{t("usage.title")}</span>
            <b className="tabular-nums">{t("usage.count", { used: slotUsed ? 1 : 0 })}</b>
          </div>
          <div
            role="meter"
            aria-label={t("usage.title")}
            aria-valuemin={0}
            aria-valuemax={1}
            aria-valuenow={slotUsed ? 1 : 0}
            className="h-1.5 overflow-hidden rounded-full bg-violet-100"
          >
            <span className="block h-full rounded-full bg-violet-500" style={{ width: slotUsed ? "100%" : "0%" }} />
          </div>
          <span className="text-caption text-muted-foreground">{t("usage.hint")}</span>
        </div>
      ) : null}
    </div>
  );
}
