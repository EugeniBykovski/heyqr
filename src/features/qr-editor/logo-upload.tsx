"use client";

import { CircleAlertIcon, ImagePlusIcon, LoaderCircleIcon } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { useRef, useState, type DragEvent } from "react";
import { LOGO_ACCEPT, LOGO_MAX_BYTES } from "@/entities/qr";
import { cn } from "@/shared/lib/utils";
import { intakeLogo, type LogoDecoder } from "./logo-intake";

export type LogoFeedbackState =
  null | { kind: "reading" } | { kind: "error"; reason: "empty" | "tooLarge" | "unsupported" | "unreadable"; bytes: number };

/*
 * Design "Logo → upload" (HEY-50): the upload tile in the logo row. Choosing a file and dropping one go through the same
 * intake (logo-intake.ts). Only an accepted image replaces the logo; anything else leaves the current logo and preview
 * as they are and says why. The input is reset after every attempt, so the same or another file can be retried at once.
 */
export function LogoUploadTile({
  selected,
  label,
  onLogo,
  onFeedback,
  decoder,
}: {
  selected: boolean;
  label: string;
  onLogo: (href: string) => void;
  onFeedback: (f: LogoFeedbackState) => void;
  decoder?: LogoDecoder;
}) {
  const [dragging, setDragging] = useState(false);
  const [reading, setReading] = useState(false);
  const attempt = useRef(0);

  const take = async (file: File | undefined) => {
    if (!file) return;
    const id = ++attempt.current;
    setReading(true);
    onFeedback({ kind: "reading" });
    const result = await intakeLogo(file, decoder);
    if (id !== attempt.current) return; // a newer file was chosen meanwhile
    setReading(false);
    if (result.ok) {
      onLogo(result.href);
      onFeedback(null);
    } else onFeedback({ kind: "error", reason: result.reason, bytes: result.bytes });
  };

  const drop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    void take(e.dataTransfer.files[0]);
  };

  return (
    <label
      data-slot="logo-upload"
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={drop}
      className={cn(
        "relative grid aspect-square cursor-pointer place-items-center rounded-lg border border-dashed border-input bg-surface focus-within:outline-2 focus-within:outline-ring hover:border-input-hover",
        selected && "border-solid border-selected-border bg-selected",
        dragging && "border-solid border-selected-border bg-selected",
      )}
    >
      {reading ? <LoaderCircleIcon aria-hidden className="size-5 animate-spin" /> : <ImagePlusIcon aria-hidden className="size-5" />}
      <span className="sr-only">{label}</span>
      <input
        type="file"
        accept={LOGO_ACCEPT}
        aria-describedby="logo-file-feedback"
        className="absolute inset-0 cursor-pointer opacity-0"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          void take(file);
        }}
      />
    </label>
  );
}

/** Accepted formats and the size limit, or why the last file was refused. */
export function LogoFeedback({ feedback }: { feedback: LogoFeedbackState }) {
  const t = useTranslations("editor.logoFile");
  const format = useFormatter();
  const mb = (bytes: number) => format.number(bytes / (1024 * 1024), { maximumFractionDigits: 1 });
  if (feedback?.kind === "error")
    return (
      <p id="logo-file-feedback" role="alert" className="flex items-start gap-1.5 text-caption font-medium text-danger">
        <CircleAlertIcon aria-hidden className="mt-0.5 size-3.5 shrink-0" />
        <span>
          {t(feedback.reason, { size: mb(feedback.bytes), max: mb(LOGO_MAX_BYTES) })} {t("kept")}
        </span>
      </p>
    );
  return (
    <p id="logo-file-feedback" role="status" className="text-caption text-muted-foreground">
      {feedback?.kind === "reading" ? t("reading") : t("hint", { max: mb(LOGO_MAX_BYTES) })}
    </p>
  );
}
