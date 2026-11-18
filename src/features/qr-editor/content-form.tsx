"use client";

import { QR_CONTENT_TYPES, type QrContent } from "@heyqr/qr-core";
import { useTranslations } from "next-intl";
import { CONTENT_FIELDS, emptyContent, type QrMode } from "@/entities/qr";
import { cn } from "@/shared/lib/utils";
import { Field } from "@/shared/ui/field";
import { fieldControl, Input } from "@/shared/ui/input";
import { Textarea } from "@/shared/ui/textarea";
import { ModeChoice } from "./mode-choice";
import { OptionGrid } from "./option-grid";
import { TYPE_ICONS } from "./type-icons";

export function ContentForm({
  content,
  onChange,
  mode,
  onModeChange,
}: {
  content: QrContent;
  onChange: (content: QrContent) => void;
  mode: QrMode;
  onModeChange: (mode: QrMode) => void;
}) {
  const t = useTranslations();
  const values = content as Record<string, string | boolean | undefined>;
  const set = (name: string, value: string | boolean) => onChange({ ...content, [name]: value } as QrContent);

  return (
    <div className="flex flex-col gap-6">
      <OptionGrid
        label={t("editor.type")}
        value={content.type}
        options={QR_CONTENT_TYPES}
        columns="grid-cols-3"
        onChange={(type) => type !== content.type && onChange(emptyContent(type))}
        render={(type) => {
          const Icon = TYPE_ICONS[type];
          return (
            <>
              <Icon aria-hidden className="size-5" />
              {t(`contentTypes.${type}`)}
            </>
          );
        }}
      />
      <ModeChoice type={content.type} value={mode} onChange={onModeChange} />
      <div className="grid gap-4 sm:grid-cols-2">
        {CONTENT_FIELDS[content.type].map((field) => {
          const id = `content-${field.name}`;
          const label = t(`fields.${field.label}` as "fields.url");
          const value = values[field.name];
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
          const wide = field.kind === "textarea" || field.kind === "url" || content.type === "website";
          return (
            <Field key={field.name} id={id} label={label} className={wide ? "sm:col-span-2" : undefined}>
              {field.kind === "textarea" ? (
                <Textarea id={id} required={field.required} value={String(value ?? "")} onChange={(e) => set(field.name, e.target.value)} />
              ) : field.kind === "security" ? (
                <select
                  id={id}
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
                  id={id}
                  type={field.kind}
                  required={field.required}
                  autoComplete={field.autoComplete}
                  inputMode={field.kind === "url" ? "url" : undefined}
                  value={String(value ?? "")}
                  onChange={(e) => set(field.name, e.target.value)}
                />
              )}
            </Field>
          );
        })}
      </div>
    </div>
  );
}
