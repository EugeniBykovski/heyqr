"use client";

import { composeLayout, layoutGeometry, PNG_DEFAULTS, PNG_DPIS, PNG_MAX_SIDE, PNG_SCALES, pngPixelSize, type Layout } from "@heyqr/qr-core";
import {
  ArrowLeftIcon,
  CheckCircle2Icon,
  CheckIcon,
  CircleAlertIcon,
  DownloadIcon,
  FileTextIcon,
  InfoIcon,
  LoaderCircleIcon,
  LockIcon,
  PrinterIcon,
  RotateCwIcon,
  ShieldIcon,
  TriangleAlertIcon,
} from "lucide-react";
import { useFormatter, useLocale, useTranslations } from "next-intl";
import { useEffect, useRef, useState, useTransition, type ReactNode } from "react";
import { toast } from "sonner";
import { QrPreview } from "@/entities/qr";
import { Link, useRouter } from "@/i18n/navigation";
import { PaymentInfo } from "./payment-info";
import { activateDynamic, makeStatic, takeIncludedPrintPack, unlockWithAllowance } from "@/server/actions/billing";
import { startCheckout, startPrintPackCheckout } from "@/server/actions/qr";
import { cn } from "@/shared/lib/utils";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import { Segmented } from "@/shared/ui/segmented";
import { Stage, StageBar, StageCanvas, StageFoot } from "@/shared/ui/stage";
import { UseTrialButton } from "./trial-actions";
import { formatMoney, type Currency } from "@/shared/config/catalog-core";

export type ExportFormat = "png" | "svg" | "pdf";
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
export function exportFileUrl(layoutId: string, layout: Layout, s: ExportSettings, qrCodeId?: string): string {
  // HEY-102: with the code's id the server also checks the pair (a layout of another code is refused).
  const q = new URLSearchParams({ ...(qrCodeId ? { qr: qrCodeId } : {}), format: s.format });
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
  /** HEY-118: a Dynamic code before activation. The art shows the preview short link, marked as a preview. */
  shortLinkPreview?: boolean;
  typeLabel: string;
  /** HEY-182: a hosted page (menu, coupon…) lives at its short link, so it can't become a static code. */
  hosted?: boolean;
  layoutName: string;
  /** Other named layouts of this code (design 3.11), each linking to its own export screen. */
  layouts?: { id: string; name: string; href: string; active: boolean }[];
  backHref: string;
  /** HEY-109: the confirmed support contact for the payment explanation; null until configured. */
  support?: string | null;
  initial: { format?: ExportFormat; resolution?: number; transparent?: boolean; printPack?: boolean };
  price: { cents: number; currency: Currency };
  /** Banners from the URL: back from Google sign-in, back from checkout. */
  returnedFromSignIn?: boolean;
  checkout?: "success" | "cancelled";
  receipt?: { amountCents: number; currency: string; paidAt: string; lines?: { offer: string; amount: number }[] | null } | null;
  /** Signed in: the account's path for this code (design 7.2–7.7). */
  offer?: ExportOffer;
  /** Design 7.2 / 8.1: Print Preview of a print (mm) layout, or setting a screen layout up for print (Edit design → Size). */
  print?: { kind: "preview" | "setup"; href: string };
} & (
  | {
      mode: "signed";
      qrCodeId: string;
      layoutId: string;
      entitled: boolean;
      /** Design 9.1: this Dynamic code can use the trial's free test slot now (server-decided). */
      canUseTrial?: boolean;
    }
  | {
      mode: "guest";
      /**
       * HEY-76: the guest's one action, Continue with Google, built for the current settings so Google sign-in returns
       * to Export with them (and a cancel comes back here with them too).
       */
      signInAction: (settings: ExportSettings) => ReactNode;
      /** Back here from Google without signing in: canceled, or the sign-in didn't finish. */
      signInNotice?: "canceled" | "incomplete";
    }
);

/**
 * Design 7.2–7.7: what this export costs, decided on the server from the account's plan, credits and slots. The
 * panel shows its lines and action; the server checks again when the action runs.
 */
export type ExportOffer = {
  path: "owned" | "buy" | "subscribe" | "activate" | "unlock" | "credit" | "limitStatic" | "limitDyn";
  planName?: string;
  unlocks?: { left: number; limit: number };
  credits?: number;
  dynamic?: { used: number; limit: number };
  resets?: string;
  cents: { single: number | null; pack3: number | null; studio: number | null };
  /**
   * HEY-60: whether Single QR and Starter can be bought in this currency (a price point and its Stripe Price). An offer
   * without one is shown as unavailable instead of a payment that the server would refuse. Absent: for sale.
   */
  forSale?: { single: boolean; starter: boolean };
  printPack: null | {
    owned: boolean;
    included: { left: number; limit: number } | null;
    cents: number | null;
    forSale: boolean;
    previewHref: string;
    files: { file: string; label: string; meta: string; href: string }[];
  };
};

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
  const tPlans = useTranslations("plans");
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
  // HEY-76 / HEY-78: the file choices live in the address (next to the code and layout), so Back from Google, a refresh,
  // a canceled sign-in or signing in again after the session ended reopens this screen with the same format, PNG size
  // and transparency.
  useEffect(() => {
    const url = new URL(window.location.href);
    const chosen = new URLSearchParams(settingsQuery(settings));
    for (const k of ["format", "res", "transparent"]) {
      const v = chosen.get(k);
      if (v) url.searchParams.set(k, v);
      else url.searchParams.delete(k);
    }
    const next = `${url.pathname}?${url.searchParams.toString()}`;
    if (next !== `${window.location.pathname}${window.location.search}`) window.history.replaceState(window.history.state, "", next);
  }, [settings]);

  /**
   * HEY-78: the session ended while this screen was open. Nothing is retried blindly: the screen says so and offers
   * Google sign-in, which returns here with the same code, layout and file choices.
   */
  const [sessionEnded, setSessionEnded] = useState(false);
  const ended = (result: { ok: boolean; error?: string }) => {
    if (result.ok || result.error !== "unauthorized") return false;
    setSessionEnded(true);
    return true;
  };
  const signInAgainHref = () => {
    const prefix = `/${locale}`;
    const path = window.location.pathname.startsWith(`${prefix}/`)
      ? window.location.pathname.slice(prefix.length)
      : window.location.pathname;
    return `/sign-in?next=${encodeURIComponent(`${path}${window.location.search}`)}`;
  };
  const [file, setFile] = useState<FileState>({ kind: "idle" });
  const [paying, startPaying] = useTransition();
  const offer = props.offer;
  const pp = offer?.printPack ?? null;
  // Design 7.2 Print Pack switch: off by default; on when coming back from checkout with it.
  const [addPrint, setAddPrint] = useState(Boolean(props.initial.printPack) && Boolean(pp && !pp.owned));
  const ppIncluded = Boolean(pp?.included && pp.included.left > 0);
  const ppOn = addPrint && Boolean(pp && !pp.owned) && (ppIncluded || Boolean(pp?.forSale));
  const cur = props.price.currency;
  const money = (c: number | null) => formatMoney(c, cur);
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
  const amount = formatMoney(props.price.cents, props.price.currency);
  // Design 7.3: the itemized order of this path (display only; the server prices the checkout itself).
  const orderLines: { label: string; value: string; included?: boolean; cents?: number }[] = [];
  if (offer && !entitled) {
    if (offer.path === "buy")
      orderLines.push({
        label: t("lines.singleNamed", { name: props.heading.split(" · ")[0] ?? "" }),
        value: money(offer.cents.single),
        cents: offer.cents.single ?? 0,
      });
    if (offer.path === "unlock")
      orderLines.push({
        label: t("lines.unlock", { plan: offer.planName ?? "", left: offer.unlocks?.left ?? 0, limit: offer.unlocks?.limit ?? 0 }),
        value: t("summary.includedShort"),
        included: true,
      });
    if (offer.path === "credit")
      orderLines.push({ label: t("lines.credit", { left: offer.credits ?? 0 }), value: t("summary.includedShort"), included: true });
    if (offer.path === "activate")
      orderLines.push({
        label: t("lines.slot", { plan: offer.planName ?? "", used: offer.dynamic?.used ?? 0, limit: offer.dynamic?.limit ?? 0 }),
        value: t("summary.includedShort"),
        included: true,
      });
    if (offer.path === "subscribe") orderLines.push({ label: t("lines.starter"), value: t("perMonth", { price: amount }) });
    if (ppOn && pp && offer.path !== "limitStatic" && offer.path !== "limitDyn")
      orderLines.push(
        ppIncluded && pp.included
          ? {
              label: t("lines.ppIncluded", { plan: offer.planName ?? "", left: pp.included.left, limit: pp.included.limit }),
              value: t("summary.includedShort"),
              included: true,
            }
          : { label: t("lines.pp"), value: money(pp.cents), cents: pp.cents ?? 0 },
      );
  }
  // Guests (and codes without a server offer) see the code's own price.
  if (!offer && !entitled && props.model === "static")
    orderLines.push({
      label: t("lines.singleNamed", { name: props.heading.split(" · ")[0] ?? "" }),
      value: amount,
      cents: props.price.cents,
    });
  if (!offer && !entitled && props.model === "dynamic")
    orderLines.push({ label: t("lines.starter"), value: t("perMonth", { price: amount }) });
  const totalCents = orderLines.reduce((sum, l) => sum + (l.cents ?? 0), 0);

  // Back from checkout before Stripe's webhook has granted the file: ask the server again, a few seconds apart.
  useEffect(() => {
    if (!confirming) return;
    const id = window.setInterval(() => router.refresh(), 2500);
    return () => window.clearInterval(id);
  }, [confirming, router]);

  /*
   * Prepares the file with the current settings. The download itself is always the user's own click on a link to the
   * prepared file (design 3.8 "File ready"): a download started by script after the request finished is an "automatic
   * download" to the browser, and a second one is blocked behind a permission prompt.
   */
  const prepare = async () => {
    if (props.mode !== "signed") return;
    setFile({ kind: "preparing" });
    try {
      // HEY-102: the server checks access and makes sure the file is stored (no bytes here). The download is then the
      // user's click on the file route itself, which rechecks access and hands over a fresh short-lived signed link.
      const href = exportFileUrl(props.layoutId, layout, settings, props.qrCodeId);
      const res = await fetch(`${href}&prepare=1`, { credentials: "same-origin" });
      if (res.status === 401) {
        setSessionEnded(true);
        setFile({ kind: "idle" });
        return;
      }
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setFile({
          kind: "error",
          reason:
            res.status === 402 ? "payment" : body.error === "scan_check_failed" ? "scan" : body.error === "too_large" ? "size" : "failed",
        });
        return;
      }
      const type = res.headers.get("Content-Type") ?? "";
      // Without private storage (local dev) the route answers with the file itself, as before.
      const name = type.includes("application/json")
        ? (((await res.json().catch(() => ({}))) as { name?: string }).name ?? `qr-code.${settings.format}`)
        : fileNameFrom(res.headers.get("Content-Disposition"), `qr-code.${settings.format}`);
      setFile({ kind: "ready", url: href, name });
    } catch {
      setFile({ kind: "error", reason: "failed" });
    }
  };

  // Back from a paid checkout with the file granted: prepare the chosen file at once; one tap downloads it (3.7, 3.8).
  const autoPrepared = useRef(false);
  // After an included unlock the page refreshes with the entitlement; the download starts as after checkout.
  const wantDownload = useRef(false);
  useEffect(() => {
    if (!wantDownload.current || !entitled) return;
    wantDownload.current = false;
    void prepare();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entitled]);
  useEffect(() => {
    if (autoPrepared.current || !entitled || props.checkout !== "success") return;
    autoPrepared.current = true;
    void prepare();
    // Runs once, when the entitlement arrives.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entitled, props.checkout]);

  // The paid path's own offer: Starter for a Dynamic code, Single QR for a static one.
  const payForSale = !offer?.forSale || (props.model === "dynamic" ? offer.forSale.starter : offer.forSale.single);
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
        // An included Print Pack is used from the plan, not paid at checkout.
        printPack: ppOn && !ppIncluded,
      }).catch(() => ({ ok: false as const, error: "failed" }));
      if (result.ok) window.location.assign(result.data.url);
      else if (result.error === "processing") {
        // HEY-88: this code's checkout was already paid in another tab; no second charge, the unlock follows.
        toast.info(t("paymentProcessing"), { id: "checkout" });
        router.refresh();
      } else if (result.error === "owned") {
        // HEY-87: already unlocked elsewhere (another tab, a plan unlock): the screen turns into Download again.
        toast.success(t("alreadyOwned"), { id: "checkout" });
        router.refresh();
      } else if (!ended(result))
        toast.error(
          result.error === "not_offered" || result.error === "price_mismatch" ? t(`catalog.${result.error}`) : t("checkoutFailed"),
          { id: "checkout" },
        );
    });

  /** Design 7.5: an included unlock or a static credit (and an included Print Pack), then the download. */
  const unlockFree = (via: "plan" | "credit") =>
    props.mode === "signed" &&
    startPaying(async () => {
      const result = await unlockWithAllowance({ qrCodeId: props.qrCodeId, via }).catch(() => ({
        ok: false as const,
        error: "failed" as const,
      }));
      if (!result.ok) {
        if (ended(result)) return;
        toast.error(t(`unlockErrors.${result.error === "no_allowance" || result.error === "no_credits" ? result.error : "failed"}`), {
          id: "unlock",
        });
        return;
      }
      if (ppOn && ppIncluded) await takeIncludedPrintPack(props.qrCodeId).catch(() => null);
      autoPrepared.current = false;
      wantDownload.current = true;
      router.refresh();
    });

  const goLive = () =>
    props.mode === "signed" &&
    startPaying(async () => {
      const result = await activateDynamic(props.qrCodeId).catch(() => ({ ok: false as const, error: "failed" as const }));
      if (!result.ok) {
        if (ended(result)) return;
        toast.error(t(`unlockErrors.${result.error === "limit" ? "limit" : "failed"}`), { id: "unlock" });
        return;
      }
      wantDownload.current = true;
      router.refresh();
    });

  /** Design 8.6 / 7.4: the Print Pack of an owned code: from the plan's allowance, or its own checkout. */
  const addPrintPack = () =>
    props.mode === "signed" &&
    startPaying(async () => {
      if (ppIncluded) {
        const r = await takeIncludedPrintPack(props.qrCodeId).catch(() => ({ ok: false as const, error: "failed" as const }));
        if (r.ok) router.refresh();
        else if (!ended(r)) toast.error(t("unlockErrors.failed"), { id: "pp" });
        return;
      }
      const r = await startPrintPackCheckout({
        qrCodeId: props.qrCodeId,
        layoutId: props.layoutId,
        settings: "scale=1&bleed=3&cropMarks=1&profile=srgb",
        locale,
      }).catch(() => ({ ok: false as const, error: "failed" as const }));
      if (r.ok) window.location.assign(r.data.url);
      else if (r.error === "owned") {
        toast.success(t("alreadyOwned"), { id: "pp" });
        router.refresh();
      } else if (!ended(r)) toast.error(t("checkoutFailed"), { id: "pp" });
    });

  const toStatic = () =>
    props.mode === "signed" &&
    startPaying(async () => {
      const r = await makeStatic(props.qrCodeId).catch(() => ({ ok: false as const, error: "failed" as const }));
      if (r.ok) router.refresh();
      else if (!ended(r)) toast.error(t("unlockErrors.failed"), { id: "static" });
    });

  const update = (patch: Partial<ExportSettings>) => {
    setSettings((s) => ({ ...s, ...patch }));
    // A new setting is a different file: the prepared one no longer matches.
    if (file.kind !== "idle" && file.kind !== "preparing") setFile({ kind: "idle" });
  };

  const action = (() => {
    if (props.mode === "guest") return props.signInAction(settings);
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
          <Button
            variant="secondary"
            size="md"
            className="w-full"
            disabled={paying || !payForSale}
            aria-busy={paying || undefined}
            onClick={pay}
          >
            {t("subscribe", { price: amount })}
          </Button>
          {/* HEY-138: the plan's cancellation and failed-renewal rules, before the paid Checkout. */}
          <span data-slot="plan-terms" className="text-caption text-muted-foreground">
            {tPlans("terms")}
          </span>
          {payForSale ? null : <span className="text-caption text-muted-foreground">{t("catalog.unavailable")}</span>}
        </div>
      );
    if (!entitled && (offer?.path === "unlock" || offer?.path === "credit"))
      return (
        <div className="flex flex-col gap-2">
          <Button
            variant="primary"
            size="lg"
            className="w-full"
            disabled={paying}
            aria-busy={paying || undefined}
            onClick={() => unlockFree(offer.path === "unlock" ? "plan" : "credit")}
          >
            {paying ? <LoaderCircleIcon aria-hidden className="animate-spin" /> : null}
            {offer.path === "unlock" ? t("useUnlock") : t("useCredit")}
          </Button>
          <span className="text-caption text-muted-foreground">
            {offer.path === "unlock"
              ? t("unlockNote", { plan: offer.planName ?? "", left: Math.max(0, (offer.unlocks?.left ?? 1) - 1) })
              : t("creditNote", { left: Math.max(0, (offer.credits ?? 1) - 1) })}
          </span>
        </div>
      );
    if (!entitled && offer?.path === "activate")
      return (
        <div className="flex flex-col gap-2">
          <Button variant="primary" size="lg" className="w-full" disabled={paying} aria-busy={paying || undefined} onClick={goLive}>
            {paying ? <LoaderCircleIcon aria-hidden className="animate-spin" /> : null}
            {t("goLive")}
          </Button>
          <span className="text-caption text-muted-foreground">
            {t("goLiveNote", { plan: offer.planName ?? "", used: (offer.dynamic?.used ?? 0) + 1, limit: offer.dynamic?.limit ?? 0 })}
          </span>
        </div>
      );
    if (!entitled && (offer?.path === "limitStatic" || offer?.path === "limitDyn")) return null;
    if (!entitled)
      return (
        <div className="flex flex-col gap-2">
          <Button
            variant="primary"
            size="lg"
            className="w-full"
            disabled={paying || !payForSale}
            aria-busy={paying || undefined}
            onClick={pay}
          >
            {paying ? <LoaderCircleIcon aria-hidden className="animate-spin" /> : <LockIcon aria-hidden />}
            {props.model === "dynamic" ? t("subscribe", { price: amount }) : t("payTotal", { price: money(totalCents) })}
          </Button>
          {props.model === "dynamic" ? (
            <span data-slot="plan-terms" className="text-center text-caption text-muted-foreground">
              {tPlans("terms")}
            </span>
          ) : null}
          {payForSale ? null : <span className="text-center text-caption text-muted-foreground">{t("catalog.unavailable")}</span>}
        </div>
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
    <div className="mx-auto w-full max-w-wide px-4 pt-4 pb-10 sm:px-6 lg:px-8">
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
                {props.shortLinkPreview ? (
                  <span
                    aria-hidden
                    className="pointer-events-none absolute inset-0 grid -rotate-30 place-items-center text-h1 font-bold tracking-[0.3em] text-foreground/7 uppercase"
                  >
                    {t("shortLinkPreview.mark")}
                  </span>
                ) : null}
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
          {props.shortLinkPreview ? (
            <p data-slot="short-link-preview" className="mt-3 text-caption text-secondary-foreground">
              {t("shortLinkPreview.note")}
            </p>
          ) : null}
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
              {props.mode === "guest"
                ? t("subGuest")
                : entitled
                  ? t("subEntitled")
                  : offer?.path === "unlock"
                    ? t("subUnlock", { plan: offer.planName ?? "" })
                    : offer?.path === "credit"
                      ? t("subCredit")
                      : t("subPay")}
            </p>
          </header>

          {props.mode === "guest" && props.signInNotice ? (
            <Banner tone={props.signInNotice === "canceled" ? "neutral" : "error"}>
              {t.rich(props.signInNotice === "canceled" ? "signInCanceled" : "signInIncomplete", { format: fmt, b: (c) => <b>{c}</b> })}
            </Banner>
          ) : null}
          {sessionEnded ? (
            <Banner tone="error">
              {t.rich("sessionEnded", { b: (c) => <b>{c}</b> })}{" "}
              <button
                type="button"
                className="cursor-pointer font-semibold underline underline-offset-2"
                onClick={() => router.push(signInAgainHref())}
              >
                {t("signInAgain")}
              </button>
            </Banner>
          ) : null}
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
              {(props.receipt.lines?.length ? props.receipt.lines : [{ offer: "single", amount: props.receipt.amountCents }]).map((l) => (
                <Line
                  key={l.offer}
                  label={l.offer === "printPack" ? t("lines.pp") : t("lines.singleNamed", { name: props.heading.split(" · ")[0] ?? "" })}
                  value={format.number(l.amount / 100, { style: "currency", currency: props.receipt?.currency.toUpperCase() ?? "USD" })}
                />
              ))}
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
            <div className="grid grid-cols-3 gap-2">
              {(["png", "svg", "pdf"] as const).map((f) => (
                <button
                  key={f}
                  type="button"
                  aria-pressed={settings.format === f}
                  aria-label={t(f)}
                  aria-describedby={`format-${f}-hint`}
                  onClick={() => update({ format: f })}
                  className={cn(
                    "relative flex cursor-pointer flex-col items-start gap-0.5 rounded-lg border border-border bg-surface p-3.5 text-left disabled:cursor-not-allowed disabled:opacity-60",
                    "aria-pressed:border-selected-border aria-pressed:bg-selected aria-pressed:shadow-[0_0_0_1px_var(--color-selected-border)]",
                  )}
                >
                  <span className="text-h3">{t(f)}</span>
                  {settings.format === f ? (
                    <span
                      aria-hidden
                      className="absolute top-2 right-2 grid size-5 place-items-center rounded-full bg-primary text-primary-foreground"
                    >
                      <CheckIcon className="size-3.5" strokeWidth={3} />
                    </span>
                  ) : null}
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

          {pp && entitled && pp.owned ? (
            <section aria-labelledby="export-pp" className="flex flex-col gap-2">
              <div className="flex items-center justify-between gap-2">
                <h3 id="export-pp" className="text-[0.875rem] font-bold">
                  {t("ppTitle")}
                </h3>
                <Badge variant="success">{t("ppUnlocked")}</Badge>
              </div>
              <ul className="flex flex-col gap-2">
                {pp.files.map((f) => (
                  <li key={f.file} className="flex min-w-0 items-center gap-3 rounded-lg bg-subtle px-3 py-2.5">
                    <span className="grid size-8 shrink-0 place-items-center rounded-md bg-surface">
                      <FileTextIcon aria-hidden className="size-4" />
                    </span>
                    <span className="flex min-w-0 grow flex-col">
                      <span className="text-label">{f.label}</span>
                      <span className="truncate text-caption text-muted-foreground">{f.meta}</span>
                    </span>
                    <Button asChild size="sm">
                      <a href={f.href}>
                        <DownloadIcon aria-hidden />
                        <span className="max-sm:sr-only">{t("ppDownload")}</span>
                      </a>
                    </Button>
                  </li>
                ))}
              </ul>
              <Button asChild size="sm" className="self-start">
                <Link href={pp.previewHref}>{t("inspectPrint")}</Link>
              </Button>
              <span className="text-caption text-muted-foreground">{t("ppRepeat")}</span>
            </section>
          ) : pp && offer?.path !== "limitStatic" && offer?.path !== "limitDyn" ? (
            <section aria-labelledby="export-pp" className="flex flex-col gap-2">
              <div className="flex items-center justify-between gap-2">
                <h3 id="export-pp" className="text-[0.875rem] font-bold">
                  {t("ppTitle")}
                </h3>
                <span className="rounded-full bg-subtle px-2 py-0.5 text-[0.6875rem] font-bold tracking-[0.06em] text-muted-foreground uppercase">
                  {t("ppOptional")}
                </span>
              </div>
              {entitled ? (
                <div className="flex flex-col gap-2 rounded-lg border border-border p-3.5">
                  <span className="text-caption text-secondary-foreground">{t("ppAddText")}</span>
                  <Button size="sm" className="self-start" disabled={paying || (!ppIncluded && !pp.forSale)} onClick={addPrintPack}>
                    {ppIncluded ? t("ppUseIncluded") : t("ppAdd", { price: money(pp.cents) })}
                  </Button>
                  {!ppIncluded && !pp.forSale ? <span className="text-caption text-muted-foreground">{t("ppNotForSale")}</span> : null}
                </div>
              ) : (
                <label
                  className={cn(
                    "flex cursor-pointer items-center gap-3 rounded-lg border border-border p-3.5 has-checked:border-selected-border has-checked:bg-selected has-disabled:cursor-not-allowed has-disabled:opacity-60",
                  )}
                >
                  <input
                    type="checkbox"
                    role="switch"
                    className="peer sr-only"
                    checked={ppOn}
                    disabled={frozen || (!ppIncluded && !pp.forSale)}
                    onChange={(e) => setAddPrint(e.target.checked)}
                  />
                  <span
                    aria-hidden
                    className="relative h-6 w-10 shrink-0 rounded-full bg-border-strong/30 transition-colors peer-checked:bg-primary after:absolute after:top-0.5 after:left-0.5 after:size-5 after:rounded-full after:bg-surface after:transition-transform peer-checked:after:translate-x-4 motion-reduce:after:transition-none"
                  />
                  <span className="flex min-w-0 grow flex-col">
                    <b className="text-[0.875rem] font-semibold">{ppIncluded ? t("ppUseIncluded") : t("ppAddTitle")}</b>
                    <span className="text-caption text-secondary-foreground">
                      {ppIncluded && pp.included ? t("ppIncludedSub", { left: pp.included.left, limit: pp.included.limit }) : t("ppSub")}
                    </span>
                  </span>
                  <b className="text-[0.9375rem] tabular-nums">{ppIncluded ? t("ppIncluded") : pp.forSale ? `+${money(pp.cents)}` : "—"}</b>
                </label>
              )}
              {!entitled && !ppIncluded && !pp.forSale ? (
                <span className="text-caption text-muted-foreground">{t("ppNotForSale")}</span>
              ) : null}
              <Link href={pp.previewHref} className="self-start text-[0.875rem] font-semibold underline underline-offset-3">
                {t("inspectPrintFirst")}
              </Link>
            </section>
          ) : props.print?.kind === "setup" ? (
            <div className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-3">
              <span className="flex items-center gap-2 text-label">
                <PrinterIcon aria-hidden className="size-4 text-muted-foreground" />
                {t("printTitle")}
              </span>
              <span className="text-caption text-secondary-foreground">{t("printSetupText")}</span>
              <Button asChild size="sm" className="self-start">
                <Link href={props.print.href}>{t("printSetup")}</Link>
              </Button>
            </div>
          ) : null}

          <Banner tone="neutral" icon={<ShieldIcon aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground" />}>
            {t.rich("quality", { b: (c) => <b>{c}</b> })}
          </Banner>

          <section aria-label={t("summary.title")} className="flex flex-col gap-2 border-t border-border pt-4">
            <Line label={t("summary.code")} value={props.heading.split(" · ")[0] ?? props.heading} />
            <Line label={t("summary.type")} value={`${props.typeLabel} · ${t(`model.${props.model}`)}`} />
            <Line label={t("summary.layout")} value={`${props.layoutName} · ${layoutDims}`} />
            <Line label={t("summary.file")} value={`${fmt} · ${fileDims}`} />
            {!entitled && orderLines.length ? (
              <div className="mt-1 flex flex-col gap-2 border-t border-border pt-3">
                {orderLines.map((l) => (
                  <Line key={l.label} label={l.label} value={l.value} tone={l.included ? "ok" : undefined} />
                ))}
              </div>
            ) : null}
            {!entitled ? (
              <>
                <div className="mt-1 border-t border-border pt-3">
                  <Line
                    strong
                    label={t("summary.total")}
                    value={
                      props.model === "dynamic" && offer?.path !== "activate" && offer?.path !== "limitDyn"
                        ? t("perMonth", { price: amount })
                        : money(totalCents)
                    }
                  />
                </div>
                <ul className="flex flex-col gap-1.5 text-[0.875rem]">
                  {(props.model === "dynamic" ? (["dyn1", "dyn2", "dyn3"] as const) : (["static1", "static2", "static3"] as const)).map(
                    (k) => (
                      <li key={k} className="flex items-start gap-2.5">
                        <CheckIcon aria-hidden className="mt-0.5 size-4 shrink-0 text-accent-text" />
                        {t(`incl.${k}`, { limit: offer?.dynamic?.limit ?? 5 })}
                      </li>
                    ),
                  )}
                  {ppOn ? (
                    <li className="flex items-start gap-2.5">
                      <CheckIcon aria-hidden className="mt-0.5 size-4 shrink-0 text-accent-text" />
                      {t("incl.pp")}
                    </li>
                  ) : null}
                </ul>
                <span className="text-caption text-muted-foreground">{t("summary.tax")}</span>
              </>
            ) : props.receipt ? null : (
              <Line strong label={t("summary.total")} value={t("summary.included")} />
            )}
            {!entitled && offer?.path === "limitStatic" ? (
              <LimitPanel
                title={t("limits.staticTitle", { limit: offer.unlocks?.limit ?? 0 })}
                text={t("limits.staticText")}
                used={offer.unlocks?.limit ?? 0}
                limit={offer.unlocks?.limit ?? 0}
                usedLabel={t("limits.staticUsed", { used: offer.unlocks?.limit ?? 0, limit: offer.unlocks?.limit ?? 0 })}
                aside={offer.resets ? t("limits.resets", { date: offer.resets }) : ""}
                options={[
                  {
                    label: t("limits.buyOnce"),
                    sub: t("limits.buyOnceSub"),
                    price: money(offer.cents.single),
                    onClick: pay,
                    disabled: paying || !(offer.forSale?.single ?? true),
                  },
                  { label: t("limits.credits"), sub: t("limits.creditsSub"), price: money(offer.cents.pack3), href: "/pricing#pr-once" },
                  {
                    label: t("limits.studio"),
                    sub: t("limits.studioSub"),
                    price: t("perMonthShort", { price: money(offer.cents.studio) }),
                    href: "/dashboard/billing",
                  },
                ]}
              />
            ) : null}
            {!entitled && offer?.path === "limitDyn" ? (
              <LimitPanel
                title={t("limits.dynTitle", { limit: offer.dynamic?.limit ?? 0 })}
                text={t("limits.dynText")}
                used={offer.dynamic?.used ?? 0}
                limit={offer.dynamic?.limit ?? 0}
                usedLabel={t("limits.dynUsed", { used: offer.dynamic?.used ?? 0, limit: offer.dynamic?.limit ?? 0 })}
                aside={t("limits.live")}
                options={[
                  { label: t("limits.pause"), sub: t("limits.pauseSub"), href: "/dashboard?filter=dynamic" },
                  {
                    label: t("limits.studio"),
                    sub: t("limits.studioDynSub"),
                    price: t("perMonthShort", { price: money(offer.cents.studio) }),
                    href: "/dashboard/billing",
                  },
                  // A hosted page can only be Dynamic (the server refuses the conversion too).
                  ...(props.hosted
                    ? []
                    : [{ label: t("limits.toStatic"), sub: t("limits.toStaticSub"), onClick: toStatic, disabled: paying }]),
                ]}
              />
            ) : null}
          </section>

          {action}
          {/* HEY-180 (design 3.11): the note says what the action costs. Stripe only where the next step is Stripe; once the
              code is paid for, nothing to pay. A plan unlock, a credit or a free slot has no note. */}
          {props.mode === "guest" ? (
            <p className="text-center text-caption text-muted-foreground">{t("guestNote")}</p>
          ) : entitled ? (
            <p className="text-center text-caption text-muted-foreground">{t("includedNote")}</p>
          ) : totalCents > 0 || offer?.path === "buy" || offer?.path === "subscribe" || !offer ? (
            <p className="text-center text-caption text-muted-foreground">{t("secure")}</p>
          ) : null}
          {/* HEY-109: shown where the next step is a Single QR payment on Stripe (as a guest, or the Pay path). */}
          {props.model === "static" && !entitled && !confirming && (props.mode === "guest" || offer?.path === "buy") ? (
            <PaymentInfo compact price={amount} support={props.support ?? null} className="rounded-lg bg-subtle p-3.5" />
          ) : null}
        </aside>
      </div>
    </div>
  );
}

function LimitPanel({
  title,
  text,
  used,
  limit,
  usedLabel,
  aside,
  options,
}: {
  title: string;
  text: string;
  used: number;
  limit: number;
  usedLabel: string;
  aside: string;
  options: { label: string; sub: string; price?: string; href?: string; onClick?: () => void; disabled?: boolean }[];
}) {
  const box =
    "flex min-h-14 w-full items-center gap-3 rounded-lg border border-border bg-surface px-3.5 py-2.5 text-left hover:border-border-hover first:border-selected-border first:shadow-[0_0_0_1px_var(--selected-border)]";
  return (
    <div role="status" className="mt-2 flex flex-col gap-3 rounded-xl border border-warning/30 bg-warning-soft p-4">
      <div className="flex items-start gap-2.5">
        <TriangleAlertIcon aria-hidden className="mt-0.5 size-4.5 shrink-0 text-warning" />
        <span className="flex flex-col gap-0.5">
          <b className="text-[0.9375rem] text-warning">{title}</b>
          <span className="text-[0.875rem]">{text}</span>
        </span>
      </div>
      <div aria-hidden className="h-2 overflow-hidden rounded-full bg-surface">
        <span className="block h-full rounded-full bg-warning" style={{ width: `${limit ? Math.min(100, (used / limit) * 100) : 100}%` }} />
      </div>
      <div className="flex justify-between gap-2 text-caption">
        <span>{usedLabel}</span>
        <span>{aside}</span>
      </div>
      <div className="flex flex-col gap-2">
        {options.map((o) =>
          o.href ? (
            <Link key={o.label} href={o.href} className={box}>
              <span className="flex min-w-0 grow flex-col">
                <b className="text-[0.875rem] font-semibold">{o.label}</b>
                <span className="text-caption text-secondary-foreground">{o.sub}</span>
              </span>
              {o.price ? <b className="tabular-nums">{o.price}</b> : null}
            </Link>
          ) : (
            <button
              key={o.label}
              type="button"
              onClick={o.onClick}
              disabled={o.disabled}
              className={cn(box, "cursor-pointer disabled:cursor-wait")}
            >
              <span className="flex min-w-0 grow flex-col">
                <b className="text-[0.875rem] font-semibold">{o.label}</b>
                <span className="text-caption text-secondary-foreground">{o.sub}</span>
              </span>
              {o.price ? <b className="tabular-nums">{o.price}</b> : null}
            </button>
          ),
        )}
      </div>
    </div>
  );
}

function Line({ label, value, strong, tone }: { label: string; value: string; strong?: boolean; tone?: "ok" }) {
  return (
    <div className={cn("flex items-baseline justify-between gap-4 text-[0.875rem]", strong ? "font-bold" : "text-secondary-foreground")}>
      <span className="min-w-0">{label}</span>
      <span
        className={cn(
          "shrink-0 text-right tabular-nums",
          !strong && "text-foreground",
          tone === "ok" && "font-semibold text-success",
          strong && "text-[1.75rem] leading-none",
        )}
      >
        {value}
      </span>
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
