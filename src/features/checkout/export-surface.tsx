"use client";

import { composeLayout, layoutGeometry, PNG_DEFAULTS, PNG_DPIS, PNG_MAX_SIDE, PNG_SCALES, pngPixelSize, type Layout } from "@heyqr/qr-core";
import {
  ArrowLeftIcon,
  CheckCircle2Icon,
  CircleAlertIcon,
  DownloadIcon,
  InfoIcon,
  LoaderCircleIcon,
  LockIcon,
  RotateCwIcon,
} from "lucide-react";
import { useFormatter, useLocale, useTranslations } from "next-intl";
import { useEffect, useRef, useState, useTransition, type ReactNode } from "react";
import { toast } from "sonner";
import { QrPreview } from "@/entities/qr";
import { Link, useRouter } from "@/i18n/navigation";
import { startCheckout } from "@/server/actions/qr";
import { cn } from "@/shared/lib/utils";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import { Segmented } from "@/shared/ui/segmented";
import { Stage, StageBar, StageCanvas, StageFoot } from "@/shared/ui/stage";
import { UseTrialButton } from "./trial-actions";

export type ExportFormat = "png" | "svg";
export type ExportSettings = { format: ExportFormat; resolution: number; transparent: boolean };

/** The resolutions the export allows for this layout: px layouts by scale, print layouts by DPI (HEY-37). */
export function resolutionChoices(layout: Layout): number[] {
  const print = layout.unit === "mm";
  return (print ? PNG_DPIS : PNG_SCALES).filter((v) => pngPixelSize(layout, print ? { dpi: v } : { scale: v }).ok) as number[];
}
export function defaultResolution(layout: Layout, wanted?: number): number {
  const choices = resolutionChoices(layout);
  const fallback = layout.unit === "mm" ? PNG_DEFAULTS.dpi : PNG_DEFAULTS.scale;
  if (wanted !== undefined && choices.includes(wanted)) return wanted;
  return choices.includes(fallback) ? fallback : (choices[0] ?? fallback);
}
/** The only download URL: /api/export checks the entitlement and renders from the saved layout. */
export function exportFileUrl(layoutId: string, layout: Layout, s: ExportSettings): string {
  const q = new URLSearchParams({ format: s.format });
  if (s.format === "png") q.set(layout.unit === "mm" ? "dpi" : "scale", String(s.resolution));
  if (s.transparent) q.set("transparent", "1");
  return `/api/export/${layoutId}?${q.toString()}`;
}
/** The query that carries export settings across sign-in and checkout, so the same file is offered on return. */
export function settingsQuery(s: ExportSettings): string {
  const q = new URLSearchParams({ format: s.format, res: String(s.resolution) });
  if (s.transparent) q.set("transparent", "1");
  return q.toString();
}

/** File name from Content-Disposition: the UTF-8 name (filename*) when sent, else the ASCII one. */
export function fileNameFrom(header: string | null, fallback: string): string {
  const star = header?.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
  if (star) {
    try {
      return decodeURIComponent(star);
    } catch {
      /* fall through */
    }
  }
  return header?.match(/filename="([^"]+)"/i)?.[1] ?? fallback;
}

type FileState =
  | { kind: "idle" }
  | { kind: "preparing" }
  | { kind: "ready"; url: string; name: string }
  | { kind: "downloaded"; url: string; name: string }
  | { kind: "error"; reason: "failed" | "scan" | "size" | "payment" };

export type ExportSurfaceProps = {
  title: string;
  /** "Name · Layout" for the stage bar. */
  heading: string;
  layout: Layout;
  value: string;
  model: "static" | "dynamic";
  typeLabel: string;
  layoutName: string;
  /** Other named layouts of this code (design 3.11), each linking to its own export screen. */
  layouts?: { id: string; name: string; href: string; active: boolean }[];
  backHref: string;
  initial: { format?: ExportFormat; resolution?: number; transparent?: boolean };
  price: { cents: number; currency: string };
  /** Banners from the URL: back from Google sign-in, back from checkout. */
  returnedFromSignIn?: boolean;
  checkout?: "success" | "cancelled";
  receipt?: { amountCents: number; currency: string; paidAt: string } | null;
} & (
  | {
      mode: "signed";
      qrCodeId: string;
      layoutId: string;
      entitled: boolean;
      /** Design 9.1: this Dynamic code can use the trial's free test slot now (server-decided). */
      canUseTrial?: boolean;
    }
  | { mode: "guest"; signInHref: (settings: ExportSettings) => string }
);

/*
 * Design 3.1–3.11 "Export": one surface for guests and signed-in users. The stage shows the exact layout that will be
 * downloaded (transparent background on a checkerboard when chosen), its layout and file dimensions and its scan check.
 * The side panel: banners, receipt, format, PNG size, transparency, the order summary and one action.
 *   guest            the total, then "Continue with Google"; settings travel through sign-in (3.1–3.3)
 *   not entitled     pay through Stripe Checkout; settings travel through checkout (3.4, 3.5)
 *   confirming       back from checkout before the webhook: controls frozen, the page re-checks (3.6)
 *   entitled         Download → "Preparing your PNG…" → downloaded with the real file name → Download again (3.7–3.9)
 *   error            the same settings, Try again; payment is never repeated (3.10)
 * The server stays authoritative: /api/export checks the purchase or plan and renders the file.
 */
export function ExportSurface(props: ExportSurfaceProps) {
  const t = useTranslations("export");
  const tTrial = useTranslations("trial");
  const format = useFormatter();
  const locale = useLocale();
  const router = useRouter();
  const { layout, value } = props;
  const print = layout.unit === "mm";
  const [settings, setSettings] = useState<ExportSettings>(() => ({
    format: props.initial.format ?? "png",
    resolution: defaultResolution(layout, props.initial.resolution),
    transparent: props.initial.transparent === true,
  }));
  const [file, setFile] = useState<FileState>({ kind: "idle" });
  const [paying, startPaying] = useTransition();
  const entitled = props.mode === "signed" && props.entitled;
  const confirming = props.mode === "signed" && props.checkout === "success" && !props.entitled;
  const busy = file.kind === "preparing" || paying || confirming;
  const frozen = busy;
  const scan = composeLayout(layout, value, { transparent: settings.transparent }).scan;
  const choices = resolutionChoices(layout);
  const pixels = pngPixelSize(layout, print ? { dpi: settings.resolution } : { scale: settings.resolution });
  const g = layoutGeometry(layout);
  const n = (v: number) => (print ? Math.round(v * 10) / 10 : Math.round(v));
  const layoutDims = `${n(g.width)} × ${n(g.height)} ${layout.unit}`;
  const fileDims =
    settings.format === "png" ? `${pixels.width} × ${pixels.height} px` : print ? `${layoutDims} · vector` : `${layoutDims} · vector`;
  const fmt = settings.format.toUpperCase();
  const amount = format.number(props.price.cents / 100, { style: "currency", currency: props.price.currency });
  const readyUrl = useRef<string | null>(null);

  // Back from checkout before Stripe's webhook has granted the file: ask the server again, a few seconds apart.
  useEffect(() => {
    if (!confirming) return;
    const id = window.setInterval(() => router.refresh(), 2500);
    return () => window.clearInterval(id);
  }, [confirming, router]);

  useEffect(
    () => () => {
      if (readyUrl.current) URL.revokeObjectURL(readyUrl.current);
    },
    [],
  );

  /*
   * Prepares the file with the current settings. The download itself is always the user's own click on a link to the
   * prepared file (design 3.8 "File ready"): a download started by script after the request finished is an "automatic
   * download" to the browser, and a second one is blocked behind a permission prompt.
   */
  const prepare = async () => {
    if (props.mode !== "signed") return;
    setFile({ kind: "preparing" });
    try {
      const res = await fetch(exportFileUrl(props.layoutId, layout, settings), { credentials: "same-origin" });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setFile({
          kind: "error",
          reason:
            res.status === 402 ? "payment" : body.error === "scan_check_failed" ? "scan" : body.error === "too_large" ? "size" : "failed",
        });
        return;
      }
      const name = fileNameFrom(res.headers.get("Content-Disposition"), `qr-code.${settings.format}`);
      const url = URL.createObjectURL(await res.blob());
      if (readyUrl.current) URL.revokeObjectURL(readyUrl.current);
      readyUrl.current = url;
      setFile({ kind: "ready", url, name });
    } catch {
      setFile({ kind: "error", reason: "failed" });
    }
  };

  // Back from a paid checkout with the file granted: prepare the chosen file at once; one tap downloads it (3.7, 3.8).
  const autoPrepared = useRef(false);
  useEffect(() => {
    if (autoPrepared.current || !entitled || props.checkout !== "success") return;
    autoPrepared.current = true;
    void prepare();
    // Runs once, when the entitlement arrives.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entitled, props.checkout]);

  const pay = () =>
    props.mode === "signed" &&
    startPaying(async () => {
      const result = await startCheckout({
        qrCodeId: props.qrCodeId,
        layoutId: props.layoutId,
        format: settings.format,
        locale,
        resolution: settings.format === "png" ? settings.resolution : undefined,
        transparent: settings.transparent,
      }).catch(() => ({ ok: false as const, error: "failed" }));
      if (result.ok) window.location.assign(result.data.url);
      else toast.error(t("checkoutFailed"), { id: "checkout" });
    });

  const update = (patch: Partial<ExportSettings>) => {
    setSettings((s) => ({ ...s, ...patch }));
    // A new setting is a different file: the prepared one no longer matches.
    if (file.kind !== "idle" && file.kind !== "preparing") setFile({ kind: "idle" });
  };

  const action = (() => {
    if (props.mode === "guest")
      return (
        <Button asChild variant="primary" size="lg" className="w-full">
          <Link href={props.signInHref(settings)}>
            <GoogleMark />
            {t("continueGoogle")}
          </Link>
        </Button>
      );
    if (confirming)
      return (
        <Button variant="primary" size="lg" className="w-full" disabled aria-busy>
          <LoaderCircleIcon aria-hidden className="animate-spin motion-reduce:animate-none" />
          {t("confirming")}
        </Button>
      );
    if (!entitled && props.mode === "signed" && props.canUseTrial)
      return (
        <div className="flex flex-col gap-2">
          <UseTrialButton qrCodeId={props.qrCodeId} className="w-full" />
          <span className="text-center text-caption text-muted-foreground">{tTrial("useTrialHint")}</span>
          <Button variant="secondary" size="md" className="w-full" disabled={paying} aria-busy={paying || undefined} onClick={pay}>
            {t("subscribe", { price: amount })}
          </Button>
        </div>
      );
    if (!entitled)
      return (
        <Button variant="primary" size="lg" className="w-full" disabled={paying} aria-busy={paying || undefined} onClick={pay}>
          {paying ? <LoaderCircleIcon aria-hidden className="animate-spin" /> : <LockIcon aria-hidden />}
          {props.model === "dynamic" ? t("subscribe", { price: amount }) : t("pay", { price: amount })}
        </Button>
      );
    if (file.kind === "preparing")
      return (
        <Button variant="primary" size="lg" className="w-full" disabled aria-busy>
          <LoaderCircleIcon aria-hidden className="animate-spin motion-reduce:animate-none" />
          {t("preparing", { format: fmt })}
        </Button>
      );
    if (file.kind === "ready")
      return (
        <Button asChild variant="primary" size="lg" className="w-full">
          <a href={file.url} download={file.name} onClick={() => setFile({ kind: "downloaded", url: file.url, name: file.name })}>
            <DownloadIcon aria-hidden />
            {t("download", { format: fmt })}
          </a>
        </Button>
      );
    if (file.kind === "error")
      return (
        <Button variant="primary" size="lg" className="w-full" onClick={() => void prepare()}>
          <RotateCwIcon aria-hidden />
          {t("tryAgain")}
        </Button>
      );
    if (file.kind === "downloaded")
      // The same prepared file again (repeat downloads are free; nothing is asked of the server).
      return (
        <Button asChild variant="secondary" size="lg" className="w-full">
          <a href={file.url} download={file.name}>
            <DownloadIcon aria-hidden />
            {t("downloadAgain")}
          </a>
        </Button>
      );
    return (
      <Button variant="primary" size="lg" className="w-full" onClick={() => void prepare()}>
        <DownloadIcon aria-hidden />
        {t("download", { format: fmt })}
      </Button>
    );
  })();

  return (
    <main className="mx-auto w-full max-w-wide px-4 pt-4 pb-10 sm:px-6 lg:px-8">
      <div className="mb-3">
        <Button asChild variant="ghost" size="sm">
          <Link href={props.backHref}>
            <ArrowLeftIcon aria-hidden />
            {t("backToDesign")}
          </Link>
        </Button>
      </div>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_26rem] lg:items-start xl:grid-cols-[minmax(0,1fr)_28rem]">
        <section aria-label={t("stageLabel")} className="lg:sticky lg:top-[calc(var(--spacing-header)+1rem)]">
          <Stage tone={settings.transparent ? "checker" : "light"} className="rounded-xl">
            <StageBar>
              <span className="min-w-0 grow truncate px-1 text-label" title={props.heading}>
                {props.heading}
              </span>
              <Badge variant={props.model === "dynamic" ? "accent" : "neutral"}>{t(`model.${props.model}`)}</Badge>
            </StageBar>
            {props.layouts && props.layouts.length > 1 ? (
              <nav
                aria-label={t("layouts")}
                className="flex [scrollbar-width:none] gap-1 overflow-x-auto border-b border-border bg-surface/88 px-2 py-1.5"
              >
                {props.layouts.map((l) => (
                  <Link
                    key={l.id}
                    href={l.href}
                    aria-current={l.active ? "page" : undefined}
                    className="inline-flex min-h-9 max-w-45 flex-none items-center truncate rounded-full border border-border bg-surface px-3 text-[0.8125rem] font-semibold text-secondary-foreground aria-[current=page]:border-violet-300 aria-[current=page]:bg-violet-50 aria-[current=page]:text-violet-800"
                  >
                    {l.name}
                  </Link>
                ))}
              </nav>
            ) : null}
            <div className="relative">
              <StageCanvas height="clamp(16rem, 52vw, 34rem)">
                <QrPreview layout={layout} value={value} label={props.heading} transparent={settings.transparent} className="size-full" />
              </StageCanvas>
              {file.kind === "preparing" || confirming ? (
                <span
                  role="status"
                  className="absolute top-3 left-1/2 inline-flex -translate-x-1/2 items-center gap-2 rounded-full bg-inverse py-1.5 pr-3 pl-2.5 text-[0.8125rem] font-semibold text-inverse-foreground shadow-2"
                >
                  <LoaderCircleIcon aria-hidden className="size-4 animate-spin motion-reduce:animate-none" />
                  {confirming ? t("confirming") : t("preparing", { format: fmt })}
                </span>
              ) : null}
            </div>
            <StageFoot>
              <div className="flex flex-wrap gap-x-3.5 gap-y-1 text-[0.8125rem] text-secondary-foreground">
                <span>
                  {t("dims.layout")} <b className="font-semibold text-foreground tabular-nums">{layoutDims}</b>
                </span>
                <span>
                  {t("dims.file")} <b className="font-semibold text-foreground tabular-nums">{fileDims}</b>
                </span>
              </div>
              <Badge variant={scan.ok ? "success" : "warning"}>{scan.ok ? t("scanOk") : t("scanFail")}</Badge>
            </StageFoot>
          </Stage>
        </section>

        <aside
          aria-labelledby="export-title"
          className="flex flex-col gap-5 rounded-2xl border border-border bg-surface p-5 shadow-1 sm:p-6"
        >
          <header className="flex flex-col gap-1.5">
            <h1 id="export-title" className="text-h2">
              {props.title}
            </h1>
            <p className="text-secondary-foreground">
              {props.mode === "guest" ? t("subGuest") : entitled ? t("subEntitled") : t("subPay")}
            </p>
          </header>

          {props.returnedFromSignIn ? <Banner tone="info">{t.rich("returned", { format: fmt, b: (c) => <b>{c}</b> })}</Banner> : null}
          {props.checkout === "cancelled" && !entitled ? (
            <Banner tone="neutral">{t.rich("cancelled", { b: (c) => <b>{c}</b> })}</Banner>
          ) : null}
          {confirming ? <Banner tone="info">{t("pending")}</Banner> : null}
          {file.kind === "error" ? (
            <Banner tone="error">{t.rich(`errors.${file.reason}`, { format: fmt, b: (c) => <b>{c}</b> })}</Banner>
          ) : null}
          {file.kind === "downloaded" ? <Banner tone="ok">{t.rich("downloaded", { name: file.name, b: (c) => <b>{c}</b> })}</Banner> : null}
          {file.kind === "ready" ? <Banner tone="ok">{t("ready", { format: fmt })}</Banner> : null}

          {props.receipt ? (
            <section aria-label={t("receipt.title")} className="flex flex-col gap-2 rounded-lg border border-border p-4">
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-label">{t("receipt.title")}</span>
                <span className="text-caption text-muted-foreground">
                  {format.dateTime(new Date(props.receipt.paidAt), { dateStyle: "medium" })}
                </span>
              </div>
              <Line
                label={t("lines.single")}
                value={format.number(props.receipt.amountCents / 100, {
                  style: "currency",
                  currency: props.receipt.currency.toUpperCase(),
                })}
              />
              <Line
                strong
                label={t("receipt.paid")}
                value={format.number(props.receipt.amountCents / 100, {
                  style: "currency",
                  currency: props.receipt.currency.toUpperCase(),
                })}
              />
              <span className="text-caption text-muted-foreground">{t("receipt.tax")}</span>
            </section>
          ) : null}

          <fieldset disabled={frozen} className="flex flex-col gap-2">
            <legend className="mb-2 text-[0.875rem] font-bold">{t("format")}</legend>
            <div className="grid grid-cols-2 gap-2">
              {(["png", "svg"] as const).map((f) => (
                <button
                  key={f}
                  type="button"
                  aria-pressed={settings.format === f}
                  aria-label={t(f)}
                  aria-describedby={`format-${f}-hint`}
                  onClick={() => update({ format: f })}
                  className={cn(
                    "flex cursor-pointer flex-col items-start gap-0.5 rounded-lg border border-border bg-surface p-3.5 text-left disabled:cursor-not-allowed disabled:opacity-60",
                    "aria-pressed:border-selected-border aria-pressed:bg-selected aria-pressed:shadow-[0_0_0_1px_var(--color-selected-border)]",
                  )}
                >
                  <span className="text-h3">{t(f)}</span>
                  <span id={`format-${f}-hint`} className="text-caption text-secondary-foreground">
                    {t(`${f}Hint`)}
                  </span>
                </button>
              ))}
            </div>
          </fieldset>

          {settings.format === "png" ? (
            <div className="flex flex-col gap-2">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span id="png-size" className="text-[0.875rem] font-bold">
                  {t("resolution")}
                </span>
                <span className="text-caption text-muted-foreground tabular-nums">
                  {t("pixels", { width: pixels.width, height: pixels.height })}
                  {choices.length < (print ? PNG_DPIS : PNG_SCALES).length ? ` · ${t("limit", { max: PNG_MAX_SIDE })}` : ""}
                </span>
              </div>
              <Segmented
                label={t("resolution")}
                value={String(settings.resolution)}
                options={choices.map((v) => ({ value: String(v), label: print ? t("dpi", { dpi: v }) : t("scale", { scale: v }) }))}
                onChange={(v) => !frozen && update({ resolution: Number(v) })}
              />
            </div>
          ) : null}

          <label className="flex min-h-11 cursor-pointer items-center gap-2.5 text-body has-disabled:cursor-not-allowed has-disabled:opacity-60">
            <input
              type="checkbox"
              className="size-5 accent-primary"
              checked={settings.transparent}
              disabled={frozen}
              onChange={(e) => update({ transparent: e.target.checked })}
            />
            {t("transparent")}
          </label>

          <Banner tone="neutral" icon={<InfoIcon aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground" />}>
            {t.rich("quality", { b: (c) => <b>{c}</b> })}
          </Banner>

          <section aria-label={t("summary.title")} className="flex flex-col gap-2 border-t border-border pt-4">
            <Line label={t("summary.code")} value={props.heading.split(" · ")[0] ?? props.heading} />
            <Line label={t("summary.type")} value={`${props.typeLabel} · ${t(`model.${props.model}`)}`} />
            <Line label={t("summary.layout")} value={`${props.layoutName} · ${layoutDims}`} />
            <Line label={t("summary.file")} value={`${fmt} · ${fileDims}`} />
            {!entitled ? (
              <>
                <Line
                  label={props.model === "dynamic" ? t("lines.dynamic") : t("lines.single")}
                  value={props.model === "dynamic" ? t("perMonth", { price: amount }) : amount}
                />
                <Line strong label={t("summary.total")} value={props.model === "dynamic" ? t("perMonth", { price: amount }) : amount} />
                <span className="text-caption text-muted-foreground">{t("summary.tax")}</span>
              </>
            ) : props.receipt ? null : (
              <Line strong label={t("summary.total")} value={t("summary.included")} />
            )}
          </section>

          {action}
          <p className="text-center text-caption text-muted-foreground">{props.mode === "guest" ? t("guestNote") : t("secure")}</p>
        </aside>
      </div>
    </main>
  );
}

function Line({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={cn("flex items-baseline justify-between gap-4 text-[0.875rem]", strong ? "font-bold" : "text-secondary-foreground")}>
      <span className="shrink-0">{label}</span>
      <span className={cn("min-w-0 truncate text-right tabular-nums", !strong && "text-foreground")}>{value}</span>
    </div>
  );
}

function Banner({ tone, icon, children }: { tone: "info" | "neutral" | "error" | "ok"; icon?: ReactNode; children: ReactNode }) {
  const Icon = tone === "error" ? CircleAlertIcon : tone === "ok" ? CheckCircle2Icon : InfoIcon;
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={cn(
        "flex items-start gap-2.5 rounded-md px-3.5 py-3 text-[0.875rem] leading-[1.45]",
        tone === "error" && "bg-danger-soft text-danger",
        tone === "ok" && "bg-success-soft text-success",
        tone === "info" && "bg-info-soft text-info",
        tone === "neutral" && "bg-subtle text-secondary-foreground",
      )}
    >
      {icon ?? <Icon aria-hidden className="mt-0.5 size-4 shrink-0" />}
      <span>{children}</span>
    </div>
  );
}

function GoogleMark() {
  return (
    <svg aria-hidden viewBox="0 0 24 24" className="size-5">
      <path fill="#4285F4" d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.4h6.5a5.6 5.6 0 0 1-2.4 3.6v3h3.9c2.2-2.1 3.5-5.1 3.5-8.7z" />
      <path fill="#34A853" d="M12 24c3.2 0 6-1.1 8-2.9l-3.9-3c-1.1.7-2.5 1.2-4.1 1.2-3.1 0-5.8-2.1-6.7-5H1.3v3.1A12 12 0 0 0 12 24z" />
      <path fill="#FBBC05" d="M5.3 14.3a7.2 7.2 0 0 1 0-4.6V6.6h-4a12 12 0 0 0 0 10.8l4-3.1z" />
      <path fill="#EA4335" d="M12 4.8c1.8 0 3.3.6 4.6 1.8l3.4-3.4A12 12 0 0 0 1.3 6.6l4 3.1c.9-2.9 3.6-4.9 6.7-4.9z" />
    </svg>
  );
}
