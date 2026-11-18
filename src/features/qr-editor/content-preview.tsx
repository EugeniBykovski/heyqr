"use client";

import { parseWebsiteUrl, type QrContent } from "@heyqr/qr-core";
import { CalendarIcon, GlobeIcon, LockIcon, MailIcon, MapPinIcon, MessageSquareIcon, PhoneIcon, UserIcon, WifiIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { cn } from "@/shared/lib/utils";

/*
 * Design "ContentPreview · After scanning": a phone showing what people get when they scan. Empty fields show quiet
 * placeholders (static silhouette); filled values replace them. Dynamic website codes show the short link first.
 */
export function ContentPreview({ content, mode, className }: { content: QrContent; mode: "static" | "dynamic"; className?: string }) {
  const t = useTranslations("editor.afterScanning");
  const c = content as Record<string, string | boolean | undefined>;
  const v = (k: string) => (typeof c[k] === "string" ? (c[k] as string).trim() : "");
  const ph = (text: string | undefined, fallback: string) =>
    text ? <span className="animate-fade">{text}</span> : <span className="text-muted-foreground">{fallback}</span>;

  let body: ReactNode;
  switch (content.type) {
    case "website": {
      const parsed = parseWebsiteUrl(v("url"));
      const host = parsed.ok
        ? new URL(parsed.url).host
        : v("url")
            .trim()
            .replace(/^https?:\/\//i, "")
            .split(/[/?#]/)[0];
      body = (
        <>
          <div className="mx-3 mt-3.5 mb-2 flex h-8.5 min-w-0 items-center gap-1.5 rounded-full bg-subtle px-3 text-caption font-semibold">
            <LockIcon aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
            <span className="truncate">{ph(host, t("websitePlaceholder"))}</span>
          </div>
          <div className="flex flex-1 flex-col gap-2.5 px-4 py-2">
            <span className="h-28 rounded-lg bg-skeleton" />
            <span className="h-3 w-3/4 rounded-full bg-skeleton" />
            <span className="h-3 w-1/2 rounded-full bg-skeleton" />
            <span className="h-3 w-2/3 rounded-full bg-skeleton" />
          </div>
          {mode === "dynamic" ? <p className="px-4 pb-4 text-center text-[0.75rem] text-muted-foreground">{t("dynamicNote")}</p> : null}
        </>
      );
      break;
    }
    case "text":
      body = (
        <div className="m-3.5 self-stretch overflow-hidden rounded-[18px_18px_18px_6px] bg-subtle px-4 py-3.5 text-[0.875rem] leading-normal [overflow-wrap:anywhere] whitespace-pre-wrap">
          {/* Text is shown exactly as encoded: leading/trailing spaces and empty lines are content (HEY-21). */}
          {ph(v("text") ? String(c.text ?? "") : "", t("textPlaceholder"))}
        </div>
      );
      break;
    default: {
      const view = centerView(content.type, v, t);
      body = (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 px-4.5 py-5 text-center">
          <span className="grid size-19 place-items-center rounded-full bg-accent-hover text-accent-foreground">{view.icon}</span>
          <b className="text-h3">{ph(view.title, view.titlePlaceholder)}</b>
          <div className="mt-2 flex flex-col gap-0.5 self-stretch">
            {view.rows.map((r) => (
              <div key={r.label} className="flex min-h-9.5 items-center gap-2.5 border-b border-border px-1 py-2 text-left text-caption">
                <span className="text-muted-foreground">{r.label}</span>
                <span className="ml-auto truncate font-medium">{ph(r.value, "—")}</span>
              </div>
            ))}
          </div>
          <span className="mt-2 rounded-full bg-primary px-4 py-2 text-caption font-semibold text-primary-foreground">{view.action}</span>
        </div>
      );
    }
  }

  return (
    <figure aria-label={t("label")} className={cn("flex flex-col items-center gap-3", className)}>
      <div className="aspect-[9/17] w-full max-w-[18.75rem] rounded-[2.5rem] bg-inverse p-2 shadow-2">
        <div className="flex h-full flex-col overflow-hidden rounded-[2rem] bg-surface">{body}</div>
      </div>
      <figcaption className="text-center text-[0.75rem] text-muted-foreground">{t("caption")}</figcaption>
    </figure>
  );
}

type T = ReturnType<typeof useTranslations<"editor.afterScanning">>;
function centerView(type: QrContent["type"], v: (k: string) => string, t: T) {
  const icon = (I: typeof GlobeIcon) => <I aria-hidden className="size-8" strokeWidth={1.7} />;
  switch (type) {
    case "wifi":
      return {
        icon: icon(WifiIcon),
        title: v("ssid"),
        titlePlaceholder: t("wifiPlaceholder"),
        rows: [
          { label: t("security"), value: v("security") === "nopass" ? t("open") : v("security") },
          { label: t("password"), value: v("password") ? "••••••••" : "" },
        ],
        action: t("join"),
      };
    case "contact":
      return {
        icon: icon(UserIcon),
        title: [v("firstName"), v("lastName")].filter(Boolean).join(" "),
        titlePlaceholder: t("contactPlaceholder"),
        rows: [
          { label: t("phone"), value: v("phone") },
          { label: t("email"), value: v("email") },
          { label: t("company"), value: v("company") },
        ],
        action: t("save"),
      };
    case "email":
      return {
        icon: icon(MailIcon),
        title: v("to"),
        titlePlaceholder: t("emailPlaceholder"),
        rows: [{ label: t("subject"), value: v("subject") }],
        action: t("compose"),
      };
    case "phone":
      return { icon: icon(PhoneIcon), title: v("number"), titlePlaceholder: t("phonePlaceholder"), rows: [], action: t("call") };
    case "sms":
      return {
        icon: icon(MessageSquareIcon),
        title: v("number"),
        titlePlaceholder: t("phonePlaceholder"),
        rows: [{ label: t("message"), value: v("message") }],
        action: t("text"),
      };
    case "location":
      return {
        icon: icon(MapPinIcon),
        title: v("name") || v("address"),
        titlePlaceholder: t("locationPlaceholder"),
        rows: [{ label: t("address"), value: v("address") }],
        action: t("openMaps"),
      };
    default:
      return {
        icon: icon(CalendarIcon),
        title: v("title"),
        titlePlaceholder: t("eventPlaceholder"),
        rows: [
          { label: t("starts"), value: v("start").replace("T", " ") },
          { label: t("place"), value: v("place") },
        ],
        action: t("addToCalendar"),
      };
  }
}
