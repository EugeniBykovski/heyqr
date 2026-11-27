"use client";

import type { Layout } from "@heyqr/qr-core";
import {
  AlertTriangleIcon,
  ArrowLeftIcon,
  CheckIcon,
  ChevronDownIcon,
  DownloadIcon,
  FileTextIcon,
  LoaderCircleIcon,
  LockIcon,
  RotateCwIcon,
} from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import {
  AVAILABLE_PROFILES,
  CUSTOM_WIDTH,
  PRINT_BLEEDS,
  PRINT_PROFILES,
  PRINT_SCALES,
  printSettingsQuery,
  printSizes,
  type PrintProfile,
  type PrintSettings,
} from "@/entities/qr";
import { Link, useRouter } from "@/i18n/navigation";
import { takeIncludedPrintPack } from "@/server/actions/billing";
import { startPrintPackCheckout } from "@/server/actions/qr";
import { preparedFileName } from "@/shared/lib/file-name";
import { cn } from "@/shared/lib/utils";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import { formatMoney, type Currency } from "@/shared/config/catalog-core";

type Preview = {
  svg: string;
  sizes: ReturnType<typeof printSizes>;
  colors: { role: string; roles: string[]; hex: string; srgb: string }[];
  logo: { raster: boolean; px: number | null; ppi: number | null; mm: number } | null;
  warnings: ({ code: "logo_low_ppi"; ppi: number; needPx: number } | { code: "qr_small"; qrMm: number })[];
  renderKey: string;
  scanOk: boolean;
  entitled: boolean;
  unlocked: boolean;
  forSale: boolean;
};
type Zoom = "fit" | "100" | "200";
const CSS_PX_PER_MM = 96 / 25.4;

/*
 * Design 8.1–8.7 "Print Preview": the PDF page the print files are made from, with print specifications and settings.
 * Every output-affecting change asks the server for a new preview of the saved layout revision with these settings;
 * while it is generated the page keeps its exact aspect ratio and the downloads wait. Older answers are dropped.
 * Zoom, trim and safe-area guides are view-only overlays, separate from the PDF content.
 */
export function PrintPreview({
  qrCodeId,
  layoutId,
  layout,
  name,
  layoutName,
  initial,
  price,
  back,
  designHref,
  checkout,
  stale,
  entitled,
  forSale,
  included,
  sample = false,
}: {
  qrCodeId: string;
  layoutId: string;
  /** The saved layout, so the page's proportions are known before the first preview arrives. */
  layout: Layout;
  name: string;
  layoutName: string;
  initial: PrintSettings;
  price: { cents: number; currency: Currency };
  back: { href: string; label: string };
  designHref: string;
  checkout?: "success" | "cancelled";
  stale?: boolean;
  /** From the server when the page renders: the code itself is bought or live, and the add-on can be bought here. */
  entitled: boolean;
  forSale: boolean;
  /** Design 8.4: Studio's included Print Packs this month (null without a plan that includes them). */
  included?: { left: number; limit: number; resets: string } | null;
  /** Design 1.1: the public sample (demo QR): the page and specifications only; no purchase or files here. */
  sample?: boolean;
}) {
  const t = useTranslations("print");
  // The same file-preparation copy as Export (Handoff · Commerce §3).
  const te = useTranslations("export");
  const locale = useLocale();
  const router = useRouter();
  const [settings, setSettings] = useState<PrintSettings>(initial);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [zoom, setZoom] = useState<Zoom>("fit");
  const [guides, setGuides] = useState(true);
  const [tech, setTech] = useState(true);
  const [customWidth, setCustomWidth] = useState<string>("");
  const [attempt, setAttempt] = useState(0);
  const [paying, startPaying] = useTransition();
  const request = useRef(0);
  const sizes = printSizes(layout, settings);
  const amount = formatMoney(price.cents, price.currency);
  const confirming = checkout === "success" && preview !== null && !preview.unlocked;

  // Ask for the page of these settings; only the newest request may update the screen.
  useEffect(() => {
    const id = ++request.current;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the page waits for its new render
    setStatus("loading");
    const timer = window.setTimeout(async () => {
      try {
        const res = await fetch("/api/print/preview", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(sample ? { sample: true, settings } : { layoutId, settings }),
        });
        if (id !== request.current) return;
        if (!res.ok) throw new Error(String(res.status));
        const data = (await res.json()) as Preview;
        if (id !== request.current) return;
        setPreview(data);
        setStatus("ready");
      } catch {
        if (id === request.current) setStatus("error");
      }
    }, 250);
    return () => window.clearTimeout(timer);
  }, [layoutId, settings, attempt, sample]);

  // Back from checkout before Stripe's webhook has unlocked it: check again a few seconds apart.
  useEffect(() => {
    if (!confirming) return;
    const id = window.setInterval(() => setAttempt((a) => a + 1), 3000);
    return () => window.clearInterval(id);
  }, [confirming]);

  const set = (patch: Partial<PrintSettings>) => setSettings((s) => ({ ...s, ...patch }));
  const ready = status === "ready" && preview !== null;
  const unlocked = preview?.unlocked === true;
  const qrSmall = sizes.qr < 20;
  const logoWarn = ready ? preview.warnings.find((w) => w.code === "logo_low_ppi") : undefined;
  type PackFile = "pdf" | "svg" | "spec";
  const fileHref = (file: PackFile) =>
    `/api/print/files/${layoutId}?file=${file}&key=${preview?.renderKey ?? ""}&locale=${locale}&nav=1&qr=${qrCodeId}&${printSettingsQuery(settings)}`;
  /*
   * HEY-196 / Handoff · Commerce §3 "File generation": the file is prepared first (the server checks access and stores it,
   * no bytes); then the link downloads it. A failure keeps the person here with "Your payment and settings are safe"
   * and Try again, on the same Print Pack: nothing is bought again. A changed layout (409) still follows the link, which
   * brings the preview back with its notice.
   */
  /*
   * HEY-197: like Export (3.7 → 3.9), a prepared file is then downloaded by the person's own click on its link, under the
   * name the server gives it, and the row says so. A download started by script after the request ended is an
   * "automatic download" to the browser, and the second of the three files would wait behind a permission prompt.
   */
  type FileRow = { kind: "preparing" | "failed" } | { kind: "ready" | "downloaded"; name: string };
  // A prepared file belongs to one render (layout revision) and one set of print settings: rows kept for another one
  // read as empty, so a change starts over.
  const filesFor = `${preview?.renderKey ?? ""}|${printSettingsQuery(settings)}`;
  const [fileRows, setFileRows] = useState<{ for: string; rows: Partial<Record<PackFile, FileRow>> }>({ for: "", rows: {} });
  const files = fileRows.for === filesFor ? fileRows.rows : {};
  const setRow = (file: PackFile, row: FileRow) =>
    setFileRows((s) => ({ for: filesFor, rows: { ...(s.for === filesFor ? s.rows : {}), [file]: row } }));
  const preparingAny = Object.values(files).some((r) => r?.kind === "preparing");
  const download = async (file: PackFile) => {
    const href = fileHref(file);
    setRow(file, { kind: "preparing" });
    try {
      const res = await fetch(`${href.replace("&nav=1", "")}&prepare=1`, { credentials: "same-origin" });
      // A changed layout follows the link, which brings the preview back with its notice.
      if (res.status === 409) {
        window.location.assign(href);
        return;
      }
      if (!res.ok) {
        setRow(file, { kind: "failed" });
        return;
      }
      setRow(file, { kind: "ready", name: await preparedFileName(res, `print.${file === "spec" ? "pdf" : file}`) });
    } catch {
      setRow(file, { kind: "failed" });
    }
  };
  const pageCss =
    zoom === "fit"
      ? { width: "100%", aspectRatio: `${sizes.page.width} / ${sizes.page.height}` }
      : {
          width: `${sizes.page.width * CSS_PX_PER_MM * (zoom === "200" ? 2 : 1)}px`,
          aspectRatio: `${sizes.page.width} / ${sizes.page.height}`,
        };
  const pct = (v: number, of: number) => `${(v / of) * 100}%`;
  const box = (x: number, y: number, w: number, h: number) => ({
    left: pct(x, sizes.page.width),
    top: pct(y, sizes.page.height),
    width: pct(w, sizes.page.width),
    height: pct(h, sizes.page.height),
  });

  /** Design 8.4: Studio's included Print Pack for this code, then the page reloads its unlocked state. */
  const useIncluded = () =>
    startPaying(async () => {
      const result = await takeIncludedPrintPack(qrCodeId).catch(() => ({ ok: false as const, error: "failed" as const }));
      if (!result.ok) {
        toast.error(t("unlock.failed"), { id: "print-pack" });
        return;
      }
      setAttempt((a) => a + 1);
      router.refresh();
    });

  const unlock = () =>
    startPaying(async () => {
      const result = await startPrintPackCheckout({ qrCodeId, layoutId, settings: printSettingsQuery(settings), locale }).catch(() => ({
        ok: false as const,
        error: "failed",
      }));
      if (result.ok) window.location.assign(result.data.url);
      else toast.error(t("unlock.failed"), { id: "print-pack" });
    });

  const specCells = [
    {
      k: t("keys.finished"),
      v: `${sizes.finished.width} × ${sizes.finished.height} mm`,
      sub: settings.bleed ? t("keys.finishedBleed", { bleed: settings.bleed }) : t("keys.finishedNoBleed"),
      warn: false,
    },
    {
      k: t("keys.qr"),
      v: `${sizes.qr} × ${sizes.qr} mm`,
      sub: qrSmall ? t("keys.qrSmall") : t("keys.qrOk", { cm: Math.round(sizes.qr) }),
      warn: qrSmall,
    },
    { k: t("keys.profile"), v: t("profiles.srgb"), sub: t("keys.profileSub"), warn: false },
    {
      k: t("keys.logo"),
      // Until the page of these settings is back, the resolution isn't known yet (never "No logo" for a logo).
      v: !ready
        ? t("keys.logoChecking")
        : preview.logo
          ? preview.logo.ppi !== null
            ? `${preview.logo.ppi} ppi`
            : t("keys.logoVector")
          : t("keys.logoNone"),
      sub: !ready
        ? t("keys.logoCheckingSub")
        : preview.logo
          ? preview.logo.ppi !== null
            ? logoWarn
              ? t("keys.logoLow")
              : t("keys.logoOk")
            : t("keys.logoVectorSub")
          : t("keys.logoNoneSub"),
      warn: Boolean(logoWarn),
    },
  ];

  return (
    <div className="mx-auto flex w-full max-w-wide flex-col gap-5 px-4 pt-4 pb-12 sm:px-6 lg:px-8">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button asChild variant="ghost" size="sm">
          <Link href={back.href}>
            <ArrowLeftIcon aria-hidden />
            {back.label}
          </Link>
        </Button>
        <Button asChild size="sm">
          <Link href={designHref}>{t("toDesign")}</Link>
        </Button>
      </div>
      <header className="flex flex-col gap-2">
        <div className="flex flex-wrap gap-1.5">
          <Badge>
            {name} · {layoutName}
          </Badge>
          <Badge variant={unlocked ? "success" : "neutral"}>{unlocked ? t("unlocked") : t("locked")}</Badge>
        </div>
        <h1 className="text-h1">{t("title")}</h1>
        <p className="max-w-measure text-secondary-foreground">{unlocked ? t("leadUnlocked") : t("leadLocked")}</p>
      </header>
      {stale ? (
        <p role="alert" className="rounded-md bg-warning-soft px-3.5 py-3 text-[0.875rem] text-warning">
          {t("files.stale")}
        </p>
      ) : null}
      {checkout === "cancelled" && !unlocked ? (
        <p role="status" className="rounded-md bg-subtle px-3.5 py-3 text-[0.875rem] text-secondary-foreground">
          {t("unlock.cancelled")}
        </p>
      ) : null}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_25rem] lg:items-start xl:grid-cols-[minmax(0,1fr)_27rem]">
        <section aria-label={t("canvas")} className="flex min-w-0 flex-col overflow-hidden rounded-xl border border-border bg-surface">
          <div className="flex flex-wrap items-center gap-3 border-b border-border px-3 py-2">
            <div role="group" aria-label={t("zoom")} className="inline-flex rounded-full border border-border bg-subtle p-0.5">
              {(["fit", "100", "200"] as const).map((z) => (
                <button
                  key={z}
                  type="button"
                  aria-pressed={zoom === z}
                  onClick={() => setZoom(z)}
                  className="min-h-8 cursor-pointer rounded-full px-2.5 text-[0.8125rem] font-semibold text-secondary-foreground aria-pressed:bg-surface aria-pressed:text-foreground aria-pressed:shadow-segment"
                >
                  {z === "fit" ? t("fit") : t(`z${z}`)}
                </button>
              ))}
            </div>
            <label className="flex min-h-9 cursor-pointer items-center gap-2 text-[0.875rem]">
              <input type="checkbox" className="size-4.5 accent-primary" checked={guides} onChange={(e) => setGuides(e.target.checked)} />
              {t("guides")}
            </label>
            <span className="ml-auto text-caption text-muted-foreground">{t("approx")}</span>
          </div>
          <div className="grid min-h-80 place-items-center overflow-auto bg-stage bg-[radial-gradient(var(--color-stage-dot)_1px,transparent_1.3px)] bg-size-[18px_18px] p-5 sm:p-8">
            <div
              className={cn("relative mx-auto max-w-full shrink-0 bg-white shadow-3", zoom === "fit" && "max-h-[70vh] w-auto")}
              style={
                zoom === "fit"
                  ? { aspectRatio: pageCss.aspectRatio, width: "min(100%, 34rem)" }
                  : { width: pageCss.width, aspectRatio: pageCss.aspectRatio, maxWidth: "none" }
              }
            >
              {ready ? (
                <div
                  role="img"
                  aria-label={t("pageLabel", { w: sizes.page.width, h: sizes.page.height })}
                  className="size-full [&>svg]:block [&>svg]:size-full"
                  dangerouslySetInnerHTML={{
                    __html: preview.svg.replace(/width="[^"]*mm" height="[^"]*mm"/, 'width="100%" height="100%"'),
                  }}
                />
              ) : status === "error" ? (
                <div role="alert" className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-4 text-center">
                  <b>{t("error.title")}</b>
                  <span className="text-caption text-secondary-foreground">{t("error.text")}</span>
                  <Button variant="primary" size="sm" onClick={() => setAttempt((a) => a + 1)}>
                    <RotateCwIcon aria-hidden />
                    {t("error.retry")}
                  </Button>
                </div>
              ) : (
                <div aria-busy className="absolute inset-0 grid place-items-center">
                  <span className="absolute inset-[12%] animate-pulse rounded-md bg-skeleton motion-reduce:animate-none" />
                  <span
                    role="status"
                    className="relative inline-flex items-center gap-2 rounded-full bg-inverse px-3 py-1.5 text-[0.8125rem] font-semibold text-inverse-foreground"
                  >
                    <LoaderCircleIcon aria-hidden className="size-4 animate-spin motion-reduce:animate-none" />
                    {t("generating")}
                  </span>
                </div>
              )}

              {guides && status !== "error" ? (
                <>
                  <span
                    aria-hidden
                    className="pointer-events-none absolute border border-dashed border-info"
                    style={box(sizes.trim.x, sizes.trim.y, sizes.finished.width, sizes.finished.height)}
                  >
                    <span className="absolute -top-5 left-0 rounded-xs bg-info px-1 text-[0.625rem] font-semibold whitespace-nowrap text-inverse-foreground">
                      {t("trimLabel", { size: `${sizes.finished.width} × ${sizes.finished.height} mm` })}
                    </span>
                  </span>
                  <span
                    aria-hidden
                    className="pointer-events-none absolute border border-dotted border-danger"
                    style={box(
                      sizes.trim.x + sizes.safe,
                      sizes.trim.y + sizes.safe,
                      sizes.finished.width - 2 * sizes.safe,
                      sizes.finished.height - 2 * sizes.safe,
                    )}
                  />
                </>
              ) : null}
            </div>
          </div>
          <div className="flex flex-wrap justify-between gap-x-4 gap-y-1 border-t border-border px-3 py-2.5 text-[0.8125rem] text-secondary-foreground">
            <span>
              {t.rich("foot.pageB", {
                size: `${sizes.page.width} × ${sizes.page.height} mm`,
                b: (c) => <b className="text-foreground">{c}</b>,
              })}
            </span>
            <span>
              {[
                settings.bleed ? t("foot.bleed", { bleed: settings.bleed }) : t("foot.noBleed"),
                settings.cropMarks ? t("foot.marks") : t("foot.noMarks"),
                t("foot.count"),
              ].join(" · ")}
            </span>
          </div>
        </section>

        <aside aria-labelledby="print-spec" className="flex flex-col gap-5 lg:sticky lg:top-[calc(var(--spacing-header)+1rem)]">
          <section className="flex flex-col gap-3">
            <h2 id="print-spec" className="text-h3">
              {t("specTitle")}
            </h2>
            <dl className="grid grid-cols-2 overflow-hidden rounded-xl border border-border bg-surface [&>div]:border-border [&>div:nth-child(even)]:border-l [&>div:nth-child(n+3)]:border-t">
              {specCells.map((c) => (
                <div key={c.k} className={cn("flex flex-col gap-0.5 p-3.5", c.warn && "bg-warning-soft")}>
                  <dt className="text-caption text-muted-foreground">{c.k}</dt>
                  {/* HEY-192: measurements read left to right in Arabic too. */}
                  <dd className="text-label tabular-nums">
                    <bdi dir="ltr">{c.v}</bdi>
                  </dd>
                  <dd className={cn("text-caption", c.warn ? "text-warning" : "text-muted-foreground")}>{c.sub}</dd>
                </div>
              ))}
            </dl>
          </section>
          <div className="flex flex-col">
            {sample ? (
              <div className="flex flex-col gap-2.5 rounded-2xl border border-border bg-surface p-5">
                <span className="text-label">{t("sample.title")}</span>
                <p className="text-caption text-secondary-foreground">{t("sample.text")}</p>
                <Button asChild variant="primary" size="lg">
                  <Link href="/create">{t("sample.create")}</Link>
                </Button>
                <Button asChild variant="ghost">
                  <Link href="/pricing#print-pack">{t("sample.pricing")}</Link>
                </Button>
              </div>
            ) : unlocked ? (
              <div className="flex flex-col gap-2.5 rounded-xl border border-success/30 bg-success-soft p-4">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-label">{t("files.title")}</span>
                  <Badge variant="success">{t("files.badge")}</Badge>
                </div>
                <p className="text-caption text-secondary-foreground">{t("files.text")}</p>
                {(
                  [
                    ["pdf", t("files.pdf"), t("files.pdfSub", { w: sizes.page.width, h: sizes.page.height })],
                    ["svg", t("files.svg"), t("files.svgSub", { w: sizes.finished.width, h: sizes.finished.height })],
                    ["spec", t("files.spec"), t("files.specSub")],
                  ] as const
                ).map(([file, label, sub]) => {
                  const row = files[file];
                  const format = file === "svg" ? "SVG" : "PDF";
                  const prepared = row?.kind === "ready" || row?.kind === "downloaded" ? row : null;
                  return ready ? (
                    <div key={file} className="flex flex-col gap-1.5">
                      <a
                        href={fileHref(file)}
                        // Prepared: the link is the download itself, saved under the server's name (3.8 → 3.9).
                        download={prepared ? prepared.name : undefined}
                        aria-busy={row?.kind === "preparing" ? true : undefined}
                        onClick={(e) => {
                          if (prepared) {
                            setRow(file, { kind: "downloaded", name: prepared.name });
                            return;
                          }
                          e.preventDefault();
                          if (!preparingAny) void download(file);
                        }}
                        className={cn(
                          "flex min-h-12 items-center gap-3 rounded-lg border border-border bg-surface px-3 py-2 text-left hover:border-border-hover",
                          file === "pdf" && "border-primary",
                          row?.kind === "ready" && "border-primary bg-selected",
                        )}
                      >
                        {row?.kind === "preparing" ? (
                          <LoaderCircleIcon aria-hidden className="size-5 shrink-0 animate-spin motion-reduce:animate-none" />
                        ) : row?.kind === "downloaded" ? (
                          <CheckIcon aria-hidden className="size-5 shrink-0 text-success" />
                        ) : file === "spec" ? (
                          <FileTextIcon aria-hidden className="size-5 shrink-0" />
                        ) : (
                          <DownloadIcon aria-hidden className="size-5 shrink-0" />
                        )}
                        <span className="flex min-w-0 flex-col">
                          <b className="text-[0.875rem] font-semibold">
                            {row?.kind === "ready" ? te("download", { format }) : row?.kind === "downloaded" ? te("downloadAgain") : label}
                          </b>
                          <span className="truncate text-caption text-muted-foreground">
                            {row?.kind === "preparing"
                              ? te("preparing", { format })
                              : row?.kind === "ready"
                                ? t("files.readyAs", { name: row.name })
                                : row?.kind === "downloaded"
                                  ? t("files.downloadedAs", { name: row.name })
                                  : sub}
                          </span>
                        </span>
                      </a>
                      {row?.kind === "failed" ? (
                        <div
                          role="alert"
                          className="flex flex-col items-start gap-2 rounded-md bg-danger-soft px-3 py-2.5 text-caption text-danger"
                        >
                          <span>{te.rich("errors.failed", { format, b: (c) => <b>{c}</b> })}</span>
                          <Button type="button" variant="secondary" size="sm" onClick={() => void download(file)}>
                            {t("error.retry")}
                          </Button>
                        </div>
                      ) : null}
                    </div>
                  ) : (
                    <span
                      key={file}
                      aria-disabled
                      className="flex min-h-12 items-center gap-3 rounded-lg border border-border bg-surface px-3 py-2 opacity-60"
                    >
                      <LoaderCircleIcon aria-hidden className="size-5 shrink-0 animate-spin motion-reduce:animate-none" />
                      <b className="text-[0.875rem] font-semibold">{label}</b>
                    </span>
                  );
                })}
              </div>
            ) : confirming ? (
              <div role="status" className="flex flex-col gap-1.5 rounded-xl border border-border bg-subtle p-4">
                <span className="text-label">{t("unlock.pending")}</span>
                <span className="text-caption text-muted-foreground">{t("unlock.pendingSub")}</span>
              </div>
            ) : (
              <div className="flex flex-col gap-2.5 rounded-2xl border border-border bg-surface p-5">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-label">{t("unlock.title")}</span>
                  <Badge>
                    <LockIcon aria-hidden />
                    {t("locked")}
                  </Badge>
                </div>
                <p className="text-caption text-secondary-foreground">{t("unlock.text", { name })}</p>
                {!(preview?.entitled ?? entitled) ? (
                  <>
                    <p className="text-caption text-secondary-foreground">{t("unlock.needCode")}</p>
                    <Button asChild variant="primary" size="lg">
                      <Link href={`/create/export?qr=${qrCodeId}&layout=${layoutId}`}>{t("unlock.buyCode")}</Link>
                    </Button>
                  </>
                ) : included && included.left > 0 ? (
                  <>
                    <Button variant="primary" size="lg" disabled={!ready} loading={paying} onClick={useIncluded}>
                      {t("unlock.useIncluded")}
                    </Button>
                    {(preview?.forSale ?? forSale) ? (
                      <Button variant="ghost" disabled={!ready || paying} onClick={unlock}>
                        {t("unlock.payInstead", { price: amount })}
                      </Button>
                    ) : null}
                    <span className="text-caption text-muted-foreground">
                      {t("unlock.includedLeft", { left: included.left, limit: included.limit, resets: included.resets })}
                    </span>
                  </>
                ) : !(preview?.forSale ?? forSale) ? (
                  <p className="text-caption font-medium text-secondary-foreground">{t("unlock.notForSale")}</p>
                ) : (
                  <>
                    <Button variant="primary" size="lg" disabled={!ready} loading={paying} onClick={unlock}>
                      {t("unlock.action", { price: amount })}
                    </Button>
                    <span className="text-caption text-muted-foreground">{t("unlock.sub")}</span>
                  </>
                )}
              </div>
            )}
          </div>

          <section aria-labelledby="print-size" className="flex flex-col gap-5 rounded-2xl border border-border bg-surface p-5">
            <div className="flex flex-col gap-2">
              <div className="flex items-baseline justify-between gap-2">
                <h3 id="print-size" className="text-[0.875rem] font-bold">
                  {t("size.title")}
                </h3>
                <span dir="ltr" className="text-caption text-muted-foreground tabular-nums">
                  {sizes.finished.width} × {sizes.finished.height} mm
                </span>
              </div>
              <div role="group" aria-labelledby="print-size" className="flex rounded-full border border-border bg-subtle p-0.5">
                {[...PRINT_SCALES.map(String), "custom"].map((o) => {
                  const custom = o === "custom";
                  const on = custom ? !(PRINT_SCALES as readonly number[]).includes(settings.scale) : settings.scale === Number(o);
                  return (
                    <button
                      key={o}
                      type="button"
                      aria-pressed={on}
                      onClick={() => {
                        if (custom) setCustomWidth(String(sizes.finished.width));
                        else set({ scale: Number(o) });
                      }}
                      className="min-h-9 flex-1 cursor-pointer rounded-full px-2 text-[0.8125rem] font-semibold text-secondary-foreground aria-pressed:bg-surface aria-pressed:text-foreground aria-pressed:shadow-segment"
                    >
                      {custom ? t("size.custom") : `${Number(o) * 100}%`}
                    </button>
                  );
                })}
              </div>
              {customWidth !== "" || !(PRINT_SCALES as readonly number[]).includes(settings.scale) ? (
                <div className="flex flex-wrap items-end gap-3">
                  <div className="flex flex-col gap-1">
                    <label htmlFor="print-width" className="text-label">
                      {t("size.width")}
                    </label>
                    <div className="flex items-stretch">
                      <input
                        id="print-width"
                        type="number"
                        inputMode="decimal"
                        min={CUSTOM_WIDTH.min}
                        max={CUSTOM_WIDTH.max}
                        step={0.5}
                        value={customWidth || String(sizes.finished.width)}
                        aria-describedby="print-width-hint"
                        onChange={(e) => {
                          setCustomWidth(e.target.value);
                          const w = Number(e.target.value);
                          const base = sizes.finished.width / settings.scale;
                          if (w >= CUSTOM_WIDTH.min && w <= CUSTOM_WIDTH.max) set({ scale: Math.round((w / base) * 1000) / 1000 });
                        }}
                        className="border-border-control min-h-11 w-28 rounded-l-md border bg-surface px-3 tabular-nums"
                      />
                      <span className="border-border-control grid place-items-center rounded-r-md border border-l-0 bg-subtle px-2.5 text-caption">
                        mm
                      </span>
                    </div>
                  </div>
                  <div className="flex flex-col text-caption">
                    <span className="text-muted-foreground">{t("size.height")}</span>
                    <b className="tabular-nums">{sizes.finished.height} mm</b>
                  </div>
                  <p id="print-width-hint" className="w-full text-caption text-muted-foreground">
                    {t("size.hint")}
                  </p>
                </div>
              ) : null}
              {qrSmall ? (
                <Warn title={t("warn.qrTitle", { mm: sizes.qr })} text={t("warn.qrText")}>
                  <Button size="sm" onClick={() => set({ scale: 1 })}>
                    {t("warn.use100")}
                  </Button>
                </Warn>
              ) : null}
              {logoWarn && logoWarn.code === "logo_low_ppi" ? (
                <Warn title={t("warn.logoTitle", { ppi: logoWarn.ppi })} text={t("warn.logoText", { px: logoWarn.needPx })}>
                  <Button asChild size="sm">
                    <Link href={designHref}>{t("warn.upload")}</Link>
                  </Button>
                  {settings.scale !== 1 ? (
                    <Button size="sm" variant="ghost" onClick={() => set({ scale: 1 })}>
                      {t("warn.use100")}
                    </Button>
                  ) : null}
                </Warn>
              ) : null}
            </div>

            <div role="group" aria-labelledby="print-profile" className="flex flex-col gap-2">
              <h3 id="print-profile" className="text-[0.875rem] font-bold">
                {t("profiles.title")}
              </h3>
              {PRINT_PROFILES.map((p: PrintProfile) => {
                const available = AVAILABLE_PROFILES.includes(p);
                return (
                  <button
                    key={p}
                    type="button"
                    aria-pressed={settings.profile === p}
                    disabled={!available}
                    onClick={() => set({ profile: p })}
                    className="flex min-h-12 cursor-pointer items-start gap-3 rounded-md border border-border bg-surface px-3 py-2 text-left disabled:cursor-not-allowed disabled:opacity-55 aria-pressed:border-selected-border aria-pressed:bg-selected"
                  >
                    <span
                      aria-hidden
                      className={cn(
                        "mt-1 size-3 shrink-0 rounded-full border border-border-strong",
                        settings.profile === p && "border-4 border-primary",
                      )}
                    />
                    <span className="flex flex-col">
                      <b className="text-[0.875rem] font-semibold">{t(`profiles.${p}`)}</b>
                      <span className="text-caption text-muted-foreground">
                        {available ? t("profiles.srgbDesc") : t("profiles.cmykDesc")}
                      </span>
                    </span>
                  </button>
                );
              })}
              <p className="rounded-md bg-info-soft px-3 py-2.5 text-[0.8125rem] text-info">
                {t.rich("profiles.shop", { b: (c) => <b>{c}</b> })}
              </p>
            </div>

            <div className="flex flex-col gap-2">
              <h3 className="text-[0.875rem] font-bold">{t("colors.title")}</h3>
              <p className="flex flex-wrap gap-x-4 text-caption text-muted-foreground">
                <span>{t.rich("colors.legendHex", { b: (c) => <b>{c}</b> })}</span>
                <span>{t.rich("colors.legendCmyk", { b: (c) => <b>{c}</b> })}</span>
              </p>
              <ul className="flex flex-col gap-1.5">
                {(preview?.colors ?? []).map((c) => (
                  <li key={c.role + c.hex} className="flex items-center gap-3 rounded-md border border-border px-2.5 py-2">
                    <span
                      aria-hidden
                      className="size-7 shrink-0 rounded-md shadow-[inset_0_0_0_1px_rgb(13_13_18/0.16)]"
                      style={{ backgroundColor: c.hex }}
                    />
                    <span className="flex min-w-0 flex-col">
                      <b className="text-[0.8125rem] font-semibold">
                        {c.roles
                          .map((r, i) => {
                            const name = t(`spec.role_${r}` as "spec.role_modules");
                            return i ? name.toLowerCase() : name;
                          })
                          .join(", ")}
                      </b>
                      <span className="flex flex-wrap gap-x-3 font-mono text-[0.75rem] text-secondary-foreground">
                        <span>HEX {c.hex}</span>
                        <span>sRGB {c.srgb}</span>
                        <span className="text-muted-foreground">CMYK {t("colors.none")}</span>
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
              <p className="text-caption text-muted-foreground">{t("colors.note")}</p>
            </div>

            <div className="flex flex-col gap-3">
              <button
                type="button"
                aria-expanded={tech}
                aria-controls="print-tech"
                onClick={() => setTech((v) => !v)}
                className="flex min-h-11 cursor-pointer items-center justify-between gap-2 text-left text-[0.875rem] font-bold"
              >
                {t("tech.title")}
                <ChevronDownIcon
                  aria-hidden
                  className={cn("size-4 transition-transform motion-reduce:transition-none", tech && "rotate-180")}
                />
              </button>
              {tech ? (
                <div id="print-tech" className="flex flex-col gap-3">
                  <div className="flex flex-col gap-1.5">
                    <div className="flex items-baseline justify-between gap-2">
                      <span id="print-bleed" className="text-label">
                        {t("tech.bleed")}
                      </span>
                      <span className="text-caption text-muted-foreground">{t("tech.bleedDesc")}</span>
                    </div>
                    <div role="group" aria-labelledby="print-bleed" className="flex rounded-full border border-border bg-subtle p-0.5">
                      {PRINT_BLEEDS.map((b) => (
                        <button
                          key={b}
                          type="button"
                          aria-pressed={settings.bleed === b}
                          onClick={() => set({ bleed: b })}
                          className="min-h-8 flex-1 cursor-pointer rounded-full text-[0.8125rem] font-semibold text-secondary-foreground aria-pressed:bg-surface aria-pressed:text-foreground aria-pressed:shadow-segment"
                        >
                          {b ? `${b} mm` : t("tech.none")}
                        </button>
                      ))}
                    </div>
                  </div>
                  <label className="flex min-h-10 cursor-pointer items-center gap-2.5 text-body">
                    <input
                      type="checkbox"
                      className="size-4.5 accent-primary"
                      checked={settings.cropMarks}
                      onChange={(e) => set({ cropMarks: e.target.checked })}
                    />
                    {t("tech.marks")}
                  </label>
                  <label className="flex min-h-10 cursor-not-allowed items-center gap-2.5 text-body opacity-55">
                    <input type="checkbox" className="size-4.5" disabled aria-describedby="k100-hint" />
                    {t("tech.k100")}
                  </label>
                  <span id="k100-hint" className="-mt-2 text-caption text-muted-foreground">
                    {t("tech.k100Hint")}
                  </span>
                  <dl className="mt-1 flex flex-col gap-1.5 border-t border-border pt-3 text-[0.8125rem]">
                    {(
                      [
                        [t("tech.pdf"), t("tech.pdfV")],
                        [t("tech.text"), t("tech.textV")],
                        [
                          t("tech.logo"),
                          preview?.logo
                            ? preview.logo.ppi !== null
                              ? t("tech.logoRaster", { px: preview.logo.px ?? 0, ppi: preview.logo.ppi, mm: preview.logo.mm })
                              : t("tech.logoVector")
                            : t("keys.logoNone"),
                        ],
                        [t("tech.quiet"), t("tech.quietV")],
                        [t("tech.safe"), t("tech.safeV", { mm: Math.round(sizes.safe * 10) / 10 })],
                        [t("tech.intent"), t("tech.intentV")],
                      ] as const
                    ).map(([k, v]) => (
                      <div key={k} className="flex justify-between gap-3">
                        <dt className="text-secondary-foreground">{k}</dt>
                        <dd className="text-right font-semibold">{v}</dd>
                      </div>
                    ))}
                  </dl>
                </div>
              ) : null}
            </div>
          </section>
        </aside>
      </div>
      {confirming ? (
        <span className="sr-only" role="status">
          {t("unlock.pending")}
        </span>
      ) : null}
      {/* Refreshes server data once unlocked (details, badges). */}
      {preview?.unlocked && checkout === "success" ? <RefreshOnce onRefresh={() => router.refresh()} /> : null}
    </div>
  );
}

function RefreshOnce({ onRefresh }: { onRefresh: () => void }) {
  const done = useRef(false);
  useEffect(() => {
    if (done.current) return;
    done.current = true;
    onRefresh();
  }, [onRefresh]);
  return null;
}

function Warn({ title, text, children }: { title: string; text: string; children: React.ReactNode }) {
  return (
    <div role="alert" className="flex flex-col gap-2 rounded-lg bg-warning-soft p-3 text-warning">
      <div className="flex items-start gap-2">
        <AlertTriangleIcon aria-hidden className="mt-0.5 size-4 shrink-0" />
        <span className="flex flex-col">
          <b className="text-[0.875rem]">{title}</b>
          <span className="text-caption text-secondary-foreground">{text}</span>
        </span>
      </div>
      <div className="flex flex-wrap gap-2">{children}</div>
    </div>
  );
}
