"use client";

import { LoaderCircleIcon, PrinterIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useTransition } from "react";
import { toast } from "sonner";
import { useRouter } from "@/i18n/navigation";
import { takeIncludedPrintPack } from "@/server/actions/billing";
import { Button } from "@/shared/ui/button";

/*
 * HEY-105 design 8.4 on QR details: an unlocked code's Print Pack from the plan's monthly allowance (Studio), through
 * the same server action as Export and Print Preview. The page refreshes with the files once it's granted.
 */
export function UseIncludedPrintPack({ qrCodeId }: { qrCodeId: string }) {
  const t = useTranslations("qr.details.pack");
  const router = useRouter();
  const [pending, start] = useTransition();
  const run = () =>
    start(async () => {
      const result = await takeIncludedPrintPack(qrCodeId).catch(() => ({ ok: false as const, error: "failed" as const }));
      if (!result.ok) {
        toast.error(result.error === "no_allowance" ? t("noneLeft") : t("includedFailed"), { id: "pp-included" });
        router.refresh();
        return;
      }
      toast.success(t("includedDone"), { id: "pp-included" });
      router.refresh();
    });
  return (
    <Button variant="primary" className="w-full" onClick={run} disabled={pending} aria-busy={pending || undefined}>
      {pending ? <LoaderCircleIcon aria-hidden className="animate-spin" /> : <PrinterIcon aria-hidden />}
      {t("useIncluded")}
    </Button>
  );
}
