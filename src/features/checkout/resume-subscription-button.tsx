"use client";

import { useTranslations } from "next-intl";
import { useTransition } from "react";
import { toast } from "sonner";
import { useRouter } from "@/i18n/navigation";
import { resumeSubscription } from "@/server/actions/billing";
import { Button } from "@/shared/ui/button";

/**
 * HEY-185 Plan & billing "Keep my plan": undoes a scheduled cancellation on the same subscription. Success is only
 * shown once the server (and Stripe) confirmed it; the page then re-reads the plan, so the renewal date is back.
 */
export function ResumeSubscriptionButton({ label }: { label: string }) {
  const t = useTranslations("billing.canceling");
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button
      variant="primary"
      loading={pending}
      data-slot="resume-subscription"
      onClick={() =>
        start(async () => {
          const result = await resumeSubscription().catch(() => ({ ok: false, error: "failed" }) as const);
          if (result.ok) {
            toast.success(t("resumed"), { id: "resume-subscription" });
            router.refresh();
          } else toast.error(result.error === "invalid" ? t("notScheduled") : t("failed"), { id: "resume-subscription" });
        })
      }
    >
      {label}
    </Button>
  );
}
