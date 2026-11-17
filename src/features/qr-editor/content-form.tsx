"use client";

import { QR_CONTENT_TYPES, type QrContent, type QrContentType } from "@heyqr/qr-core";
import {
  CalendarIcon,
  ContactIcon,
  GlobeIcon,
  MailIcon,
  MapPinIcon,
  MessageSquareIcon,
  PhoneIcon,
  TypeIcon,
  WifiIcon,
  type LucideIcon,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { CONTENT_FIELDS, emptyContent } from "@/entities/qr";
import { Field } from "@/shared/ui/field";
import { Input } from "@/shared/ui/input";
import { Textarea } from "@/shared/ui/textarea";
import { OptionGrid } from "./option-grid";

const TYPE_ICONS: Record<QrContentType, LucideIcon> = {
  website: GlobeIcon,
  text: TypeIcon,
  wifi: WifiIcon,
  contact: ContactIcon,
  email: MailIcon,
  phone: PhoneIcon,
  sms: MessageSquareIcon,
  location: MapPinIcon,
  event: CalendarIcon,
};

export function ContentForm({ content, onChange }: { content: QrContent; onChange: (content: QrContent) => void }) {
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
                  className="size-5 accent-violet-600"
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
                  className="h-11 w-full rounded-md border border-input bg-surface px-3 text-base"
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
