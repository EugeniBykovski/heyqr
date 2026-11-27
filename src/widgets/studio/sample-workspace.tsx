import { encodePayload } from "@heyqr/qr-core";
import { ArrowRightIcon, CheckIcon, LockIcon } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { DEFAULT_DESIGN, designToLayout, QrPreview, type EditorDesign, directContent } from "@/entities/qr";
import { Link } from "@/i18n/navigation";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";

/** Fixed sample codes: made-up content, the same for every visitor, never anyone's data. */
const SAMPLES: { key: "portfolio" | "menu" | "wifi"; model: "static" | "dynamic"; design: Partial<EditorDesign> }[] = [
  {
    key: "portfolio",
    model: "static",
    design: { content: { type: "website", url: "https://anareyes.studio/portfolio" }, pattern: "rounded", fg: "#0D0D12" },
  },
  {
    key: "menu",
    model: "dynamic",
    design: {
      content: { type: "website", url: "https://littlefern.coffee/menu" },
      pattern: "dot",
      eyeFrame: "circle",
      eyeBall: "circle",
      fg: "#1F4D3A",
      bg: "#F7F1E6",
    },
  },
  {
    key: "wifi",
    model: "static",
    design: { content: { type: "wifi", ssid: "Studio Guest", security: "WPA", password: "sample-only" }, pattern: "square", fg: "#1F4E8C" },
  },
];
/** Sample daily scans for the chart (14 days). */
const SAMPLE_SCANS = [4, 6, 3, 8, 7, 11, 9, 6, 12, 10, 14, 9, 13, 16];
const POINTS = ["layouts", "files", "edit", "scans"] as const;

/*
 * Design 6.1 for guests: "Every QR code, in one place." with a clearly labelled sample workspace (fixed made-up codes and
 * scans, the same for every visitor; no private data and nothing cached per user), Start 7-day free trial (sign in, then
 * the trial page), sign-in and create actions. Signed-in visitors see their own Studio.
 */
export async function SampleWorkspace() {
  const t = await getTranslations("home.workspace");
  const max = Math.max(...SAMPLE_SCANS);
  const total = SAMPLE_SCANS.reduce((a, b) => a + b, 0);
  return (
    <section
      aria-labelledby="ws-title"
      className="grid reveal grid-cols-[minmax(0,1fr)] gap-8 py-12 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] lg:items-center lg:gap-14 lg:py-18"
    >
      <div className="flex flex-col gap-4">
        <span className="text-kicker text-accent-text uppercase">{t("kicker")}</span>
        <h2 id="ws-title" className="text-h1x text-balance">
          {t("title")}
        </h2>
        <p className="text-body-lg text-secondary-foreground">{t("lead")}</p>
        <ul className="flex flex-col gap-2">
          {POINTS.map((p) => (
            <li key={p} className="flex items-start gap-2.5 text-body">
              <CheckIcon aria-hidden className="mt-0.5 size-4 shrink-0 text-primary" />
              {t(`points.${p}`)}
            </li>
          ))}
        </ul>
        <div className="flex flex-wrap gap-3 pt-1">
          {/* Design 6.1 guest: the trial needs an account, so it signs in first and opens the trial page, where the
              server says whether this account can still start one. */}
          {/* HEY-187: long translations ("Rozpocznij 7-dniowy darmowy okres próbny") wrap inside the screen. */}
          <Button asChild variant="primary" size="lg" className="h-auto max-w-full shrink py-2.5 text-balance whitespace-normal">
            <Link href="/sign-in?next=/dashboard/trial">{t("startTrial")}</Link>
          </Button>
          <Button asChild size="lg">
            <Link href="/sign-in?next=/dashboard">{t("signIn")}</Link>
          </Button>
          <Button asChild variant="ghost" size="lg">
            <Link href="/create">
              {t("create")}
              <ArrowRightIcon aria-hidden />
            </Link>
          </Button>
        </div>
        <p className="text-caption text-muted-foreground">{t("trialNote")}</p>
      </div>

      <figure
        aria-labelledby="ws-sample"
        className="flex min-w-0 flex-col gap-3 rounded-2xl border border-border bg-surface p-4 shadow-2 sm:p-5"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span id="ws-sample" className="text-label">
            {t("sampleOwner")}
          </span>
          <Badge variant="warning">{t("sampleBadge")}</Badge>
        </div>
        {/* A picture of the workspace: not interactive, never the visitor's own codes. */}
        <div aria-hidden inert className="flex min-w-0 flex-col gap-3">
          <div className="flex gap-1.5 text-[0.8125rem] font-semibold text-secondary-foreground">
            <span className="rounded-full bg-violet-50 px-2.5 py-1 text-violet-800">{t("tabs.all", { count: SAMPLES.length })}</span>
            <span className="rounded-full px-2.5 py-1">
              {t("tabs.static", { count: SAMPLES.filter((s) => s.model === "static").length })}
            </span>
            <span className="rounded-full px-2.5 py-1">
              {t("tabs.dynamic", { count: SAMPLES.filter((s) => s.model === "dynamic").length })}
            </span>
          </div>
          <ul className="flex flex-col divide-y divide-border">
            {SAMPLES.map((s) => {
              const d: EditorDesign = { ...DEFAULT_DESIGN, ...s.design };
              return (
                <li key={s.key} className="flex items-center gap-3 py-2.5">
                  <span className="grid size-12 shrink-0 place-items-center rounded-md border border-border bg-white p-1">
                    <QrPreview layout={designToLayout(d)} value={encodePayload(directContent(d.content))} label="" className="size-full" />
                  </span>
                  <span className="flex min-w-0 flex-col gap-1">
                    <span className="truncate text-label">{t(`samples.${s.key}.name`)}</span>
                    <span className="flex flex-wrap items-center gap-1.5">
                      <Badge variant={s.model === "dynamic" ? "accent" : "neutral"}>{t(`models.${s.model}`)}</Badge>
                      <span className="text-caption text-muted-foreground">{t(`samples.${s.key}.meta`)}</span>
                    </span>
                  </span>
                </li>
              );
            })}
          </ul>
          <div className="flex flex-col gap-2 rounded-lg border border-border bg-subtle p-3">
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-label">{t("scans")}</span>
              <span className="text-h3 tabular-nums">{total}</span>
            </div>
            <div className="flex h-20 items-end gap-1">
              {SAMPLE_SCANS.map((v, i) => (
                <span key={i} className="flex-1 rounded-t-xs bg-violet-300" style={{ height: `${(v / max) * 100}%` }} />
              ))}
            </div>
          </div>
        </div>
        <figcaption className="flex items-start gap-2 text-caption text-muted-foreground">
          <LockIcon aria-hidden className="mt-0.5 size-3.5 shrink-0" />
          {t("sampleNote")}
        </figcaption>
      </figure>
    </section>
  );
}
