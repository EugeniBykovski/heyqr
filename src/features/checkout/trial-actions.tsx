"use client";

import { useLocale, useTranslations } from "next-intl";
import { useTransition, type ReactNode } from "react";
import { toast } from "sonner";
import { useRouter } from "@/i18n/navigation";
import { activateTrial, startCheckout, startTrialAction } from "@/server/actions/qr";
import { Button } from "@/shared/ui/button";

type Size = "sm" | "md" | "lg";
type Variant = "primary" | "secondary";

/** Design 9.1: starts the 7-day trial on the server, then opens the trial screen. */
export function StartTrialButton({ size = "lg", variant = "primary", className }: { size?: Size; variant?: Variant; className?: string }) {
  const t = useTranslations("trial.start");
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button
      variant={variant}
      size={size}
      className={className}
      loading={pending}
      onClick={() =>
        start(async () => {
          const result = await startTrialAction().catch(() => ({ ok: false as const, error: "failed" }));
          if (!result.ok) {
            toast.error(t("failed"), { id: "trial" });
            return;
          }
          router.push("/dashboard/trial");
        })
      }
    >
      {t("action")}
    </Button>
  );
}

/** Design 9.1: uses the trial's one Dynamic slot for this code; its short link goes live. */
export function UseTrialButton({ qrCodeId, className }: { qrCodeId: string; className?: string }) {
  const t = useTranslations("trial");
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button
      variant="primary"
      size="lg"
      className={className}
      loading={pending}
      onClick={() =>
        start(async () => {
          const result = await activateTrial(qrCodeId).catch(() => ({ ok: false as const, error: "failed" }));
          if (!result.ok) {
            toast.error(t("useTrialFailed"), { id: "trial" });
            return;
          }
          router.refresh();
        })
      }
    >
      {t("useTrial")}
    </Button>
  );
}

/** Takes the Dynamic plan for this code through Stripe Checkout; the code keeps its short link. */
export function ActivatePlanButton({
  qrCodeId,
  layoutId,
  children,
  variant = "primary",
}: {
  qrCodeId: string;
  layoutId: string;
  children: ReactNode;
  variant?: Variant;
}) {
  const tExport = useTranslations("export");
  const locale = useLocale();
  const [pending, start] = useTransition();
  return (
    <Button
      variant={variant}
      size="lg"
      loading={pending}
      onClick={() =>
        start(async () => {
          const result = await startCheckout({ qrCodeId, layoutId, format: "png", locale }).catch(() => ({
            ok: false as const,
            error: "failed",
          }));
          if (result.ok) window.location.assign(result.data.url);
          else toast.error(tExport("checkoutFailed"), { id: "checkout" });
        })
      }
    >
      {children}
    </Button>
  );
}
