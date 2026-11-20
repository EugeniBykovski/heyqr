"use client";

import { LoaderCircleIcon, Trash2Icon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { useRouter } from "@/i18n/navigation";
import { deleteLayout } from "@/server/actions/qr";
import { Button } from "@/shared/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/shared/ui/dialog";

/*
 * QR details "Delete layout": a secondary action on one saved layout card. The confirmation names the layout and what
 * goes with it (its layout-specific downloads); Cancel changes nothing. The last layout of a code can't be deleted:
 * the same button explains why. While the server deletes, both buttons are locked so it can't be sent twice; the card
 * stays until the page reloads without it. A failure keeps everything and offers Try again.
 */
export function DeleteLayoutButton({
  qrCodeId,
  layoutId,
  name,
  canDelete,
}: {
  qrCodeId: string;
  layoutId: string;
  name: string;
  /** False when this is the code's only layout. */
  canDelete: boolean;
}) {
  const t = useTranslations("qr.details.deleteLayout");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();

  const run = () =>
    start(async () => {
      const result = await deleteLayout({ qrCodeId, layoutId }).catch(() => ({ ok: false as const, error: "failed" as const }));
      if (result.ok) {
        setOpen(false);
        toast.success(t("done", { name }), { id: `layout-delete-${layoutId}` });
        router.refresh();
        return;
      }
      if (result.error === "last_layout") {
        toast.error(t("lastError"), { id: `layout-delete-${layoutId}` });
        router.refresh();
        return;
      }
      toast.error(t("failed", { name }), { id: `layout-delete-${layoutId}`, action: { label: t("retry"), onClick: run } });
    });

  return (
    <>
      <Button
        type="button"
        size="icon-sm"
        variant="ghost-danger"
        aria-label={t("label", { name })}
        title={t("label", { name })}
        onClick={() => setOpen(true)}
      >
        <Trash2Icon aria-hidden />
      </Button>
      <Dialog open={open} onOpenChange={(next) => !pending && setOpen(next)}>
        <DialogContent role="alertdialog" closeLabel={t("close")}>
          {canDelete ? (
            <>
              <DialogTitle>{t("title", { name })}</DialogTitle>
              <DialogDescription>{t("text", { name })}</DialogDescription>
              <p className="text-caption text-secondary-foreground">{t("keeps")}</p>
              <div className="flex flex-wrap gap-2">
                <Button variant="danger-solid" disabled={pending} aria-busy={pending || undefined} onClick={run}>
                  {pending ? <LoaderCircleIcon aria-hidden className="animate-spin" /> : <Trash2Icon aria-hidden />}
                  {t("confirm")}
                </Button>
                <Button variant="ghost" disabled={pending} onClick={() => setOpen(false)}>
                  {t("cancel")}
                </Button>
              </div>
            </>
          ) : (
            <>
              <DialogTitle>{t("lastTitle")}</DialogTitle>
              <DialogDescription>{t("lastText", { name })}</DialogDescription>
              <div className="flex flex-wrap gap-2">
                <Button variant="secondary" onClick={() => setOpen(false)}>
                  {t("ok")}
                </Button>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
