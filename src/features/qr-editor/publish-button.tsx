"use client";

import { LoaderCircleIcon, SendIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useTransition } from "react";
import { toast } from "sonner";
import { useRouter } from "@/i18n/navigation";
import { publishHostedPage } from "@/server/actions/hosted";
import { Button } from "@/shared/ui/button";

/** QR details "Publish": the saved draft becomes the live page (same QR, same short link, same scans). */
export function PublishButton({ qrCodeId, variant = "primary" }: { qrCodeId: string; variant?: "primary" | "secondary" }) {
  const t = useTranslations("qr.hostedPage");
  const router = useRouter();
  const [pending, start] = useTransition();
  const run = () =>
    start(async () => {
      const result = await publishHostedPage(qrCodeId).catch(() => ({ ok: false, error: "failed" }) as const);
      if (result.ok) toast.success(result.data.unchanged ? t("unchanged") : t("published"), { id: "hosted-publish" });
      else toast.error(result.error === "rules" ? t("rules") : t("failed"), { id: "hosted-publish" });
      router.refresh();
    });
  return (
    <Button size="sm" variant={variant} onClick={run} disabled={pending} aria-busy={pending || undefined}>
      {pending ? <LoaderCircleIcon aria-hidden className="animate-spin" /> : <SendIcon aria-hidden />}
      {pending ? t("publishing") : t("publish")}
    </Button>
  );
}
