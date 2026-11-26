import {
  AppleIcon,
  ArrowUpRightIcon,
  ClockIcon,
  DownloadIcon,
  ExternalLinkIcon,
  FileTextIcon,
  GlobeIcon,
  LinkIcon,
  MapPinIcon,
  NavigationIcon,
  PhoneIcon,
  PlayIcon,
  SmartphoneIcon,
} from "lucide-react";
import { useFormatter, useLocale, useTranslations } from "next-intl";
import type { ReactNode } from "react";
import {
  businessNow,
  couponExpired,
  formatFileSize,
  formatHostedPrice,
  hostedHref,
  hostedImageSrc,
  WEEKDAYS,
  type AppsContent,
  type BusinessContent,
  type CouponContent,
  type HostedContent,
  type MenuContent,
  type PdfContent,
  type ProductContent,
  type SocialContent,
} from "@/entities/qr";
import { cn } from "@/shared/lib/utils";
import { CopyCode } from "./copy-code";
import { ProductGallery } from "./product-gallery";

/*
 * Design 11.0 "Scan pages": the mobile-first public page of each hosted type, shared by the editor's "After scan"
 * preview (inside a phone, nothing navigates) and the public page at the short link (real links and buttons).
 * Server-safe: no hooks beyond next-intl; the copy button and the gallery are small client leaves.
 */
export type HostedPageProps = {
  content: HostedContent;
  /** "preview": the editor (links are inert, empty fields show quiet shapes); "public": a visitor's page. */
  mode: "preview" | "public";
  /** Coupon preview toggle (design 11.2): show the expired page without changing the saved date. */
  forceExpired?: boolean;
  /** The time the page is shown for (coupon end, business hours). */
  now?: Date;
  /** Apps on a computer (public, unknown device): the two-column page with the scannable QR. */
  desktop?: boolean;
  /** The QR for the same short link, shown on the desktop Apps page. */
  desktopQr?: ReactNode;
  /** Footer "Report this page" (public only). */
  reportHref?: string;
  /** PDF: a newer version is being prepared (design 11.0 "PDF processing"). */
  pdfWaiting?: boolean;
};

export function HostedPage(props: HostedPageProps) {
  const t = useTranslations("hosted");
  const { content, mode, reportHref } = props;
  let body: ReactNode;
  switch (content.type) {
    case "menu":
      body = <MenuPage {...props} content={content} />;
      break;
    case "coupon":
      body = <CouponPage {...props} content={content} />;
      break;
    case "social":
      body = <SocialPage {...props} content={content} />;
      break;
    case "business":
      body = <BusinessPage {...props} content={content} />;
      break;
    case "apps":
      body = <AppsPage {...props} content={content} />;
      break;
    case "pdf":
      body = <PdfPage {...props} content={content} />;
      break;
    case "product":
      body = <ProductPage {...props} content={content} />;
      break;
  }
  return (
    <div className={cn("flex min-h-full flex-col gap-4 text-start", mode === "preview" ? "py-1 text-[0.8125rem]" : "text-body")}>
      {body}
      <p className="mt-auto pt-3 text-center text-micro text-muted-foreground">
        {t("hostedBy")}
        {" · "}
        {mode === "public" && reportHref ? (
          <a href={reportHref} className="underline underline-offset-2 hover:text-foreground">
            {t("report")}
          </a>
        ) : (
          <span>{t("report")}</span>
        )}
      </p>
    </div>
  );
}

/* ── Building blocks ─────────────────────────────────────────────────────────────────────────────────────────── */

const pad = "mx-3";

/** A real link on the public page, an inert look-alike in the editor preview. */
function Action({
  mode,
  href,
  children,
  className,
  download,
  label,
}: {
  mode: "preview" | "public";
  href: string | null;
  children: ReactNode;
  className?: string;
  download?: boolean;
  label?: string;
}) {
  if (mode === "public" && href)
    return (
      <a
        href={href}
        className={className}
        aria-label={label}
        download={download || undefined}
        rel={download ? undefined : "noopener noreferrer nofollow"}
      >
        {children}
      </a>
    );
  return (
    <span className={className} aria-label={label}>
      {children}
    </span>
  );
}

const primaryBtn =
  "flex min-h-11 items-center justify-center gap-2 rounded-full bg-primary px-5 text-label text-primary-foreground transition-colors hover:bg-primary-hover";
const secondaryBtn =
  "flex min-h-11 items-center justify-center gap-2 rounded-full border border-border bg-surface px-5 text-label transition-colors hover:border-border-hover";

/** A quiet placeholder shape for an empty field in the editor preview (nothing on the public page). */
function Ph({ mode, className, onDark }: { mode: "preview" | "public"; className?: string; onDark?: boolean }) {
  if (mode === "public") return null;
  return <span aria-hidden className={cn("block h-3 rounded-full", onDark ? "bg-inverse-border" : "bg-skeleton", className)} />;
}

function Hero({ kicker, children }: { kicker: string; children: ReactNode }) {
  return (
    <div className={cn(pad, "flex flex-col gap-1.5 rounded-[1.125rem] bg-inverse p-4 text-inverse-foreground")}>
      <span className="text-[0.625rem] font-bold tracking-[0.1em] uppercase opacity-75">{kicker}</span>
      {children}
    </div>
  );
}

const title = "text-[1.25rem] leading-[1.15] font-bold tracking-[-0.02em] [overflow-wrap:anywhere]";
const sub = "text-[0.8125rem] leading-[1.45] [overflow-wrap:anywhere]";

function Img({ src, alt, className }: { src: string; alt: string; className?: string }) {
  // eslint-disable-next-line @next/next/no-img-element -- owner uploads served by HeyQR (data URLs while editing)
  return <img src={hostedImageSrc(src)} alt={alt} className={cn("object-cover", className)} loading="lazy" />;
}

/* ── Menu (10.4) ─────────────────────────────────────────────────────────────────────────────────────────────── */

function MenuPage({ content, mode }: HostedPageProps & { content: MenuContent }) {
  const t = useTranslations("hosted.menu");
  const locale = useLocale();
  const sections = content.sections;
  return (
    <>
      <Hero kicker={t("kicker")}>
        {content.name.trim() ? <b className={title}>{content.name}</b> : <Ph mode={mode} onDark className="h-5 w-3/4" />}
        {content.note.trim() ? <span className={cn(sub, "opacity-85")}>{content.note}</span> : null}
      </Hero>
      {sections.length > 1 ? (
        <nav aria-label={t("sections")} className="flex [scrollbar-width:none] gap-1.5 overflow-x-auto px-3">
          {sections.map((s, i) => (
            <Action
              key={s.id}
              mode={mode}
              href={`#menu-${s.id}`}
              className={cn(
                "flex min-h-8 shrink-0 items-center rounded-full px-3 text-[0.75rem] font-semibold whitespace-nowrap",
                i === 0 ? "bg-inverse text-inverse-foreground" : "bg-subtle",
              )}
            >
              {s.name.trim() || "—"}
            </Action>
          ))}
        </nav>
      ) : null}
      {sections.map((s) => (
        <section key={s.id} id={`menu-${s.id}`} aria-label={s.name || undefined} className={cn(pad, "flex scroll-mt-4 flex-col")}>
          <h2 className="py-1 text-[0.6875rem] font-bold tracking-[0.08em] text-muted-foreground uppercase">
            {s.name.trim() || <Ph mode={mode} className="h-2.5 w-1/3" />}
          </h2>
          <ul className="flex flex-col">
            {s.dishes.map((d) => {
              const price = formatHostedPrice(d.price, content.currency, locale);
              return (
                <li key={d.id} className="flex items-start gap-2.5 border-b border-border py-2.5 last:border-b-0">
                  {d.photo ? <Img src={d.photo} alt="" className="size-14 shrink-0 rounded-[0.625rem] bg-subtle" /> : null}
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                    {d.name.trim() ? (
                      <b className="text-[0.875rem] [overflow-wrap:anywhere]">{d.name}</b>
                    ) : (
                      <Ph mode={mode} className="w-2/3" />
                    )}
                    {d.desc.trim() ? <span className="text-[0.75rem] leading-[1.4] text-secondary-foreground">{d.desc}</span> : null}
                  </span>
                  {price ? <span className="font-bold whitespace-nowrap tabular-nums">{price}</span> : null}
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </>
  );
}

/* ── Coupon (11.1 / 11.2) ────────────────────────────────────────────────────────────────────────────────────── */

function CouponPage({ content, mode, forceExpired, now }: HostedPageProps & { content: CouponContent }) {
  const t = useTranslations("hosted.coupon");
  const format = useFormatter();
  const expired = forceExpired || couponExpired(content, now);
  const date = content.expires ? format.dateTime(new Date(`${content.expires}T12:00:00Z`), { dateStyle: "medium", timeZone: "UTC" }) : "";
  const redeem = !expired && content.link.trim() ? hostedHref(content.link) : null;
  return (
    <>
      <div
        className={cn(
          pad,
          "mt-1 overflow-hidden rounded-[1.125rem]",
          expired ? "bg-muted text-secondary-foreground" : "bg-primary text-primary-foreground",
        )}
      >
        <div className="flex flex-col gap-1.5 px-4.5 pt-4.5 pb-3.5">
          <span className="text-[0.625rem] font-bold tracking-[0.1em] uppercase opacity-75">
            {expired ? t("expiredKicker") : t("kicker")}
          </span>
          {content.discount.trim() ? (
            <b className="text-[2.125rem] leading-none font-extrabold tracking-[-0.03em] [overflow-wrap:anywhere]">{content.discount}</b>
          ) : (
            <Ph mode={mode} onDark={!expired} className="h-7 w-1/2" />
          )}
          {content.title.trim() ? (
            <span className="text-[0.875rem] leading-[1.35] font-semibold [overflow-wrap:anywhere]">{content.title}</span>
          ) : (
            <Ph mode={mode} onDark={!expired} className="w-3/4" />
          )}
        </div>
        <div aria-hidden className="mx-3.5 border-t-2 border-dashed border-current opacity-40" />
        <div className="flex flex-col items-start gap-2.5 px-4.5 pt-3.5 pb-4.5">
          {!expired && content.code ? (
            <div className="flex items-center justify-between gap-2 self-stretch rounded-[0.625rem] border-[1.5px] border-dashed border-current py-1.5 ps-3 pe-1.5">
              <span className="font-mono text-[0.9375rem] font-bold tracking-[0.06em] [overflow-wrap:anywhere]">{content.code}</span>
              {mode === "public" ? (
                <CopyCode code={content.code} copyLabel={t("copy")} copiedLabel={t("copied")} />
              ) : (
                <span className="rounded-full bg-surface px-2.5 py-1.5 text-[0.6875rem] font-bold text-accent-text">{t("copy")}</span>
              )}
            </div>
          ) : null}
          {expired ? (
            <span className="inline-flex -rotate-[4deg] rounded-md border-2 border-danger px-2.5 py-1 text-[0.75rem] font-extrabold tracking-[0.12em] text-danger uppercase">
              {t("expired")}
            </span>
          ) : null}
          {date ? <span className="text-[0.75rem] opacity-85">{expired ? t("endedOn", { date }) : t("ends", { date })}</span> : null}
        </div>
      </div>
      {redeem || (mode === "preview" && !expired && content.link.trim()) ? (
        <Action mode={mode} href={redeem} className={cn(pad, primaryBtn)}>
          {t("redeem")}
          <ArrowUpRightIcon aria-hidden className="size-4" />
        </Action>
      ) : null}
      {expired ? <p className="mx-3.5 text-[0.75rem] leading-[1.45] text-muted-foreground">{t("ended")}</p> : null}
      {content.terms.trim() ? (
        <div
          className={cn(
            pad,
            "flex flex-col gap-1 rounded-xl bg-subtle px-3 py-2.5 text-[0.75rem] leading-[1.45] text-secondary-foreground",
          )}
        >
          <b className="text-foreground">{t("terms")}</b>
          <span className="[overflow-wrap:anywhere] whitespace-pre-line">{content.terms}</span>
        </div>
      ) : null}
    </>
  );
}

/* ── Social links (11.4) ─────────────────────────────────────────────────────────────────────────────────────── */

const initials = (name: string) =>
  name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => [...w][0]?.toUpperCase() ?? "")
    .join("");

function SocialPage({ content, mode }: HostedPageProps & { content: SocialContent }) {
  const t = useTranslations("hosted.social");
  const links = mode === "public" ? content.links.filter((l) => l.label.trim() && hostedHref(l.url)) : content.links;
  return (
    <>
      <div className="mx-3.5 mt-2 flex flex-col items-center gap-2 text-center">
        {content.photo ? (
          <Img src={content.photo} alt="" className="size-21 rounded-full bg-subtle" />
        ) : (
          <span className="grid size-21 place-items-center rounded-full bg-accent text-[1.75rem] font-bold text-accent-text">
            {initials(content.name) || <SmartphoneIcon aria-hidden className="size-7" />}
          </span>
        )}
        {content.name.trim() ? <h1 className={title}>{content.name}</h1> : <Ph mode={mode} className="h-5 w-1/2" />}
        {content.bio.trim() ? <p className={cn(sub, "text-secondary-foreground")}>{content.bio}</p> : null}
      </div>
      <ul aria-label={t("links")} className={cn(pad, "flex flex-col gap-2")}>
        {links.map((l) => (
          <li key={l.id}>
            <Action
              mode={mode}
              href={hostedHref(l.url)}
              className="flex min-h-12 items-center gap-2.5 rounded-[0.875rem] border border-border bg-surface py-1.5 ps-1.5 pe-3 shadow-1 transition-colors hover:border-border-hover"
            >
              <span className="grid size-8.5 shrink-0 place-items-center rounded-[0.625rem] bg-accent text-accent-text">
                <LinkIcon aria-hidden className="size-4" />
              </span>
              {l.label.trim() ? (
                <b className="min-w-0 flex-1 text-[0.875rem] [overflow-wrap:anywhere]">{l.label}</b>
              ) : (
                <Ph mode={mode} className="w-1/2 flex-1" />
              )}
              <ArrowUpRightIcon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
            </Action>
          </li>
        ))}
      </ul>
    </>
  );
}

/* ── Business (11.6 / 11.7) ──────────────────────────────────────────────────────────────────────────────────── */

function BusinessPage({ content, mode, now }: HostedPageProps & { content: BusinessContent }) {
  const t = useTranslations("hosted.business");
  const { day, status } = businessNow(content, now);
  const openLabel =
    status.kind === "open"
      ? t("openNow", { to: status.to })
      : status.kind === "before"
        ? t("closedOpens", { from: status.from })
        : status.kind === "after"
          ? t("closedNow")
          : t("closedToday");
  const phone = content.phone.trim();
  const address = content.address.trim();
  const website = content.website.trim() ? hostedHref(content.website) : null;
  // Buttons only for details that exist (design 11.7: a phone-only business shows just Call).
  const acts = [
    phone ? { key: "call", icon: PhoneIcon, label: t("call"), href: `tel:${phone.replace(/[^\d+]/g, "")}` } : null,
    address
      ? {
          key: "directions",
          icon: NavigationIcon,
          label: t("directions"),
          href: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`,
        }
      : null,
    website ? { key: "website", icon: GlobeIcon, label: t("website"), href: website } : null,
  ].filter((a): a is NonNullable<typeof a> => a !== null);
  return (
    <>
      <Hero kicker={t("kicker")}>
        {content.name.trim() ? <h1 className={title}>{content.name}</h1> : <Ph mode={mode} onDark className="h-5 w-2/3" />}
        {content.desc.trim() ? <span className={cn(sub, "opacity-85")}>{content.desc}</span> : null}
        <span
          className={cn(
            "mt-1 self-start rounded-full px-2.5 py-0.5 text-[0.75rem] font-bold",
            status.kind === "open" ? "bg-success-soft text-success" : "bg-inverse-border text-inverse-muted",
          )}
        >
          {openLabel}
        </span>
      </Hero>
      {acts.length ? (
        <div className={cn(pad, "grid auto-cols-fr grid-flow-col gap-1.5")}>
          {acts.map((a) => (
            <Action
              key={a.key}
              mode={mode}
              href={a.href}
              className="flex min-h-14 flex-col items-center justify-center gap-1 rounded-xl bg-accent px-1 py-2.5 text-[0.75rem] font-bold text-accent-text"
            >
              <a.icon aria-hidden className="size-4.5" />
              {a.label}
            </Action>
          ))}
        </div>
      ) : null}
      {address || phone || website ? (
        <div className={cn(pad, "flex flex-col")}>
          {address ? <InfoRow icon={<MapPinIcon aria-hidden className="size-4" />}>{address}</InfoRow> : null}
          {phone ? <InfoRow icon={<PhoneIcon aria-hidden className="size-4" />}>{phone}</InfoRow> : null}
          {website ? <InfoRow icon={<GlobeIcon aria-hidden className="size-4" />}>{content.website.trim()}</InfoRow> : null}
        </div>
      ) : null}
      <div className={cn(pad, "flex flex-col gap-0.5 text-[0.75rem]")}>
        <b className="mb-1 flex items-center gap-1.5 text-[0.8125rem]">
          <ClockIcon aria-hidden className="size-3.5" />
          {t("hours")}
        </b>
        <dl className="flex flex-col">
          {WEEKDAYS.map((d, i) => {
            const h = content.hours[i];
            return (
              <div
                key={d}
                aria-current={i === day ? "date" : undefined}
                className={cn(
                  "flex justify-between py-1 tabular-nums",
                  i === day ? "font-bold text-foreground" : "text-secondary-foreground",
                )}
              >
                <dt>{t(`days.${d}`)}</dt>
                <dd>{h?.open ? `${h.from}–${h.to}` : t("closed")}</dd>
              </div>
            );
          })}
        </dl>
      </div>
    </>
  );
}

function InfoRow({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <div className="flex min-h-9.5 items-center gap-2.5 border-b border-border py-2 text-[0.8125rem] last:border-b-0">
      <span className="shrink-0 text-muted-foreground">{icon}</span>
      <span className="min-w-0 [overflow-wrap:anywhere]">{children}</span>
    </div>
  );
}

/* ── Apps (11.8, fallback and desktop) ───────────────────────────────────────────────────────────────────────── */

function AppsPage({ content, mode, desktop, desktopQr }: HostedPageProps & { content: AppsContent }) {
  const t = useTranslations("hosted.apps");
  const ios = content.ios.trim() ? hostedHref(content.ios) : null;
  const android = content.android.trim() ? hostedHref(content.android) : null;
  const stores = (
    <div className={cn("flex gap-2", desktop ? "flex-row flex-wrap" : "flex-col px-3.5")}>
      {ios || (mode === "preview" && content.ios.trim()) ? (
        <Action
          mode={mode}
          href={ios}
          className="flex min-h-12 items-center gap-2.5 rounded-xl bg-inverse px-4 py-1 text-inverse-foreground"
        >
          <AppleIcon aria-hidden className="size-5" />
          <span className="flex flex-col leading-[1.1]">
            <span className="text-[0.625rem] opacity-80">{t("appStoreTop")}</span>
            <b className="text-[1rem] tracking-[-0.01em]">{t("appStore")}</b>
          </span>
        </Action>
      ) : null}
      {android || (mode === "preview" && content.android.trim()) ? (
        <Action
          mode={mode}
          href={android}
          className="flex min-h-12 items-center gap-2.5 rounded-xl bg-inverse px-4 py-1 text-inverse-foreground"
        >
          <PlayIcon aria-hidden className="size-5" />
          <span className="flex flex-col leading-[1.1]">
            <span className="text-[0.625rem] opacity-80">{t("playTop")}</span>
            <b className="text-[1rem] tracking-[-0.01em]">{t("play")}</b>
          </span>
        </Action>
      ) : null}
      {mode === "preview" && !content.ios.trim() && !content.android.trim() ? (
        <>
          <Ph mode={mode} className="h-12 rounded-xl" />
          <Ph mode={mode} className="h-12 rounded-xl" />
        </>
      ) : null}
    </div>
  );
  const head = (
    <>
      {content.icon ? (
        <Img src={content.icon} alt="" className="size-19 shrink-0 rounded-[1.25rem] bg-subtle shadow-2" />
      ) : (
        <span
          aria-hidden
          className="grid size-19 shrink-0 place-items-center rounded-[1.25rem] bg-primary text-primary-foreground shadow-2"
        >
          <SmartphoneIcon className="size-8" />
        </span>
      )}
      {content.name.trim() ? (
        <h1 className={cn(title, desktop && "text-[1.625rem]")}>{content.name}</h1>
      ) : (
        <Ph mode={mode} className="h-5 w-1/2" />
      )}
      {content.desc.trim() ? <p className={cn(sub, "text-secondary-foreground")}>{content.desc}</p> : null}
    </>
  );
  if (desktop)
    return (
      <div className="grid items-center gap-6 p-4 md:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <div className="flex flex-col items-start gap-2 text-start">
          {head}
          {stores}
          <span className="text-caption text-muted-foreground">{t("desktopNote")}</span>
        </div>
        {desktopQr ? (
          <div className="flex flex-col items-center gap-2 rounded-2xl bg-subtle p-5 text-center">
            <div className="w-[9.375rem]">{desktopQr}</div>
            <b>{t("scanTitle")}</b>
            <span className="text-caption text-secondary-foreground">{t("scanText")}</span>
          </div>
        ) : null}
      </div>
    );
  return (
    <>
      <div className="mx-3.5 mt-2 flex flex-col items-center gap-2 text-center">{head}</div>
      {stores}
      <p className="mx-3.5 text-[0.75rem] leading-[1.45] text-muted-foreground">{t("phoneNote")}</p>
    </>
  );
}

/* ── PDF document (11.10–11.13) ──────────────────────────────────────────────────────────────────────────────── */

function PdfPage({ content, mode, pdfWaiting }: HostedPageProps & { content: PdfContent }) {
  const t = useTranslations("hosted.pdf");
  const file = content.file;
  const meta = file
    ? file.pages
      ? t("meta", { pages: file.pages, size: formatFileSize(file.bytes) })
      : t("metaNoPages", { size: formatFileSize(file.bytes) })
    : "";
  const href = file ? (file.asset.startsWith("asset:") ? hostedImageSrc(file.asset) : file.asset) : null;
  return (
    <>
      <div className="mx-3.5 mt-2 flex flex-col items-center gap-2 text-center">
        <span aria-hidden className="relative flex h-34 w-26 flex-col gap-1.5 rounded-md bg-surface px-3.5 py-5.5 shadow-2">
          <i className="block h-2 w-3/4 rounded-full bg-border-strong" />
          <i className="block h-1.5 rounded-full bg-border" />
          <i className="block h-1.5 rounded-full bg-border" />
          <i className="block h-1.5 w-2/3 rounded-full bg-border" />
          <em className="absolute -start-2 bottom-4 rounded-[0.3125rem] bg-danger px-1.5 py-0.5 text-[0.625rem] font-extrabold text-inverse-foreground not-italic">
            PDF
          </em>
        </span>
        {content.title.trim() ? <h1 className={title}>{content.title}</h1> : <Ph mode={mode} className="h-5 w-3/5" />}
        {meta ? <span className="text-caption text-secondary-foreground">{meta}</span> : null}
        {content.desc.trim() ? <p className={cn(sub, "text-secondary-foreground")}>{content.desc}</p> : null}
      </div>
      {file && !pdfWaiting ? (
        <div className={cn(pad, "flex flex-col gap-2")}>
          <Action mode={mode} href={href} className={primaryBtn}>
            <FileTextIcon aria-hidden className="size-4" />
            {t("open")}
          </Action>
          <Action mode={mode} href={href ? `${href}${href.includes("?") ? "&" : "?"}download=1` : null} download className={secondaryBtn}>
            <DownloadIcon aria-hidden className="size-4" />
            {t("download")}
          </Action>
        </div>
      ) : (
        <p className="mx-3.5 text-center text-[0.75rem] leading-[1.45] text-muted-foreground">
          {pdfWaiting ? t("waiting") : t("notReady")}
        </p>
      )}
    </>
  );
}

/* ── Product (11.14) ─────────────────────────────────────────────────────────────────────────────────────────── */

function ProductPage({ content, mode }: HostedPageProps & { content: ProductContent }) {
  const t = useTranslations("hosted.product");
  const tCta = useTranslations("editor.hosted.product.ctas");
  const locale = useLocale();
  const price = formatHostedPrice(content.price, content.currency, locale);
  const href = content.link.trim() ? hostedHref(content.link) : null;
  const host = href ? new URL(href).hostname.replace(/^www\./, "") : "";
  const images = content.images.map(hostedImageSrc);
  return (
    <>
      <div className={pad}>
        <ProductGallery
          images={images}
          name={content.name}
          labels={{
            region: t("photos"),
            prev: t("prev"),
            next: t("next"),
            photos: images.map((_, i) => t("photo", { n: i + 1, count: images.length })),
          }}
        />
      </div>
      <div className="mx-3.5 flex flex-col items-start gap-1.5">
        {content.name.trim() ? <h1 className={title}>{content.name}</h1> : <Ph mode={mode} className="h-5 w-2/3" />}
        {price ? <span className="text-[1.125rem] font-extrabold tracking-[-0.01em]">{price}</span> : null}
        {content.desc.trim() ? <p className={cn(sub, "whitespace-pre-line text-secondary-foreground")}>{content.desc}</p> : null}
      </div>
      <Action mode={mode} href={href} className={cn(pad, primaryBtn)}>
        {tCta(content.cta)}
        <ExternalLinkIcon aria-hidden className="size-4" />
      </Action>
      {host ? <p className="mx-3.5 text-center text-[0.75rem] text-muted-foreground">{t("opens", { host })}</p> : null}
    </>
  );
}
