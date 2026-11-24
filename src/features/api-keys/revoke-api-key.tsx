"use client";

import { BanIcon, LoaderCircleIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { useRouter } from "@/i18n/navigation";
import { revokeApiKeyAction } from "@/server/actions/api-keys";
import { Button } from "@/shared/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/shared/ui/dialog";

/*
 * HEY-154: "Revoke" on one API key, with a confirmation that names the key by its prefix and says what happens: tools
 * using it stop working at once, other keys keep working, and it can't be undone. The page then shows it as revoked.
 */
export function RevokeApiKey({ keyId, prefix }: { keyId: string; prefix: string }) {
  const t = useTranslations("apiKeys.revoke");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const run = () =>
    start(async () => {
      const result = await revokeApiKeyAction(keyId).catch(() => ({ ok: false, error: "failed" }) as const);
      if (result.ok) {
        setOpen(false);
        toast.success(t("done", { prefix }), { id: `revoke-${keyId}` });
      } else toast.error(t("failed"), { id: `revoke-${keyId}` });
      router.refresh();
    });
  return (
    <>
      <Button size="sm" variant="ghost-danger" onClick={() => setOpen(true)} aria-label={t("label", { prefix })}>
        <BanIcon aria-hidden />
        {t("action")}
      </Button>
      <Dialog open={open} onOpenChange={(next) => !pending && setOpen(next)}>
        <DialogContent role="alertdialog" closeLabel={t("close")}>
          <DialogTitle>{t("title", { prefix })}</DialogTitle>
          <DialogDescription>{t("text")}</DialogDescription>
          <div className="flex flex-wrap gap-2">
            <Button variant="danger-solid" disabled={pending} aria-busy={pending || undefined} onClick={run}>
              {pending ? <LoaderCircleIcon aria-hidden className="animate-spin" /> : <BanIcon aria-hidden />}
              {t("confirm")}
            </Button>
            <Button variant="ghost" disabled={pending} onClick={() => setOpen(false)}>
              {t("cancel")}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
