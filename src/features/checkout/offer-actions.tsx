"use client";

import { useLocale, useTranslations } from "next-intl";
import { useState, useTransition, type ReactNode } from "react";
import { toast } from "sonner";
import { startPackCheckout, startPlanCheckout } from "@/server/actions/billing";
import type { ActionResult } from "@/server/actions/result";
import { cn } from "@/shared/lib/utils";
import { Button } from "@/shared/ui/button";

function useCheckout() {
  const t = useTranslations("plans.errors");
  const [pending, start] = useTransition();
  const go = (run: () => Promise<ActionResult<{ url: string }>>) =>
    start(async () => {
      const result = await run().catch(() => ({ ok: false as const, error: "failed" as const }));
      if (result.ok) {
        window.location.assign(result.data.url);
        return;
      }
      const key =
        result.error === "not_offered" || result.error === "price_mismatch" || result.error === "unauthorized" ? result.error : "failed";
      toast.error(t(key), { id: "checkout" });
    });
  return { pending, go };
}

export type PackOption = { id: "pack3" | "pack10"; n: number; price: string; label: string; each: string };

/**
 * Design 4.8 Static Packs: pick 3 or 10 credits, then Buy. Signed out, Buy signs in first and returns to Pricing.
 * Without a price in the viewer's currency the options stay visible but Buy is unavailable, with the reason.
 */
export function PackPicker({
  options,
  signedIn,
  forSale,
  cta,
  unavailable,
  note,
}: {
  options: PackOption[];
  note: string;
  signedIn: boolean;
  forSale: Record<"pack3" | "pack10", boolean>;
  cta: Record<"pack3" | "pack10", string>;
  unavailable: string;
}) {
  const locale = useLocale();
  const [chosen, setChosen] = useState<"pack3" | "pack10">("pack3");
  const { pending, go } = useCheckout();
  return (
    <>
      <div className="flex flex-col gap-2" role="group" aria-label={cta[chosen]}>
        {options.map((o) => (
          <button
            key={o.id}
            type="button"
            aria-pressed={chosen === o.id}
            onClick={() => setChosen(o.id)}
            className="flex min-h-14 w-full cursor-pointer items-center gap-3 rounded-lg border border-border bg-surface px-3.5 py-2.5 text-left aria-pressed:border-selected-border aria-pressed:bg-selected aria-pressed:shadow-[0_0_0_1px_var(--selected-border)]"
          >
            <span className="grid size-10 shrink-0 place-items-center rounded-md bg-inverse text-base font-bold text-inverse-foreground">
              {o.n}
            </span>
            <span className="flex min-w-0 grow flex-col text-[0.875rem]">
              <b className="font-semibold">{o.label}</b>
              <span className="text-[0.78rem] text-secondary-foreground">{o.each}</span>
            </span>
            <span className="text-[1.0625rem] font-bold tabular-nums">{o.price}</span>
          </button>
        ))}
      </div>
      <p className="text-caption text-secondary-foreground">{note}</p>
      <div className="mt-auto flex flex-col gap-2">
        {signedIn ? (
          <Button
            size="lg"
            className="w-full"
            disabled={!forSale[chosen]}
            loading={pending}
            onClick={() => go(() => startPackCheckout({ pack: chosen, locale }))}
          >
            {cta[chosen]}
          </Button>
        ) : (
          <Button asChild size="lg" className="w-full">
            <a href={`/${locale}/sign-in?next=${encodeURIComponent("/pricing")}`}>{cta[chosen]}</a>
          </Button>
        )}
        {!forSale[chosen] ? <span className="text-center text-caption text-muted-foreground">{unavailable}</span> : null}
      </div>
    </>
  );
}

/** Design 4.8 "Subscribe now" / "Choose Studio" and 9.1 "Activate Starter": the plan's Stripe Checkout. */
export function PlanCheckoutButton({
  plan,
  returnTo,
  variant = "primary",
  size = "lg",
  disabled,
  className,
  children,
}: {
  plan: "starter" | "studio";
  returnTo: "billing" | "trial";
  variant?: "primary" | "secondary" | "ghost";
  size?: "md" | "lg";
  disabled?: boolean;
  className?: string;
  children: ReactNode;
}) {
  const locale = useLocale();
  const { pending, go } = useCheckout();
  return (
    <Button
      variant={variant}
      size={size}
      className={cn("w-full", className)}
      disabled={disabled}
      loading={pending}
      onClick={() => go(() => startPlanCheckout({ plan, locale, returnTo }))}
    >
      {children}
    </Button>
  );
}
