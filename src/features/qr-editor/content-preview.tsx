"use client";

import { parseWebsiteUrl, type QrContent } from "@heyqr/qr-core";
import { CalendarIcon, GlobeIcon, LockIcon, MailIcon, MapPinIcon, MessageSquareIcon, PhoneIcon, WifiIcon } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { cn } from "@/shared/lib/utils";
import { Badge } from "@/shared/ui/badge";
import { Placeholder, Skeleton } from "@/shared/ui/skeleton";

/*
 * Design "ContentPreview · After scanning": a phone showing what people get when they scan. Empty fields show quiet
 * placeholder shapes in the layout of the chosen type (Website, Text, Wi-Fi and contact each have their own); filled
 * values replace them. While the preview is loading (HEY-41) the same shapes shimmer and the phone keeps its size.
 * Dynamic website codes show the short link note.
 */
export function ContentPreview({
  content,
  mode,
  loading = false,
  className,
}: {
  content: QrContent;
  mode: "static" | "dynamic";
  /** A real wait (the editor loading): every value becomes a shimmering shape; the phone's size doesn't change. */
  loading?: boolean;
  className?: string;
}) {
  const t = useTranslations("editor.afterScanning");
  const tTypes = useTranslations("contentTypes");
  const format = useFormatter();
  const c = content as Record<string, string | boolean | undefined>;
  const v = (k: string) => (loading ? "" : typeof c[k] === "string" ? (c[k] as string).trim() : "");
  const raw = (k: string) => (loading ? "" : typeof c[k] === "string" ? (c[k] as string) : "");
  const ph = (text: string | undefined, fallback: string, shape = "h-3 w-1/2") =>
    text ? <span className="animate-fade">{text}</span> : <Shape loading={loading} className={shape} label={fallback} />;

  let body: ReactNode;
  switch (content.type) {
    case "website": {
      // Neutral page silhouette with or without input; only the address bar and header show the domain, once valid.
      const parsed = loading ? null : parseWebsiteUrl(v("url"));
      const url = parsed?.ok ? new URL(parsed.url) : null;
      const host = url?.hostname.replace(/^www\./, "") ?? "";
      const domain = url ? `${url.host}${url.pathname === "/" ? "" : url.pathname}${url.search}` : "";
      body = (
        <>
          <div className="mx-3 mt-3.5 mb-2 flex h-8.5 min-w-0 items-center gap-1.5 rounded-full bg-subtle px-3 text-caption font-semibold">
            <LockIcon aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
            {domain ? (
              <span className="animate-fade truncate">{domain}</span>
            ) : (
              <Shape loading={loading} className="h-2.5 w-3/5" label={t("websitePlaceholder")} />
            )}
          </div>
          <div className="flex flex-1 flex-col gap-2.5 px-4 py-2">
            <div className="flex min-h-7 items-center gap-2.5">
              {host ? (
                <>
                  <span className="grid size-7 shrink-0 animate-fade place-items-center rounded-sm bg-subtle text-[0.8125rem] font-bold">
                    {[...host][0]?.toUpperCase()}
                  </span>
                  <span className="animate-fade truncate text-label">{host}</span>
                </>
              ) : (
                <>
                  <Shape loading={loading} className="size-7" />
                  <Shape loading={loading} className="h-3 w-[46%]" />
                </>
              )}
            </div>
            <Shape loading={loading} className="h-[7.375rem] w-full rounded-[0.875rem]" />
            <Shape loading={loading} className="h-4.5 w-[82%]" />
            <Shape loading={loading} className="h-3 w-full" />
            <Shape loading={loading} className="h-3 w-[92%]" />
            <Shape loading={loading} className="h-3 w-[70%]" />
            <div className="mt-1 grid grid-cols-2 gap-2">
              <Shape loading={loading} className="h-16 w-full rounded-[0.625rem]" />
              <Shape loading={loading} className="h-16 w-full rounded-[0.625rem]" />
            </div>
          </div>
          {mode === "dynamic" ? <p className="px-4 pb-4 text-center text-[0.75rem] text-muted-foreground">{t("dynamicNote")}</p> : null}
        </>
      );
      break;
    }
    case "text": {
      // Text is shown exactly as encoded: leading/trailing spaces and empty lines are content (HEY-21).
      const text = v("text") ? raw("text") : "";
      body = (
        <div className="flex flex-1 flex-col pt-4.5">
          <span className="text-center text-caption text-muted-foreground">{t("textKicker")}</span>
          {text ? (
            <div className="m-3.5 self-stretch overflow-hidden rounded-[18px_18px_18px_6px] bg-subtle px-4 py-3.5 text-[0.875rem] leading-normal [overflow-wrap:anywhere] whitespace-pre-wrap">
              <span className="animate-fade">{text}</span>
            </div>
          ) : (
            <div className="m-3.5 flex flex-col gap-2.5 self-stretch rounded-[18px_18px_18px_6px] bg-subtle px-4 py-3.5">
              <Shape loading={loading} className="h-3 w-[92%]" label={t("textPlaceholder")} />
              <Shape loading={loading} className="h-3 w-full" />
              <Shape loading={loading} className="h-3 w-[64%]" />
            </div>
          )}
        </div>
      );
      break;
    }
    case "wifi": {
      // The network name exactly as phones show it, the security mode, and the password as dots only (never its
      // length or value); an open network has no password row.
      const open = c.security === "nopass";
      body = (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 px-4.5 py-5 text-center">
          <span className="grid size-16 place-items-center rounded-full bg-accent-hover text-accent-foreground">
            <WifiIcon aria-hidden className="size-8" strokeWidth={1.7} />
          </span>
          <span className="text-caption text-secondary-foreground">{t("wifiKicker")}</span>
          {v("ssid") ? (
            <b className="animate-fade text-h3 [overflow-wrap:anywhere] whitespace-pre-wrap">{raw("ssid")}</b>
          ) : (
            <Shape loading={loading} className="h-4.5 w-3/5" label={t("wifiPlaceholder")} />
          )}
          <div className="mt-2 flex flex-col gap-0.5 self-stretch">
            <Row label={t("security")} value={open ? t("open") : c.security === "WEP" ? "WEP" : "WPA/WPA2/WPA3"} />
            {open ? null : <Row label={t("password")} value={ph(raw("password") ? "••••••••" : "", "—", "h-2.5 w-2/5")} />}
          </div>
          <span className="mt-2 self-stretch rounded-full bg-primary px-4 py-2 text-caption font-semibold text-primary-foreground">
            {t("join")}
          </span>
        </div>
      );
      break;
    }
    case "contact": {
      // Initials, full name, "title · company", then phone, email and website, and "Add to contacts".
      const letters = [v("firstName"), v("lastName")]
        .map((n) => [...n][0] ?? "")
        .join("")
        .toUpperCase();
      const name = [v("firstName"), v("lastName")].filter(Boolean).join(" ");
      const role = [v("title"), v("company")].filter(Boolean).join(" · ");
      const rows = [
        { icon: PhoneIcon, label: t("phone"), value: v("phone"), shape: "w-[56%]" },
        { icon: MailIcon, label: t("email"), value: v("email"), shape: "w-[70%]" },
        { icon: GlobeIcon, label: t("website"), value: v("website").replace(/^https?:\/\//i, ""), shape: "w-[48%]" },
      ];
      body = (
        <div className="flex flex-1 flex-col items-center gap-3 px-4.5 pt-8 pb-5 text-center">
          {letters ? (
            <span className="grid size-19 shrink-0 animate-fade place-items-center rounded-full bg-accent-hover text-h2 font-bold tracking-[-0.02em] text-accent-foreground">
              {letters}
            </span>
          ) : (
            <Shape loading={loading} className="size-19" />
          )}
          {name ? (
            <b className="animate-fade text-h3 [overflow-wrap:anywhere]">{name}</b>
          ) : (
            <Shape loading={loading} className="h-4.5 w-[58%]" label={t("contactPlaceholder")} />
          )}
          {role ? (
            <span className="-mt-1 animate-fade text-caption [overflow-wrap:anywhere] text-secondary-foreground">{role}</span>
          ) : (
            <Shape loading={loading} className="h-2.5 w-[44%]" />
          )}
          <div className="mt-2 flex flex-col gap-0.5 self-stretch">
            {rows.map(({ icon: I, label, value, shape }) => (
              <div key={label} className="flex min-h-9.5 items-center gap-2.5 border-b border-border px-1 py-2 text-left text-caption">
                <I aria-hidden className="size-4 shrink-0 text-muted-foreground" />
                <span className="sr-only">{label}</span>
                {value ? (
                  <span className="animate-fade truncate font-medium">{value}</span>
                ) : (
                  <Shape loading={loading} className={cn("h-2.5", shape)} />
                )}
              </div>
            ))}
          </div>
          <span className="mt-auto self-stretch rounded-full border border-border px-4 py-2 text-caption font-semibold">{t("save")}</span>
        </div>
      );
      break;
    }
    default: {
      const view = centerView(content.type, v, t, (start, end) => eventWhen(format, start, end));
      body = (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 px-4.5 py-5 text-center">
          <span className="grid size-19 place-items-center rounded-full bg-accent-hover text-accent-foreground">{view.icon}</span>
          <b className="text-h3 [overflow-wrap:anywhere]">{ph(view.title, view.titlePlaceholder, "h-4.5 w-3/5")}</b>
          <div className="mt-2 flex flex-col gap-0.5 self-stretch">
            {view.rows.map((r) => (
              <Row key={r.label} label={r.label} value={ph(r.value, "—", "h-2.5 w-1/2")} />
            ))}
          </div>
          <span className="mt-2 rounded-full bg-primary px-4 py-2 text-caption font-semibold text-primary-foreground">{view.action}</span>
        </div>
      );
    }
  }

  return (
    <figure aria-label={t("label")} aria-busy={loading || undefined} className={cn("flex flex-col items-center gap-3", className)}>
      {/* Design 1.3–1.5 "After scanning" with the content type, above the phone. */}
      <figcaption className="flex w-full max-w-[23rem] items-center justify-between gap-2">
        <span className="text-[0.8125rem] font-semibold text-secondary-foreground">{t("label")}</span>
        <Badge>{tTypes(content.type)}</Badge>
      </figcaption>
      <div aria-hidden={loading || undefined} className="aspect-[9/17] w-full max-w-[18.75rem] rounded-[2.5rem] bg-inverse p-2 shadow-2">
        <div className="flex h-full flex-col overflow-hidden rounded-[2rem] bg-surface">{body}</div>
      </div>
      {loading ? (
        <p role="status" className="sr-only">
          {t("loading")}
        </p>
      ) : null}
    </figure>
  );
}

/** An empty or loading value: the placeholder shape (shimmering while loading), with its words for screen readers. */
function Shape({ loading, className, label }: { loading: boolean; className?: string; label?: string }) {
  return (
    <>
      {loading ? <Skeleton className={cn("rounded-full", className)} /> : <Placeholder className={className} />}
      {label && !loading ? <span className="sr-only">{label}</span> : null}
    </>
  );
}

function Row({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex min-h-9.5 items-center gap-2.5 border-b border-border px-1 py-2 text-left text-caption">
      <span className="text-muted-foreground">{label}</span>
      <span className="ml-auto flex min-w-0 justify-end truncate font-medium">{value}</span>
    </div>
  );
}

type T = ReturnType<typeof useTranslations<"editor.afterScanning">>;

/**
 * Design 1.14: the event's date and times as the phone shows them, in the viewer's language ("Sat, Dec 5, 2026 ·
 * 18:30–21:00"). The value is read as entered (local wall time), never shifted by a time zone.
 */
export function eventWhen(format: ReturnType<typeof useFormatter>, start: string, end: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/.exec(start);
  if (!m) return start;
  const [, y, mo, d, h, mi] = m;
  const day = new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h ?? 0), Number(mi ?? 0)));
  const date = format.dateTime(day, { weekday: "short", month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
  if (h === undefined) return date;
  const time = (v: Date) => format.dateTime(v, { hour: "numeric", minute: "2-digit", timeZone: "UTC" });
  const e = /T(\d{2}):(\d{2})/.exec(end);
  const endTime = e ? time(new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(e[1]), Number(e[2])))) : null;
  return `${date} · ${time(day)}${endTime ? `–${endTime}` : ""}`;
}
/** Email, phone call, text message, location and event: an icon, a title, detail rows and the action. */
function centerView(
  type: QrContent["type"],
  v: (k: string) => string,
  t: T,
  when: (start: string, end: string) => string,
): {
  icon: ReactNode;
  title: string;
  titlePlaceholder: string;
  rows: { label: string; value: string }[];
  action: string;
} {
  const icon = (I: typeof GlobeIcon) => <I aria-hidden className="size-8" strokeWidth={1.7} />;
  switch (type) {
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
          { label: t("starts"), value: when(v("start"), v("end")) },
          { label: t("place"), value: v("place") },
        ],
        action: t("addToCalendar"),
      };
  }
}
