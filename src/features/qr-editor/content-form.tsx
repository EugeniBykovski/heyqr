"use client";

import type { QrContent } from "@heyqr/qr-core";
import { CircleAlertIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { CONTENT_FIELDS } from "@/entities/qr";
import { cn } from "@/shared/lib/utils";
import { Label } from "@/shared/ui/label";
import { fieldControl, Input } from "@/shared/ui/input";
import { Textarea } from "@/shared/ui/textarea";
import type { ContentErrors } from "./content-validation";

/** The fields of one content type (design: Content step form). Errors come from content-validation and are shown inline. */
export function ContentForm({
  content,
  onChange,
  errors,
}: {
  content: QrContent;
  onChange: (content: QrContent) => void;
  errors: ContentErrors;
}) {
  const t = useTranslations();
  const values = content as Record<string, string | boolean | undefined>;
  const set = (name: string, value: string | boolean) => onChange({ ...content, [name]: value } as QrContent);

  return (
    <div className="grid gap-x-4 gap-y-5 sm:grid-cols-2">
      {CONTENT_FIELDS[content.type].map((field) => {
        const id = `content-${field.name}`;
        const label = t(`fields.${field.label}` as "fields.url");
        const value = values[field.name];
        const error = errors[field.name];
        const describedBy = error ? `${id}-error` : undefined;
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
        const wide = field.kind === "textarea" || field.kind === "url" || content.type === "website" || field.kind === "security";
        const common = {
          id,
          "aria-invalid": error ? true : undefined,
          "aria-describedby": describedBy,
          "aria-required": field.required || undefined,
        } as const;
        return (
          <div key={field.name} className={cn("flex flex-col gap-1.5", wide && "sm:col-span-2")}>
            <Label htmlFor={id}>
              {label}
              {!field.required ? <span className="font-normal text-muted-foreground">· {t("editor.optional")}</span> : null}
            </Label>
            {field.kind === "textarea" ? (
              <Textarea {...common} rows={4} value={String(value ?? "")} onChange={(e) => set(field.name, e.target.value)} />
            ) : field.kind === "security" ? (
              <select
                {...common}
                className={cn(fieldControl, "min-h-control cursor-pointer")}
                value={String(value ?? "WPA")}
                onChange={(e) => set(field.name, e.target.value)}
              >
                <option value="WPA">WPA / WPA2 / WPA3</option>
                <option value="WEP">WEP</option>
                <option value="nopass">{t("fields.securityNone")}</option>
              </select>
            ) : (
              <Input
                {...common}
                type={field.kind}
                autoComplete={field.autoComplete}
                inputMode={field.kind === "url" ? "url" : field.kind === "tel" ? "tel" : field.kind === "email" ? "email" : undefined}
                value={String(value ?? "")}
                onChange={(e) => set(field.name, e.target.value)}
              />
            )}
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
      })}
    </div>
  );
}
