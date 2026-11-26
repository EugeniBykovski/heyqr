"use client";

import { ArrowDownIcon, ArrowUpIcon, CircleAlertIcon, PlusIcon, Trash2Icon, XIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState, type ReactNode } from "react";
import {
  HOSTED_CURRENCIES,
  HOSTED_LIMITS,
  itemId,
  normalizePromoCode,
  PRODUCT_CTAS,
  WEEKDAYS,
  type AppsContent,
  type BusinessContent,
  type CouponContent,
  type HostedContent,
  type HostedCurrency,
  type HostedErrors,
  type MenuContent,
  type PdfContent,
  type ProductContent,
  type SocialContent,
} from "@/entities/qr";
import { cn } from "@/shared/lib/utils";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { Segmented } from "@/shared/ui/segmented";
import { Textarea } from "@/shared/ui/textarea";
import { CompactPhoto, FileProblem, PdfField, PhotoField, preparePhoto, type PdfState } from "./hosted-files";

/*
 * Design 10.4–11.15: the Content forms of the seven hosted page types. The form holds whatever the owner typed
 * (incomplete drafts are fine); errors come from the shared rules (entities/qr hostedErrors, the same ones the server
 * applies on publish) as field paths, and are shown beside the field once Continue was pressed or the field was left.
 */
export type HostedFormProps = {
  content: HostedContent;
  onChange: (content: HostedContent) => void;
  /** Visible errors (path → key under editor.hosted.errors). */
  errors: HostedErrors;
  signedIn: boolean;
  pdfState: PdfState;
  onPdfState: (s: PdfState) => void;
  /** Coupon "Preview the page as" (design 11.2): changes only the preview, never the saved date. */
  couponPreview: "valid" | "expired";
  onCouponPreview: (v: "valid" | "expired") => void;
};

export function HostedForm(props: HostedFormProps) {
  const { content } = props;
  switch (content.type) {
    case "menu":
      return <MenuForm {...props} content={content} />;
    case "coupon":
      return <CouponForm {...props} content={content} />;
    case "social":
      return <SocialForm {...props} content={content} />;
    case "business":
      return <BusinessForm {...props} content={content} />;
    case "apps":
      return <AppsForm {...props} content={content} />;
    case "pdf":
      return <PdfForm {...props} content={content} />;
    case "product":
      return <ProductForm {...props} content={content} />;
  }
}

/* ── Shared pieces ───────────────────────────────────────────────────────────────────────────────────────────── */

const move = <T,>(list: T[], from: number, to: number): T[] => {
  if (to < 0 || to >= list.length) return list;
  const next = [...list];
  const [item] = next.splice(from, 1);
  if (item !== undefined) next.splice(to, 0, item);
  return next;
};

function useErr(errors: HostedErrors) {
  const t = useTranslations("editor.hosted.errors");
  return (path: string) => {
    const key = errors[path];
    return key ? t(key as "menuName") : undefined;
  };
}

function ErrorText({ id, children }: { id: string; children?: ReactNode }) {
  if (!children) return null;
  return <FileProblem id={id}>{children}</FileProblem>;
}

function TextField({
  id,
  label,
  value,
  onChange,
  optional,
  placeholder,
  hint,
  error,
  maxLength,
  rows,
  inputMode,
  type,
  className,
  autoCapitalize,
  spellCheck,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  optional?: boolean;
  placeholder?: string;
  hint?: string;
  error?: string;
  maxLength: number;
  rows?: number;
  inputMode?: "url" | "tel" | "decimal" | "text";
  type?: "text" | "date";
  className?: string;
  autoCapitalize?: string;
  spellCheck?: boolean;
}) {
  const t = useTranslations("editor.hosted");
  const describedBy = [error ? `${id}-error` : null, hint ? `${id}-hint` : null].filter(Boolean).join(" ") || undefined;
  const common = {
    id,
    value,
    placeholder,
    maxLength,
    "aria-invalid": error ? true : undefined,
    "aria-describedby": describedBy,
    "aria-required": optional ? undefined : true,
  };
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <Label htmlFor={id}>
        {label}
        {optional ? <span className="font-normal text-muted-foreground">· {t("optional")}</span> : null}
      </Label>
      {rows ? (
        <Textarea {...common} rows={rows} onChange={(e) => onChange(e.target.value)} />
      ) : (
        <Input
          {...common}
          type={type ?? "text"}
          inputMode={inputMode}
          autoCapitalize={autoCapitalize}
          spellCheck={spellCheck}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
      {hint ? (
        <p id={`${id}-hint`} className="text-caption text-muted-foreground">
          {hint}
        </p>
      ) : null}
      <ErrorText id={`${id}-error`}>{error}</ErrorText>
    </div>
  );
}

/** Up / Down / Remove for one row of a reorderable list. */
function RowControls({
  index,
  count,
  item,
  onMove,
  onRemove,
  minimum = 1,
}: {
  index: number;
  count: number;
  item: string;
  onMove: (to: number) => void;
  onRemove: () => void;
  minimum?: number;
}) {
  const t = useTranslations("editor.hosted");
  return (
    <span className="flex shrink-0 gap-0.5">
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label={t("moveUp", { item })}
        disabled={index === 0}
        onClick={() => onMove(index - 1)}
      >
        <ArrowUpIcon aria-hidden />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label={t("moveDown", { item })}
        disabled={index === count - 1}
        onClick={() => onMove(index + 1)}
      >
        <ArrowDownIcon aria-hidden />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label={t("remove", { item })}
        disabled={count <= minimum}
        onClick={onRemove}
      >
        <Trash2Icon aria-hidden />
      </Button>
    </span>
  );
}

const SYMBOL: Record<HostedCurrency, string> = { USD: "$", EUR: "€", GBP: "£", PLN: "zł" };

function CurrencyChoice({ label, value, onChange }: { label: string; value: HostedCurrency; onChange: (c: HostedCurrency) => void }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-label">{label}</span>
      <Segmented label={label} value={value} options={HOSTED_CURRENCIES.map((c) => ({ value: c, label: c }))} onChange={onChange} />
    </div>
  );
}

/* ── Menu ────────────────────────────────────────────────────────────────────────────────────────────────────── */

function MenuForm({ content, onChange, errors }: HostedFormProps & { content: MenuContent }) {
  const t = useTranslations("editor.hosted.menu");
  const err = useErr(errors);
  const set = (patch: Partial<MenuContent>) => onChange({ ...content, ...patch });
  const setSections = (sections: MenuContent["sections"]) => set({ sections });
  const sectionAt = (i: number, patch: Partial<MenuContent["sections"][number]>) =>
    setSections(content.sections.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  return (
    <div className="flex flex-col gap-5">
      <TextField
        id="hosted-menu-name"
        label={t("name")}
        value={content.name}
        onChange={(name) => set({ name })}
        placeholder={t("namePlaceholder")}
        error={err("name")}
        maxLength={HOSTED_LIMITS.name}
      />
      <TextField
        id="hosted-menu-note"
        label={t("note")}
        optional
        value={content.note}
        onChange={(note) => set({ note })}
        placeholder={t("notePlaceholder")}
        maxLength={HOSTED_LIMITS.note}
      />
      <CurrencyChoice label={t("currency")} value={content.currency} onChange={(currency) => set({ currency })} />
      <ErrorText id="hosted-menu-sections-error">{err("sections")}</ErrorText>
      <ol className="flex flex-col gap-4">
        {content.sections.map((s, i) => {
          const sectionLabel = s.name.trim() || t("section", { n: i + 1 });
          return (
            <li key={s.id} className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-3.5">
              <div className="flex items-end gap-2">
                <TextField
                  id={`hosted-sec-${s.id}`}
                  className="min-w-0 flex-1"
                  label={t("section", { n: i + 1 })}
                  value={s.name}
                  onChange={(name) => sectionAt(i, { name })}
                  placeholder={t("sectionPlaceholder")}
                  hint={err(`sections.${i}.name`) ? undefined : t("sectionHint")}
                  error={err(`sections.${i}.name`)}
                  maxLength={HOSTED_LIMITS.name}
                />
                <span className="pb-1">
                  <RowControls
                    index={i}
                    count={content.sections.length}
                    item={sectionLabel}
                    onMove={(to) => setSections(move(content.sections, i, to))}
                    onRemove={() => setSections(content.sections.filter((_, j) => j !== i))}
                  />
                </span>
              </div>
              <ErrorText id={`hosted-sec-${s.id}-dishes-error`}>{err(`sections.${i}.dishes`)}</ErrorText>
              <ul className="flex flex-col gap-2.5">
                {s.dishes.map((d, k) => {
                  const dishLabel = d.name.trim() || t("dish", { n: k + 1 });
                  const dishAt = (patch: Partial<typeof d>) =>
                    sectionAt(i, { dishes: s.dishes.map((x, j) => (j === k ? { ...x, ...patch } : x)) });
                  const nameErr = err(`sections.${i}.dishes.${k}.name`);
                  const priceErr = err(`sections.${i}.dishes.${k}.price`);
                  return (
                    <li key={d.id} className="flex flex-col gap-2 border-t border-border pt-2.5 first:border-t-0 first:pt-0">
                      <div className="flex items-start gap-2">
                        <CompactPhoto
                          id={`hosted-dish-photo-${d.id}`}
                          label={`${t("dishPhoto")} · ${dishLabel}`}
                          value={d.photo}
                          onChange={(photo) => dishAt({ photo })}
                        />
                        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                          <Input
                            id={`hosted-dish-${d.id}`}
                            aria-label={t("dish", { n: k + 1 })}
                            aria-invalid={nameErr ? true : undefined}
                            aria-describedby={nameErr || priceErr ? `hosted-dish-${d.id}-error` : undefined}
                            placeholder={t("dishPlaceholder")}
                            value={d.name}
                            maxLength={HOSTED_LIMITS.name}
                            onChange={(e) => dishAt({ name: e.target.value })}
                          />
                          <Input
                            aria-label={t("descPlaceholder")}
                            placeholder={t("descPlaceholder")}
                            value={d.desc}
                            maxLength={HOSTED_LIMITS.note}
                            onChange={(e) => dishAt({ desc: e.target.value })}
                          />
                        </div>
                        <label className="flex w-24 shrink-0 items-center gap-1 rounded-md border border-input bg-surface ps-2.5 focus-within:border-ring">
                          <span aria-hidden className="text-caption text-muted-foreground">
                            {SYMBOL[content.currency]}
                          </span>
                          <span className="sr-only">{t("price")}</span>
                          <input
                            inputMode="decimal"
                            placeholder={t("pricePlaceholder")}
                            value={d.price}
                            maxLength={HOSTED_LIMITS.price}
                            aria-invalid={priceErr ? true : undefined}
                            onChange={(e) => dishAt({ price: e.target.value })}
                            className="min-h-control w-full min-w-0 bg-transparent pe-2 text-body tabular-nums outline-none"
                          />
                        </label>
                      </div>
                      <div className="flex items-center justify-between gap-2">
                        <ErrorText id={`hosted-dish-${d.id}-error`}>{nameErr ?? priceErr}</ErrorText>
                        <span className="ms-auto">
                          <RowControls
                            index={k}
                            count={s.dishes.length}
                            item={dishLabel}
                            onMove={(to) => sectionAt(i, { dishes: move(s.dishes, k, to) })}
                            onRemove={() => sectionAt(i, { dishes: s.dishes.filter((_, j) => j !== k) })}
                          />
                        </span>
                      </div>
                    </li>
                  );
                })}
              </ul>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                className="self-start"
                disabled={s.dishes.length >= HOSTED_LIMITS.dishes}
                onClick={() => sectionAt(i, { dishes: [...s.dishes, { id: itemId(), name: "", desc: "", price: "", photo: null }] })}
              >
                <PlusIcon aria-hidden />
                {t("addDish")}
              </Button>
            </li>
          );
        })}
      </ol>
      <Button
        type="button"
        variant="secondary"
        className="self-start"
        disabled={content.sections.length >= HOSTED_LIMITS.sections}
        onClick={() =>
          setSections([
            ...content.sections,
            { id: itemId(), name: "", dishes: [{ id: itemId(), name: "", desc: "", price: "", photo: null }] },
          ])
        }
      >
        <PlusIcon aria-hidden />
        {t("addSection")}
      </Button>
      <PhotoHint />
    </div>
  );
}

function PhotoHint() {
  const t = useTranslations("editor.hosted");
  return <p className="text-caption text-muted-foreground">{t("photoHint")}</p>;
}

/* ── Coupon ──────────────────────────────────────────────────────────────────────────────────────────────────── */

function CouponForm({ content, onChange, errors, couponPreview, onCouponPreview }: HostedFormProps & { content: CouponContent }) {
  const t = useTranslations("editor.hosted.coupon");
  const tHosted = useTranslations("editor.hosted");
  const err = useErr(errors);
  const set = (patch: Partial<CouponContent>) => onChange({ ...content, ...patch });
  return (
    <div className="flex flex-col gap-5">
      <TextField
        id="hosted-coupon-title"
        label={t("title")}
        value={content.title}
        onChange={(title) => set({ title })}
        placeholder={t("titlePlaceholder")}
        error={err("title")}
        maxLength={HOSTED_LIMITS.short}
      />
      <TextField
        id="hosted-coupon-discount"
        label={t("discount")}
        value={content.discount}
        onChange={(discount) => set({ discount })}
        placeholder={t("discountPlaceholder")}
        hint={t("discountHint")}
        error={err("discount")}
        maxLength={HOSTED_LIMITS.name}
      />
      <TextField
        id="hosted-coupon-code"
        label={t("code")}
        optional
        value={content.code}
        onChange={(v) => set({ code: normalizePromoCode(v) })}
        placeholder={t("codePlaceholder")}
        error={err("code")}
        maxLength={HOSTED_LIMITS.code}
        autoCapitalize="characters"
        spellCheck={false}
      />
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="hosted-coupon-expires">
          {t("expires")}
          <span className="font-normal text-muted-foreground">· {tHosted("optional")}</span>
        </Label>
        <div className="flex items-center gap-2">
          <Input
            id="hosted-coupon-expires"
            type="date"
            className="max-w-56"
            value={content.expires}
            aria-invalid={err("expires") ? true : undefined}
            aria-describedby={["hosted-coupon-expires-hint", err("expires") ? "hosted-coupon-expires-error" : ""].filter(Boolean).join(" ")}
            onChange={(e) => set({ expires: e.target.value })}
          />
          {content.expires ? (
            <Button type="button" variant="ghost" size="sm" onClick={() => set({ expires: "" })}>
              <XIcon aria-hidden />
              {t("clearDate")}
            </Button>
          ) : null}
        </div>
        <p id="hosted-coupon-expires-hint" className="text-caption text-muted-foreground">
          {t("expiresHint", { zone: content.timeZone })}
        </p>
        <ErrorText id="hosted-coupon-expires-error">{err("expires")}</ErrorText>
      </div>
      <TextField
        id="hosted-coupon-link"
        label={t("link")}
        optional
        value={content.link}
        onChange={(link) => set({ link })}
        placeholder={t("linkPlaceholder")}
        inputMode="url"
        error={err("link")}
        maxLength={HOSTED_LIMITS.url}
      />
      <TextField
        id="hosted-coupon-terms"
        label={t("terms")}
        optional
        rows={3}
        value={content.terms}
        onChange={(terms) => set({ terms })}
        placeholder={t("termsPlaceholder")}
        maxLength={HOSTED_LIMITS.terms}
      />
      <div className="flex flex-col gap-1.5">
        <span className="text-label">{t("previewAs")}</span>
        <Segmented
          label={t("previewAs")}
          value={couponPreview}
          options={[
            { value: "valid", label: t("valid") },
            { value: "expired", label: t("expired") },
          ]}
          onChange={onCouponPreview}
        />
      </div>
    </div>
  );
}

/* ── Social links ────────────────────────────────────────────────────────────────────────────────────────────── */

const QUICK: [string, string][] = [
  ["Instagram", "instagram.com/"],
  ["TikTok", "tiktok.com/@"],
  ["YouTube", "youtube.com/@"],
  ["LinkedIn", "linkedin.com/in/"],
  ["Website", ""],
];

function SocialForm({ content, onChange, errors }: HostedFormProps & { content: SocialContent }) {
  const t = useTranslations("editor.hosted.social");
  const err = useErr(errors);
  const set = (patch: Partial<SocialContent>) => onChange({ ...content, ...patch });
  const setLinks = (links: SocialContent["links"]) => set({ links });
  const quickAdd = (label: string, url: string) => {
    const blankOnly = content.links.length === 1 && !content.links[0]?.label.trim() && !content.links[0]?.url.trim();
    const id = itemId();
    setLinks([...(blankOnly ? [] : content.links), { id, label, url }]);
    requestAnimationFrame(() => document.getElementById(`hosted-link-url-${id}`)?.focus());
  };
  return (
    <div className="flex flex-col gap-5">
      <PhotoField
        id="hosted-social-photo"
        label={t("photo")}
        value={content.photo}
        onChange={(photo) => set({ photo })}
        shape="round"
        maxEdge={600}
      />
      <TextField
        id="hosted-social-name"
        label={t("name")}
        value={content.name}
        onChange={(name) => set({ name })}
        placeholder={t("namePlaceholder")}
        error={err("name")}
        maxLength={HOSTED_LIMITS.name}
      />
      <TextField
        id="hosted-social-bio"
        label={t("bio")}
        optional
        rows={2}
        value={content.bio}
        onChange={(bio) => set({ bio })}
        placeholder={t("bioPlaceholder")}
        maxLength={HOSTED_LIMITS.bio}
      />
      <fieldset className="flex flex-col gap-3">
        <legend className="mb-1 text-label">{t("links")}</legend>
        <ErrorText id="hosted-social-links-error">{err("links")}</ErrorText>
        <ol className="flex flex-col gap-2.5">
          {content.links.map((l, i) => {
            const labelErr = err(`links.${i}.label`);
            const urlErr = err(`links.${i}.url`);
            const item = l.label.trim() || t("link", { n: i + 1 });
            const at = (patch: Partial<typeof l>) => setLinks(content.links.map((x, j) => (j === i ? { ...x, ...patch } : x)));
            return (
              <li key={l.id} className="flex flex-col gap-1.5 rounded-lg border border-border bg-surface p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-caption font-semibold text-muted-foreground">{t("link", { n: i + 1 })}</span>
                  <RowControls
                    index={i}
                    count={content.links.length}
                    item={item}
                    onMove={(to) => setLinks(move(content.links, i, to))}
                    onRemove={() => setLinks(content.links.filter((_, j) => j !== i))}
                  />
                </div>
                <div className="grid gap-2 sm:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
                  <Input
                    id={`hosted-link-label-${l.id}`}
                    aria-label={`${t("labelLabel")} · ${t("link", { n: i + 1 })}`}
                    aria-invalid={labelErr ? true : undefined}
                    aria-describedby={labelErr || urlErr ? `hosted-link-${l.id}-error` : undefined}
                    placeholder={t("labelPlaceholder")}
                    value={l.label}
                    maxLength={HOSTED_LIMITS.name}
                    onChange={(e) => at({ label: e.target.value })}
                  />
                  <Input
                    id={`hosted-link-url-${l.id}`}
                    aria-label={`${t("urlLabel")} · ${t("link", { n: i + 1 })}`}
                    aria-invalid={urlErr ? true : undefined}
                    aria-describedby={labelErr || urlErr ? `hosted-link-${l.id}-error` : undefined}
                    inputMode="url"
                    placeholder={t("urlPlaceholder")}
                    value={l.url}
                    maxLength={HOSTED_LIMITS.url}
                    onChange={(e) => at({ url: e.target.value })}
                  />
                </div>
                <ErrorText id={`hosted-link-${l.id}-error`}>{[labelErr, urlErr].filter(Boolean).join(" ") || undefined}</ErrorText>
              </li>
            );
          })}
        </ol>
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-caption text-muted-foreground">{t("quickAdd")}</span>
          {QUICK.map(([label, url]) => (
            <Button
              key={label}
              type="button"
              variant="secondary"
              size="sm"
              disabled={content.links.length >= HOSTED_LIMITS.links}
              onClick={() => quickAdd(label, url)}
            >
              <PlusIcon aria-hidden />
              {label}
            </Button>
          ))}
        </div>
      </fieldset>
    </div>
  );
}

/* ── Business ────────────────────────────────────────────────────────────────────────────────────────────────── */

function BusinessForm({ content, onChange, errors }: HostedFormProps & { content: BusinessContent }) {
  const t = useTranslations("editor.hosted.business");
  const tDays = useTranslations("hosted.business.days");
  const err = useErr(errors);
  const set = (patch: Partial<BusinessContent>) => onChange({ ...content, ...patch });
  const hourAt = (i: number, patch: Partial<BusinessContent["hours"][number]>) =>
    set({ hours: content.hours.map((h, j) => (j === i ? { ...h, ...patch } : h)) });
  const copyMonday = () => {
    const mon = content.hours[0];
    if (mon) set({ hours: content.hours.map((h, i) => (i >= 1 && i <= 4 ? { ...mon } : h)) });
  };
  const hoursErr = content.hours.map((_, i) => err(`hours.${i}`)).find(Boolean);
  return (
    <div className="flex flex-col gap-5">
      <TextField
        id="hosted-business-name"
        label={t("name")}
        value={content.name}
        onChange={(name) => set({ name })}
        placeholder={t("namePlaceholder")}
        error={err("name")}
        maxLength={HOSTED_LIMITS.name}
      />
      <TextField
        id="hosted-business-desc"
        label={t("desc")}
        optional
        rows={2}
        value={content.desc}
        onChange={(desc) => set({ desc })}
        placeholder={t("descPlaceholder")}
        maxLength={HOSTED_LIMITS.businessDesc}
      />
      <fieldset className="flex flex-col gap-1.5" aria-describedby={hoursErr ? "hosted-hours-error" : "hosted-hours-zone"}>
        <legend className="mb-1.5 text-label">{t("hours")}</legend>
        {WEEKDAYS.map((d, i) => {
          const h = content.hours[i];
          if (!h) return null;
          const bad = Boolean(err(`hours.${i}`));
          return (
            <div key={d} className={cn("flex min-h-11 flex-wrap items-center gap-2 rounded-md px-1", bad && "bg-danger-soft")}>
              <label className="flex w-20 cursor-pointer items-center gap-2">
                <input
                  type="checkbox"
                  className="size-4.5 accent-primary"
                  checked={h.open}
                  onChange={(e) => hourAt(i, { open: e.target.checked })}
                />
                <span className="text-label">{tDays(d)}</span>
              </label>
              {h.open ? (
                <span className="flex items-center gap-1.5">
                  <Input
                    type="time"
                    aria-label={`${tDays(d)} · ${t("from")}`}
                    aria-invalid={bad || undefined}
                    className="w-30"
                    value={h.from}
                    onChange={(e) => hourAt(i, { from: e.target.value })}
                  />
                  <span aria-hidden>–</span>
                  <Input
                    type="time"
                    aria-label={`${tDays(d)} · ${t("to")}`}
                    aria-invalid={bad || undefined}
                    className="w-30"
                    value={h.to}
                    onChange={(e) => hourAt(i, { to: e.target.value })}
                  />
                </span>
              ) : (
                <span className="text-caption text-muted-foreground">{t("closed")}</span>
              )}
            </div>
          );
        })}
        <ErrorText id="hosted-hours-error">{hoursErr}</ErrorText>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Button type="button" variant="secondary" size="sm" onClick={copyMonday}>
            {t("copyMonday")}
          </Button>
          <span id="hosted-hours-zone" className="text-caption text-muted-foreground">
            {t("zone", { zone: content.timeZone })}
          </span>
        </div>
      </fieldset>
      <TextField
        id="hosted-business-address"
        label={t("address")}
        optional
        value={content.address}
        onChange={(address) => set({ address })}
        placeholder={t("addressPlaceholder")}
        hint={t("addressHint")}
        error={err("address")}
        maxLength={HOSTED_LIMITS.short}
      />
      <TextField
        id="hosted-business-phone"
        label={t("phone")}
        optional
        value={content.phone}
        onChange={(phone) => set({ phone })}
        placeholder={t("phonePlaceholder")}
        inputMode="tel"
        hint={t("phoneHint")}
        error={err("phone")}
        maxLength={40}
      />
      <TextField
        id="hosted-business-website"
        label={t("website")}
        optional
        value={content.website}
        onChange={(website) => set({ website })}
        placeholder={t("websitePlaceholder")}
        inputMode="url"
        hint={t("websiteHint")}
        error={err("website")}
        maxLength={HOSTED_LIMITS.url}
      />
    </div>
  );
}

/* ── Apps ────────────────────────────────────────────────────────────────────────────────────────────────────── */

function AppsForm({ content, onChange, errors }: HostedFormProps & { content: AppsContent }) {
  const t = useTranslations("editor.hosted.apps");
  const err = useErr(errors);
  const set = (patch: Partial<AppsContent>) => onChange({ ...content, ...patch });
  return (
    <div className="flex flex-col gap-5">
      <PhotoField id="hosted-apps-icon" label={t("icon")} value={content.icon} onChange={(icon) => set({ icon })} maxEdge={512} />
      <TextField
        id="hosted-apps-name"
        label={t("name")}
        value={content.name}
        onChange={(name) => set({ name })}
        placeholder={t("namePlaceholder")}
        error={err("name")}
        maxLength={HOSTED_LIMITS.name}
      />
      <TextField
        id="hosted-apps-desc"
        label={t("desc")}
        optional
        rows={2}
        value={content.desc}
        onChange={(desc) => set({ desc })}
        placeholder={t("descPlaceholder")}
        maxLength={HOSTED_LIMITS.appDesc}
      />
      <TextField
        id="hosted-apps-ios"
        label={t("ios")}
        value={content.ios}
        onChange={(ios) => set({ ios })}
        placeholder={t("iosPlaceholder")}
        inputMode="url"
        error={err("ios")}
        maxLength={HOSTED_LIMITS.url}
      />
      <TextField
        id="hosted-apps-android"
        label={t("android")}
        value={content.android}
        onChange={(android) => set({ android })}
        placeholder={t("androidPlaceholder")}
        inputMode="url"
        error={err("android")}
        hint={t("storesHint")}
        maxLength={HOSTED_LIMITS.url}
      />
    </div>
  );
}

/* ── PDF ─────────────────────────────────────────────────────────────────────────────────────────────────────── */

function PdfForm({ content, onChange, errors, signedIn, pdfState, onPdfState }: HostedFormProps & { content: PdfContent }) {
  const t = useTranslations("editor.hosted.pdf");
  const err = useErr(errors);
  const set = (patch: Partial<PdfContent>) => onChange({ ...content, ...patch });
  return (
    <div className="flex flex-col gap-5">
      <TextField
        id="hosted-pdf-title"
        label={t("title")}
        value={content.title}
        onChange={(title) => set({ title })}
        placeholder={t("titlePlaceholder")}
        error={err("title")}
        maxLength={HOSTED_LIMITS.name}
      />
      <TextField
        id="hosted-pdf-desc"
        label={t("desc")}
        optional
        value={content.desc}
        onChange={(desc) => set({ desc })}
        placeholder={t("descPlaceholder")}
        maxLength={HOSTED_LIMITS.note}
      />
      <PdfField
        file={content.file}
        onChange={(file) => set({ file })}
        signedIn={signedIn}
        state={pdfState}
        onState={onPdfState}
        error={err("file")}
      />
    </div>
  );
}

/* ── Product ─────────────────────────────────────────────────────────────────────────────────────────────────── */

function ProductForm({ content, onChange, errors }: HostedFormProps & { content: ProductContent }) {
  const t = useTranslations("editor.hosted.product");
  const tHosted = useTranslations("editor.hosted");
  const err = useErr(errors);
  const set = (patch: Partial<ProductContent>) => onChange({ ...content, ...patch });
  return (
    <div className="flex flex-col gap-5">
      <TextField
        id="hosted-product-name"
        label={t("name")}
        value={content.name}
        onChange={(name) => set({ name })}
        placeholder={t("namePlaceholder")}
        error={err("name")}
        maxLength={HOSTED_LIMITS.name}
      />
      <ProductPhotos
        images={content.images}
        onChange={(images) => set({ images })}
        label={t("photos")}
        hint={t("photosHint")}
        coverLabel={t("cover")}
        photoLabel={(n) => t("photo", { n })}
        removeLabel={(n) => tHosted("remove", { item: t("photo", { n }) })}
        addLabel={tHosted("photoAdd")}
        error={err("images")}
      />
      <TextField
        id="hosted-product-desc"
        label={t("desc")}
        optional
        rows={3}
        value={content.desc}
        onChange={(desc) => set({ desc })}
        placeholder={t("descPlaceholder")}
        maxLength={HOSTED_LIMITS.productDesc}
      />
      <CurrencyChoice label={t("currency")} value={content.currency} onChange={(currency) => set({ currency })} />
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="hosted-product-price">
          {t("price")}
          <span className="font-normal text-muted-foreground">· {tHosted("optional")}</span>
        </Label>
        <div className="flex max-w-48 items-center gap-1 rounded-md border border-input bg-surface ps-3 focus-within:border-ring">
          <span aria-hidden className="text-muted-foreground">
            {SYMBOL[content.currency]}
          </span>
          <input
            id="hosted-product-price"
            inputMode="decimal"
            placeholder={t("pricePlaceholder")}
            value={content.price}
            maxLength={HOSTED_LIMITS.price}
            aria-invalid={err("price") ? true : undefined}
            aria-describedby={err("price") ? "hosted-product-price-error" : undefined}
            onChange={(e) => set({ price: e.target.value })}
            className="min-h-control w-full min-w-0 bg-transparent pe-3 text-body tabular-nums outline-none"
          />
        </div>
        <ErrorText id="hosted-product-price-error">{err("price")}</ErrorText>
      </div>
      <div className="flex flex-col gap-1.5">
        <span className="text-label">{t("cta")}</span>
        <Segmented
          label={t("cta")}
          value={content.cta}
          options={PRODUCT_CTAS.map((c) => ({ value: c, label: t(`ctas.${c}`) }))}
          onChange={(cta) => set({ cta })}
        />
      </div>
      <TextField
        id="hosted-product-link"
        label={t("link")}
        value={content.link}
        onChange={(link) => set({ link })}
        placeholder={t("linkPlaceholder")}
        inputMode="url"
        hint={t("linkHint")}
        error={err("link")}
        maxLength={HOSTED_LIMITS.url}
      />
    </div>
  );
}

function ProductPhotos({
  images,
  onChange,
  label,
  hint,
  coverLabel,
  photoLabel,
  removeLabel,
  addLabel,
  error,
}: {
  images: string[];
  onChange: (images: string[]) => void;
  label: string;
  hint: string;
  coverLabel: string;
  photoLabel: (n: number) => string;
  removeLabel: (n: number) => string;
  addLabel: string;
  error?: string;
}) {
  const t = useTranslations("editor.hosted");
  const [problem, setProblem] = useState<string | null>(null);
  const add = async (files: FileList | null) => {
    if (!files) return;
    let next = [...images];
    for (const f of Array.from(files)) {
      if (next.length >= HOSTED_LIMITS.productImages) break;
      const out = await preparePhoto(f);
      if (!out.ok) {
        setProblem(t(out.problem.key, { name: out.problem.name, size: out.problem.size ?? "" }));
        continue;
      }
      setProblem(null);
      next = [...next, out.dataUrl];
    }
    onChange(next);
  };
  return (
    <div className="flex flex-col gap-1.5">
      <span id="hosted-product-photos-label" className="text-label">
        {label}
        <span className="font-normal text-muted-foreground"> · {t("optional")}</span>
      </span>
      <ul aria-labelledby="hosted-product-photos-label" className="flex flex-wrap gap-2">
        {images.map((src, i) => (
          <li key={`${i}-${src.slice(-16)}`} className="relative size-20 overflow-hidden rounded-lg bg-subtle">
            {/* eslint-disable-next-line @next/next/no-img-element -- local preview of the owner's photo */}
            <img
              src={src.startsWith("asset:") ? `/api/hosted/assets/${src.slice(6)}` : src}
              alt={photoLabel(i + 1)}
              className="size-full object-cover"
            />
            {i === 0 ? (
              <span className="absolute start-1 bottom-1 rounded-sm bg-inverse px-1.5 py-0.5 text-micro text-inverse-foreground">
                {coverLabel}
              </span>
            ) : null}
            <button
              type="button"
              aria-label={removeLabel(i + 1)}
              onClick={() => onChange(images.filter((_, j) => j !== i))}
              className="absolute end-1 top-1 grid size-7 cursor-pointer place-items-center rounded-full bg-surface/90 shadow-1"
            >
              <XIcon aria-hidden className="size-3.5" />
            </button>
          </li>
        ))}
        {images.length < HOSTED_LIMITS.productImages ? (
          <li>
            <label className="grid size-20 cursor-pointer place-items-center rounded-lg border-[1.5px] border-dashed border-border-strong text-center text-caption text-secondary-foreground hover:border-border-hover">
              <span className="flex flex-col items-center gap-1">
                <PlusIcon aria-hidden className="size-4" />
                {addLabel}
              </span>
              <input
                type="file"
                multiple
                accept="image/jpeg,image/png,.jpg,.jpeg,.png"
                className="sr-only"
                onChange={(e) => {
                  void add(e.target.files);
                  e.target.value = "";
                }}
              />
            </label>
          </li>
        ) : null}
      </ul>
      <p className="text-caption text-muted-foreground">{hint}</p>
      {problem || error ? (
        <p className="flex items-start gap-1.5 text-caption font-medium text-danger">
          <CircleAlertIcon aria-hidden className="mt-0.5 size-3.5 shrink-0" />
          {problem ?? error}
        </p>
      ) : null}
    </div>
  );
}
