"use client";

import { CircleAlertIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { CAPTION_MAX_CHARS, CAPTION_MAX_LINES, checkCaption, normalizeCaption } from "@/entities/qr";
import { cn } from "@/shared/lib/utils";
import { Label } from "@/shared/ui/label";
import { Textarea } from "@/shared/ui/textarea";

/*
 * Design "Design → Caption" (HEY-43): two rows, Enter for a second line, empty hides the caption.
 * The field shows exactly what was typed or pasted. Text within the rule (entities/qr caption.ts) is accepted at once;
 * text over it is never truncated: the field says what to change, and the design keeps the last accepted caption for
 * the preview and export. Nothing is rejected mid-keystroke, so IME composition works as usual.
 */
export function CaptionField({
  id,
  label,
  value,
  onAccept,
  onValidity,
  className,
}: {
  id: string;
  label: string;
  /** The accepted caption (what the design renders). */
  value: string;
  onAccept: (caption: string) => void;
  /** Reports whether the field's text is accepted, so Export can stop at it (like colour and size fields). */
  onValidity?: (id: string, valid: boolean) => void;
  className?: string;
}) {
  const t = useTranslations("editor.captionField");
  const [text, setText] = useState(value);
  const [synced, setSynced] = useState(value);
  // The caption changed from outside (layout switch, restore): show it.
  if (value !== synced) {
    setSynced(value);
    setText(value);
  }
  const check = checkCaption(text);
  // A caption saved before the rule is shown as is and stays usable until it is edited.
  const rejected = !check.ok && normalizeCaption(text) !== value;
  useEffect(() => () => onValidity?.(id, true), [id, onValidity]);

  const edit = (next: string) => {
    setText(next);
    const result = checkCaption(next);
    const normalized = normalizeCaption(next);
    onValidity?.(id, result.ok || normalized === value);
    if (result.ok && normalized !== value) {
      setSynced(normalized);
      onAccept(normalized);
    }
  };

  const message = rejected
    ? check.reason === "tooManyLines"
      ? t("tooManyLines", { max: CAPTION_MAX_LINES })
      : t("tooLong", { max: CAPTION_MAX_CHARS, over: check.length - CAPTION_MAX_CHARS })
    : null;

  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <Label htmlFor={id}>{label}</Label>
      <Textarea
        id={id}
        rows={2}
        value={text}
        autoComplete="off"
        aria-invalid={rejected || undefined}
        aria-describedby={`${id}-count ${rejected ? `${id}-error` : `${id}-hint`}`}
        data-caption-invalid={rejected ? "true" : undefined}
        onChange={(e) => edit(e.target.value)}
        className="min-h-18 resize-none"
      />
      <div className="flex items-start gap-3">
        {message ? (
          <p id={`${id}-error`} role="alert" className="flex grow items-start gap-1.5 text-caption font-medium text-danger">
            <CircleAlertIcon aria-hidden className="mt-0.5 size-3.5 shrink-0" />
            <span>{message}</span>
          </p>
        ) : (
          <p id={`${id}-hint`} className="grow text-caption text-muted-foreground">
            {t("hint")}
          </p>
        )}
        <span
          id={`${id}-count`}
          aria-label={t("count", { count: check.length, max: CAPTION_MAX_CHARS })}
          className={cn("shrink-0 font-mono text-caption tabular-nums", rejected ? "font-semibold text-danger" : "text-muted-foreground")}
        >
          {check.length}/{CAPTION_MAX_CHARS}
        </span>
      </div>
    </div>
  );
}
