"use client";

import type { QrCapacity } from "@heyqr/qr-core";
import { PencilIcon, TextCursorInputIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { cn } from "@/shared/lib/utils";
import { Button } from "@/shared/ui/button";

/**
 * HEY-24: the content doesn't fit a QR code. Says by how much, what to do (shorten it; a center logo or in-code
 * caption lowers the limit) and offers the way back to edit. Shows sizes only, never the content itself.
 */
export function TooLongNotice({
  capacity,
  onEdit,
  id,
  className,
}: {
  capacity: Pick<QrCapacity, "bytes" | "maxBytes" | "centerCovered">;
  /** "Edit content": shown where the content isn't on screen (Design step). */
  onEdit?: () => void;
  id?: string;
  className?: string;
}) {
  const t = useTranslations("editor.tooLong");
  const over = Math.max(1, Math.round(((capacity.bytes - capacity.maxBytes) / capacity.maxBytes) * 100));
  return (
    <div
      id={id}
      role="alert"
      data-slot="too-long"
      className={cn("flex animate-rise items-start gap-3 rounded-md bg-danger-soft px-3.5 py-3 text-[0.875rem] leading-[1.45]", className)}
    >
      <TextCursorInputIcon aria-hidden className="mt-0.5 size-4 shrink-0 text-danger" />
      <div className="flex min-w-0 flex-col gap-1">
        <b className="text-danger">{t("title")}</b>
        <span className="text-secondary-foreground">{t("text", { over })}</span>
        {capacity.centerCovered ? <span className="text-secondary-foreground">{t("centerHint")}</span> : null}
        <span className="text-caption text-muted-foreground tabular-nums">
          {t("detail", { bytes: capacity.bytes, max: capacity.maxBytes })}
        </span>
        {onEdit ? (
          <Button size="sm" className="mt-1.5 self-start" onClick={onEdit}>
            <PencilIcon aria-hidden />
            {t("edit")}
          </Button>
        ) : null}
      </div>
    </div>
  );
}
