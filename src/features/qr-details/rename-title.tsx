"use client";

import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { useRouter } from "@/i18n/navigation";
import { renameQr } from "@/server/actions/qr";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";

/** Design 4.3 header: the code's name with Rename (Enter saves, Escape cancels; a failure keeps the text). */
export function RenameTitle({ qrCodeId, name, actions }: { qrCodeId: string; name: string; actions?: React.ReactNode }) {
  const t = useTranslations("qr.details");
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(name);
  const [pending, start] = useTransition();
  const save = () =>
    start(async () => {
      const next = value.trim();
      if (!next || next === name) return setEditing(false);
      const result = await renameQr(qrCodeId, next).catch(() => ({ ok: false as const, error: "failed" as const }));
      if (!result.ok) {
        toast.error(t("renameFailed"), { id: "rename" });
        return;
      }
      setEditing(false);
      router.refresh();
    });
  if (editing)
    return (
      <form
        className="flex w-full flex-wrap items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <label htmlFor="qr-name" className="sr-only">
          {t("nameLabel")}
        </label>
        <Input
          id="qr-name"
          autoFocus
          maxLength={80}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              setValue(name);
              setEditing(false);
            }
          }}
          className="max-w-120 min-w-0 grow text-h3"
        />
        <Button type="submit" variant="primary" disabled={pending} aria-busy={pending || undefined}>
          {t("save")}
        </Button>
        <Button type="button" variant="ghost" onClick={() => (setValue(name), setEditing(false))}>
          {t("cancel")}
        </Button>
      </form>
    );
  return (
    <div className="flex w-full flex-wrap items-end justify-between gap-3">
      <h1 className="min-w-0 text-h1 break-words">{name}</h1>
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="ghost" onClick={() => setEditing(true)}>
          {t("rename")}
        </Button>
        {actions}
      </div>
    </div>
  );
}
