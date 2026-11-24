"use client";

import { LoaderCircleIcon, PauseIcon, PlayIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useTransition } from "react";
import { toast } from "sonner";
import { useRouter } from "@/i18n/navigation";
import { pauseDynamic, resumeDynamic } from "@/server/actions/billing";
import { Button } from "@/shared/ui/button";

/*
 * HEY-127 / QR-17.05 on QR details: Pause a live Dynamic code, or Resume a paused one. The server checks ownership, the
 * state and (on Resume) the plan or trial and a free live slot; the page refreshes with the stored status.
 */
export function PauseResume({ qrCodeId, paused }: { qrCodeId: string; paused: boolean }) {
  const t = useTranslations("qr.details.pause");
  const router = useRouter();
  const [pending, start] = useTransition();
  const run = () =>
    start(async () => {
      const result = await (paused ? resumeDynamic(qrCodeId) : pauseDynamic(qrCodeId)).catch(
        () => ({ ok: false, error: "failed" }) as const,
      );
      if (result.ok) toast.success(paused ? t("resumed") : t("paused"), { id: "qr-pause" });
      else
        toast.error(result.error === "limit" ? t("limit") : result.error === "no_allowance" ? t("noPlan") : t("failed"), {
          id: "qr-pause",
        });
      router.refresh();
    });
  const Icon = pending ? LoaderCircleIcon : paused ? PlayIcon : PauseIcon;
  return (
    <div data-slot="pause-resume" className="flex flex-col gap-2 rounded-lg bg-subtle px-3.5 py-3">
      {paused ? <p className="text-label">{t("pausedTitle")}</p> : null}
      <p className="text-caption text-secondary-foreground">{paused ? t("pausedText") : t("liveText")}</p>
      <Button
        size="sm"
        variant={paused ? "primary" : "secondary"}
        className="self-start"
        onClick={run}
        disabled={pending}
        aria-busy={pending || undefined}
      >
        <Icon aria-hidden className={pending ? "animate-spin" : undefined} />
        {paused ? t("resume") : t("pause")}
      </Button>
    </div>
  );
}
