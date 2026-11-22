"use client";

import { LoaderCircleIcon, PlusIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useTransition } from "react";
import { toast } from "sonner";
import { useRouter } from "@/i18n/navigation";
import { duplicateLayout } from "@/server/actions/qr";
import { cn } from "@/shared/lib/utils";
import { Button } from "@/shared/ui/button";

/*
 * HEY-82 design 4.3 QR details "New layout": adds a layout to this code right away, copied from one of its saved
 * layouts (the first one, as in the handoff), named "Layout N", and opens it in Edit design. The source layout and the
 * code stay as they are; the copy is independent from here on. While it is created the action is locked.
 */
export function NewLayoutButton({
  qrCodeId,
  codeName,
  sourceLayoutId,
  nextNumber,
  look,
}: {
  qrCodeId: string;
  codeName: string;
  sourceLayoutId: string;
  /** The new layout's number: "Layout {n}". */
  nextNumber: number;
  /** The header's primary button or the dashed card at the end of the layout grid. */
  look: "button" | "card";
}) {
  const t = useTranslations("qr.details");
  const tEdit = useTranslations("editor.edit");
  const router = useRouter();
  const [pending, start] = useTransition();
  const run = () =>
    start(async () => {
      const name = tEdit("newName", { n: nextNumber });
      const result = await duplicateLayout({ qrCodeId, sourceLayoutId, name }).catch(() => ({
        ok: false as const,
        error: "failed" as const,
      }));
      if (!result.ok) {
        toast.error(t("layoutAddFailed"), { id: "layout-copy" });
        return;
      }
      toast.success(t("layoutAdded", { name, code: codeName }), { id: "layout-copy" });
      router.push(`/edit/${qrCodeId}?layout=${result.data.layoutId}`);
    });
  const icon = pending ? <LoaderCircleIcon aria-hidden className="size-5 animate-spin" /> : <PlusIcon aria-hidden className="size-5" />;
  if (look === "button")
    return (
      <Button variant="primary" onClick={run} disabled={pending} aria-busy={pending || undefined}>
        {icon}
        {t("newLayout")}
      </Button>
    );
  return (
    <button
      type="button"
      onClick={run}
      disabled={pending}
      aria-busy={pending || undefined}
      className={cn(
        "flex h-full min-h-48 w-full cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-border-strong/40 text-label hover:border-border-hover",
        "disabled:cursor-wait",
      )}
    >
      {icon}
      {t("newLayoutCard")}
    </button>
  );
}
