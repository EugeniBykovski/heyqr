"use client";

import type { QrContent } from "@heyqr/qr-core";
import { CircleAlertIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { CONTENT_FIELDS, TEXT_MAX_CHARS } from "@/entities/qr";
import { cn } from "@/shared/lib/utils";
import { Label } from "@/shared/ui/label";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Segmented } from "@/shared/ui/segmented";
import { Textarea } from "@/shared/ui/textarea";
import type { ContentErrors } from "./content-validation";

/** The fields of one content type (design: Content step form). Errors come from content-validation and are shown inline. */
export function ContentForm({
  content,
  onChange,
  errors,
  fields,
  hints,
}: {
  content: QrContent;
  onChange: (content: QrContent) => void;
  errors: ContentErrors;
  /** Design 2.3: a hint under a field (e.g. what the website address means for a static or dynamic code). */
  hints?: Partial<Record<string, string>>;
  /** Only these fields, in this order (e.g. the homepage quick builder); all of the type's fields when omitted. */
  fields?: readonly string[];
}) {
  const t = useTranslations();
  const [showPassword, setShowPassword] = useState(false);
  const values = content as Record<string, string | boolean | undefined>;
  // Design 1.14: an event's date and its times are separate fields over start / end. A time typed before the date is
  // kept here until a date is chosen.
  const [pendingTimes, setPendingTimes] = useState({ start: "", end: "" });
  const eventStart = content.type === "event" ? content.start : "";
  const eventEnd = content.type === "event" ? (content.end ?? "") : "";
  const eventDate = eventStart.slice(0, 10);
  const eventTimes = { start: eventStart.slice(11, 16) || pendingTimes.start, end: eventEnd.slice(11, 16) || pendingTimes.end };
  const setEvent = (date: string, times: { start: string; end: string }) => {
    if (content.type !== "event") return;
    setPendingTimes(date ? { start: "", end: "" } : times);
    const start = date ? (times.start ? `${date}T${times.start}` : date) : "";
    const end = date && times.end ? `${date}T${times.end}` : undefined;
    // Without an end time the event has no end (the encoder ends it with its start, or the next day when all-day).
    onChange({
      type: "event",
      title: content.title,
      start,
      ...(end ? { end } : {}),
      ...(content.place === undefined ? {} : { place: content.place }),
    });
  };
  const virtualValue = (name: string) =>
    content.type === "event" && name === "start"
      ? eventDate
      : name === "startTime"
        ? eventTimes.start
        : name === "endTime"
          ? eventTimes.end
          : undefined;
  /** Wi-Fi with "No password": the password field is hidden and the payload leaves it out (design 1.4). */
  const openNetwork = content.type === "wifi" && content.security === "nopass";
  const set = (name: string, value: string | boolean) => {
    if (content.type === "event" && (name === "start" || name === "startTime" || name === "endTime") && typeof value === "string")
      return name === "start"
        ? setEvent(value, eventTimes)
        : setEvent(eventDate, { ...eventTimes, [name === "startTime" ? "start" : "end"]: value });
    onChange({ ...content, [name]: value } as QrContent);
  };

  return (
    <div className={cn("grid gap-x-4 gap-y-5", content.type === "event" ? "sm:grid-cols-4" : "sm:grid-cols-2")}>
      {(fields ? fields.flatMap((name) => CONTENT_FIELDS[content.type].filter((f) => f.name === name)) : CONTENT_FIELDS[content.type]).map(
        (field) => {
          const id = `content-${field.name}`;
          const label = t(`fields.${field.label}` as "fields.url");
          const value = virtualValue(field.name) ?? values[field.name];
          const error = errors[field.name];
          const isWifiPassword = content.type === "wifi" && field.name === "password";
          if (isWifiPassword && openNetwork) return null;
          const hint = isWifiPassword ? t("editor.wifiPasswordHint") : hints?.[field.name];
          const hintId = hint ? `${id}-hint` : undefined;
          const describedBy = [error ? `${id}-error` : undefined, hintId].filter(Boolean).join(" ") || undefined;
          // Required for Wi-Fi: the password whenever the network is secured; security is a choice, never "optional".
          const required = field.required || isWifiPassword || field.kind === "security";
          if (field.kind === "security")
            return (
              <div key={field.name} className="flex flex-col gap-1.5 sm:col-span-2">
                <span id={`${id}-label`} className="text-label">
                  {label}
                </span>
                <Segmented
                  label={label}
                  value={typeof value === "string" ? value : "WPA"}
                  options={[
                    { value: "WPA", label: t("fields.securityWpa") },
                    { value: "WEP", label: "WEP" },
                    { value: "nopass", label: t("fields.securityNone") },
                  ]}
                  onChange={(v) => set(field.name, v)}
                />
              </div>
            );
          if (field.kind === "checkbox")
            return (
              <label key={field.name} className="flex min-h-11 cursor-pointer items-center gap-2.5 text-body sm:col-span-2">
                <input
                  type="checkbox"
                  className="size-5 accent-primary"
                  checked={value === true}
                  onChange={(e) => set(field.name, e.target.checked)}
                />
                {label}
              </label>
            );
          const wide =
            field.kind === "textarea" ||
            field.kind === "url" ||
            content.type === "website" ||
            content.type === "wifi" ||
            (content.type === "contact" && !field.half);
          const common = {
            id,
            "aria-invalid": error ? true : undefined,
            "aria-describedby": describedBy,
            "aria-required": required || undefined,
          } as const;
          return (
            <div
              key={field.name}
              className={cn(
                "flex flex-col gap-1.5",
                content.type === "event"
                  ? field.kind === "time"
                    ? "sm:col-span-1"
                    : field.half
                      ? "sm:col-span-2"
                      : "sm:col-span-4"
                  : wide && "sm:col-span-2",
              )}
            >
              <Label htmlFor={id}>
                {label}
                {!required && !field.unmarked ? <span className="font-normal text-muted-foreground">· {t("editor.optional")}</span> : null}
              </Label>
              {field.kind === "textarea" && content.type === "text" ? (
                <Textarea
                  {...common}
                  aria-describedby={[describedBy, `${id}-count`].filter(Boolean).join(" ")}
                  rows={5}
                  maxLength={Math.max(TEXT_MAX_CHARS, String(value ?? "").length)}
                  value={String(value ?? "")}
                  onChange={(e) => set(field.name, e.target.value)}
                />
              ) : field.kind === "textarea" ? (
                <Textarea {...common} rows={4} value={String(value ?? "")} onChange={(e) => set(field.name, e.target.value)} />
              ) : isWifiPassword ? (
                <div className="flex min-w-0 items-stretch">
                  <Input
                    {...common}
                    type={showPassword ? "text" : "password"}
                    autoComplete="off"
                    spellCheck={false}
                    className="rounded-r-none"
                    value={String(value ?? "")}
                    onChange={(e) => set(field.name, e.target.value)}
                  />
                  <Button
                    type="button"
                    variant="secondary"
                    aria-pressed={showPassword}
                    aria-controls={id}
                    className="min-h-control rounded-l-none rounded-r-md border-l-0"
                    onClick={() => setShowPassword((s) => !s)}
                  >
                    {showPassword ? t("editor.passwordHide") : t("editor.passwordShow")}
                  </Button>
                </div>
              ) : (
                <Input
                  {...common}
                  type={field.kind}
                  placeholder={field.placeholder}
                  autoComplete={field.autoComplete}
                  inputMode={field.kind === "url" ? "url" : field.kind === "tel" ? "tel" : field.kind === "email" ? "email" : undefined}
                  value={String(value ?? "")}
                  onChange={(e) => set(field.name, e.target.value)}
                />
              )}
              {content.type === "text" && field.kind === "textarea" ? (
                <p id={`${id}-count`} className="text-caption text-muted-foreground tabular-nums">
                  {t("editor.textCount", { count: [...String(value ?? "")].length, max: TEXT_MAX_CHARS })}
                </p>
              ) : null}
              {hintId ? (
                <p id={hintId} className="text-caption text-muted-foreground">
                  {hint}
                </p>
              ) : null}
              {error ? (
                <p
                  id={`${id}-error`}
                  className="flex animate-rise items-start gap-1.5 text-caption font-medium text-danger [animation-duration:var(--motion-fast)]"
                >
                  <CircleAlertIcon aria-hidden className="mt-0.5 size-3.5 shrink-0" />
                  {t(`editor.errors.${error}` as "editor.errors.text")}
                </p>
              ) : null}
            </div>
          );
        },
      )}
    </div>
  );
}
