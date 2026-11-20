"use client";

import { layoutGeometry, pngPixelSize, type Layout, type QrCapacity, type ScanReport } from "@heyqr/qr-core";
import { Maximize2Icon, Redo2Icon, Undo2Icon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { brandColorPatch, brandLookPatch, designToLayout, QrPreview, type EditorDesign } from "@/entities/qr";
import { cn } from "@/shared/lib/utils";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/shared/ui/dialog";
import { Stage, StageBar, StageCanvas, StageFoot, type StageTone } from "@/shared/ui/stage";
import { BottomBar } from "./bottom-bar";
import { SAMPLE_LOGO } from "@/entities/qr";
import { DesignCanvas } from "./design-canvas";
import { DesignSettings, type DesignGroup } from "./design-settings";
import { editorPanel, editorRoot, editorStage } from "./editor-layout";
import { ScanStatus, type ScanFix } from "./scan-status";
import { TooLongNotice } from "./too-long-notice";
import { useDesignHistory } from "./use-design-history";
import { useStageView } from "./use-stage-view";

/** CSS px per mm: "Actual size" shows print layouts at their physical size on a standard 96 dpi screen. */
const CSS_PX_PER_MM = 96 / 25.4;

/** Layout, QR and file dimensions of what the canvas shows (design 1.6 stage footer): the export's own sizes. */
export function layoutDims(layout: Layout) {
  const g = layoutGeometry(layout);
  const n = (v: number) => (layout.unit === "mm" ? Math.round(v * 10) / 10 : Math.round(v));
  const file = pngPixelSize(layout);
  return {
    // Design 1.8: "Layout 90 mm × 50 mm · QR 35 × 35 mm · File PNG 1063 × 591 px".
    layout: `${n(g.width)} ${layout.unit} × ${n(g.height)} ${layout.unit}`,
    qr: `${n(g.qr[2])} × ${n(g.qr[2])} ${layout.unit}`,
    file: `PNG ${file.width} × ${file.height} px`,
    actual:
      layout.unit === "mm"
        ? { width: `${g.width * CSS_PX_PER_MM}px`, height: `${g.height * CSS_PX_PER_MM}px` }
        : { width: `${g.width}px`, height: `${g.height}px` },
  };
}

/*
 * Design "editor · Design" (1.6–1.16): the stage (layout name, Undo / Redo, canvas background, Fit / Actual size,
 * dimensions, scan check, the step's action) and the grouped design settings. Shared by creating a code (QrEditor) and
 * editing a saved layout (LayoutEditor, HEY-45), so both edit with exactly the same controls, checks and rendering.
 * The editor that owns the state passes `onChange`; every control, preset, fix and Undo goes through it.
 */
export function DesignStep({
  design,
  onChange,
  title,
  shown,
  scan,
  tooLong,
  onEditContent,
  showFieldErrors,
  onFieldValidity,
  action,
  bottomInfo,
  note,
  offerChooser = false,
  stageTitle,
  panelHead,
  initialGroup,
}: {
  design: EditorDesign;
  onChange: (patch: Partial<EditorDesign>) => void;
  title: string;
  /** What the canvas shows (useShownRender). */
  shown: { layout: Layout; value: string; rebuilding: boolean };
  scan: ScanReport | null;
  tooLong: QrCapacity | null;
  onEditContent?: () => void;
  showFieldErrors: boolean;
  onFieldValidity: (id: string, valid: boolean) => void;
  /** The step's main action (Export, or Save when editing), rendered at the given size. */
  action: (size: "md", className?: string) => ReactNode;
  bottomInfo: ReactNode;
  note: string;
  /** New codes ask Custom or Branded first (design 2.4); a saved layout opens straight in the workspace. */
  offerChooser?: boolean;
  /** Replaces the stage bar title, e.g. the layouts of a saved code as tabs (design "ltabs"). */
  stageTitle?: ReactNode;
  /** Shown above the settings, e.g. the layout name (Edit design). */
  panelHead?: ReactNode;
  /** The settings group to open first, e.g. Size when coming from "Set up for print" (Edit design ?group=size). */
  initialGroup?: DesignGroup;
}) {
  const t = useTranslations("editor");
  const ts = useTranslations("editor.stage");
  const history = useDesignHistory(design, onChange);
  const view = useStageView();
  const [group, setGroup] = useState<DesignGroup>(initialGroup ?? (design.designMode === "branded" ? "brand" : "layout"));
  // Design 2.6 / 5.3: while an image is read, the last ready design stays and the canvas says what is happening.
  const [brandBusy, setBrandBusy] = useState(false);
  const tm = useTranslations("editor.designMode");
  const chooseMode = (mode: "custom" | "branded") => {
    // Only the mode changes: content, colours and every other setting stay (switching never loses work).
    history.change({ designMode: mode });
    setGroup(mode === "branded" ? "brand" : "layout");
  };
  const [full, setFull] = useState(false);
  const expandRef = useRef<HTMLButtonElement>(null);
  const dims = layoutDims(shown.layout);
  const notice = useCallback((message: string) => toast(message, { id: "design-notice" }), []);
  const fix = (f: ScanFix) => history.change(f.kind === "reduceLogo" ? { logoSize: f.size } : { eye: design.fg, eyeIn: design.fg });

  const historyButtons = (
    <div
      role="group"
      aria-label={ts("history")}
      className="inline-flex flex-none gap-0.5 rounded-full border border-border bg-subtle p-0.5"
    >
      <Button
        type="button"
        size="icon-sm"
        variant="ghost"
        aria-label={ts("undo")}
        title={ts("undo")}
        disabled={!history.canUndo}
        onClick={history.undo}
      >
        <Undo2Icon aria-hidden />
      </Button>
      <Button
        type="button"
        size="icon-sm"
        variant="ghost"
        aria-label={ts("redo")}
        title={ts("redo")}
        disabled={!history.canRedo}
        onClick={history.redo}
      >
        <Redo2Icon aria-hidden />
      </Button>
    </div>
  );

  const canvas = (
    <DesignCanvas
      layout={shown.layout}
      value={shown.value}
      rebuilding={shown.rebuilding || brandBusy}
      label={t("preview")}
      tooLongLabel={t("tooLong.preview")}
      watermark={t("preview")}
      updatingLabel={brandBusy ? t("brand.readingCanvas") : design.designMode === "branded" ? t("brand.updating") : t("updatingPreview")}
    />
  );

  if (offerChooser && design.designMode === undefined) return <ModeChooser design={design} value={shown.value} onChoose={chooseMode} />;

  return (
    <div className={`${editorRoot} group/step`}>
      <section aria-label={t("preview")} className={editorStage}>
        <Stage className="rounded-xl" tone={view.tone}>
          <StageBar>
            {stageTitle ?? <span className="min-w-0 grow truncate px-1 text-label">{title}</span>}
            <Badge variant={design.model === "dynamic" ? "accent" : "neutral"}>{t(`model.${design.model}`)}</Badge>
            <div className="flex basis-full flex-wrap items-center gap-2 max-sm:hidden lg:basis-auto">
              {historyButtons}
              <Segmented
                label={ts("background")}
                value={view.tone}
                options={["light", "dark", "checker"] as const}
                render={(o) => ts(`bg.${o}`)}
                onChange={view.setTone}
              />
              <Segmented
                label={ts("scale")}
                value={view.fit}
                options={["fit", "actual"] as const}
                render={(o) => ts(o)}
                onChange={view.setFit}
              />
            </div>
          </StageBar>
          <div className="relative">
            <StageCanvas actual={view.fit === "actual" ? dims.actual : undefined} className="select-none">
              {canvas}
            </StageCanvas>
            <div className="pointer-events-none absolute inset-x-2 bottom-2 flex items-end justify-between gap-2">
              <span
                className={cn(
                  "rounded-full px-2 py-0.5 text-[0.75rem] font-semibold",
                  view.tone === "dark" ? "bg-white/12 text-ink-200" : "bg-surface/85 text-secondary-foreground",
                )}
              >
                {view.fit === "actual" ? ts("actual") : ts("scaledToFit")}
              </span>
              <span className="pointer-events-auto flex items-center gap-2 lg:hidden">
                {scan ? (
                  <span className="sm:hidden">
                    <ScanStatus report={scan} compact checking={shown.rebuilding} />
                  </span>
                ) : null}
                <Button
                  ref={expandRef}
                  type="button"
                  size="icon-sm"
                  variant="secondary"
                  aria-label={ts("openFull")}
                  onClick={() => setFull(true)}
                >
                  <Maximize2Icon aria-hidden />
                </Button>
              </span>
            </div>
          </div>
          <StageFoot className="max-sm:hidden">
            <Dims dims={dims} />
            {scan ? <ScanStatus report={scan} compact checking={shown.rebuilding} /> : <Badge variant="danger">{t("tooLong.badge")}</Badge>}
            <span className="text-caption text-muted-foreground max-2xl:hidden">{note}</span>
            {action("md", "max-lg:hidden")}
          </StageFoot>
        </Stage>
      </section>

      <section aria-label={t("settings")} className={editorPanel}>
        <h1 className="sr-only">{t("steps.design")}</h1>
        <div className="mb-4 flex items-center justify-between gap-3 sm:hidden">
          <span className="text-label">{t("groups.label")}</span>
          {historyButtons}
        </div>
        {panelHead}
        <div role="group" aria-label={tm("label")} className="mb-5 flex rounded-full border border-border bg-subtle p-0.75">
          {(["custom", "branded"] as const).map((m) => (
            <button
              key={m}
              type="button"
              aria-pressed={(design.designMode ?? "custom") === m}
              onClick={() => chooseMode(m)}
              className="min-h-9 flex-1 cursor-pointer rounded-full px-3 text-label text-secondary-foreground aria-pressed:bg-surface aria-pressed:text-foreground aria-pressed:shadow-segment"
            >
              {tm(m)}
            </button>
          ))}
        </div>
        {tooLong ? (
          <TooLongNotice className="mb-5" capacity={tooLong} onEdit={onEditContent} />
        ) : scan && !scan.ok && !shown.rebuilding ? (
          <div className="mb-5">
            <ScanStatus report={scan} onFix={fix} />
          </div>
        ) : null}
        <DesignSettings
          group={group}
          onGroupChange={setGroup}
          design={design}
          onChange={history.change}
          showFieldErrors={showFieldErrors}
          onFieldValidity={onFieldValidity}
          value={shown.value}
          logoScanMax={scan?.maxLogoSize}
          modules={scan?.modules}
          onNotice={notice}
          onBrandBusy={setBrandBusy}
        />
        <BottomBar className="lg:hidden">
          {bottomInfo}
          {action("md")}
        </BottomBar>
      </section>

      <FullPreview
        open={full}
        onOpenChange={setFull}
        returnFocus={() => expandRef.current?.focus()}
        title={title}
        dims={dims}
        tone={view.tone}
        scan={scan}
        rebuilding={shown.rebuilding}
      >
        {canvas}
      </FullPreview>
    </div>
  );
}

function Dims({ dims }: { dims: ReturnType<typeof layoutDims> }) {
  const t = useTranslations("editor.stage.dims");
  return (
    <div className="flex flex-wrap gap-x-3.5 gap-y-1 text-[0.8125rem] text-secondary-foreground">
      {(["layout", "qr", "file"] as const).map((k) => (
        <span key={k}>
          {t(k)} <b className="font-semibold text-foreground tabular-nums">{dims[k]}</b>
        </span>
      ))}
    </div>
  );
}

function Segmented<T extends string>({
  label,
  value,
  options,
  render,
  onChange,
}: {
  label: string;
  value: T;
  options: readonly T[];
  render: (o: T) => string;
  onChange: (o: T) => void;
}) {
  return (
    <div role="group" aria-label={label} className="inline-flex flex-none rounded-full border border-border bg-subtle p-0.5">
      {options.map((o) => (
        <button
          key={o}
          type="button"
          aria-pressed={o === value}
          onClick={() => onChange(o)}
          className="min-h-8 cursor-pointer rounded-full px-2.5 text-[0.8125rem] font-semibold text-secondary-foreground aria-pressed:bg-surface aria-pressed:text-foreground aria-pressed:shadow-segment"
        >
          {render(o)}
        </button>
      ))}
    </div>
  );
}

/*
 * Design 1.10: on phones and tablets the compact preview opens full screen with the same layout, its dimensions and
 * the scan check. Done closes it; the editor state is untouched (the dialog only shows the same canvas).
 */
function FullPreview({
  open,
  onOpenChange,
  title,
  dims,
  tone,
  scan,
  rebuilding,
  returnFocus,
  children,
}: {
  open: boolean;
  /** Focus goes back to the button that opened the preview. */
  returnFocus: () => void;
  onOpenChange: (open: boolean) => void;
  title: string;
  dims: ReturnType<typeof layoutDims>;
  tone: StageTone;
  scan: ScanReport | null;
  rebuilding: boolean;
  children: ReactNode;
}) {
  const ts = useTranslations("editor.stage");
  const tCommon = useTranslations("common");
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        closeLabel={tCommon("close")}
        onCloseAutoFocus={(e) => {
          e.preventDefault();
          returnFocus();
        }}
        className="max-sm:h-[100dvh] max-sm:max-h-none max-sm:rounded-none max-sm:before:hidden sm:top-6 sm:w-[min(100%-2rem,56rem)]"
      >
        <DialogTitle className="text-h3">{ts("fullTitle")}</DialogTitle>
        <DialogDescription className="truncate">{title}</DialogDescription>
        <Stage tone={tone} className="min-h-0 grow">
          <StageCanvas height="min(70dvh, 40rem)">{children}</StageCanvas>
        </Stage>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Dims dims={dims} />
          {scan ? <ScanStatus report={scan} compact checking={rebuilding} /> : null}
        </div>
        <Button type="button" variant="primary" onClick={() => onOpenChange(false)}>
          {ts("done")}
        </Button>
      </DialogContent>
    </Dialog>
  );
}

/*
 * Design 2.4 "How do you want to design it?": two large examples of the same code. Custom keeps the current design;
 * Branded opens the Brand group to start from a logo or image. Either can be switched later without losing content.
 */
function ModeChooser({ design, value, onChoose }: { design: EditorDesign; value: string; onChoose: (mode: "custom" | "branded") => void }) {
  const t = useTranslations("editor.designMode");
  const custom = designToLayout(design);
  const branded = designToLayout({
    ...design,
    ...brandColorPatch({ primary: "#1F4D3A", bg: "#F7F1E6", accent: "#C8643B" }),
    logo: { kind: "image", href: SAMPLE_LOGO },
    brand: { palette: ["#1F4D3A", "#F7F1E6", "#C8643B", "#8DB596"] },
    ...brandLookPatch(
      { ...design, brand: { palette: ["#1F4D3A", "#F7F1E6", "#C8643B", "#8DB596"] }, fg: "#1F4D3A", bg: "#F7F1E6", eyeIn: "#C8643B" },
      "art",
    ),
  });
  const card = (mode: "custom" | "branded", layout: typeof custom, badge?: string) => (
    <button
      type="button"
      onClick={() => onChoose(mode)}
      className="flex cursor-pointer flex-col gap-4 rounded-2xl border border-border bg-surface p-4 text-left shadow-1 transition-[border-color,box-shadow] duration-(--motion-fast) hover:border-violet-300 hover:shadow-2 sm:p-5"
    >
      <span className="grid h-56 place-items-center rounded-xl bg-stage bg-[radial-gradient(var(--color-stage-dot)_1px,transparent_1.3px)] bg-size-[18px_18px] p-4 sm:h-64">
        <QrPreview layout={layout} value={value} label="" className="size-full" />
      </span>
      <span className="flex flex-col gap-1">
        <span className="flex flex-wrap items-center gap-2">
          <span className="text-h2">{t(mode === "custom" ? "customTitle" : "brandedTitle")}</span>
          {badge ? <Badge variant="accent">{badge}</Badge> : null}
        </span>
        <span className="text-secondary-foreground">{t(mode === "custom" ? "customText" : "brandedText")}</span>
      </span>
    </button>
  );
  return (
    <main className="mx-auto flex w-full max-w-page flex-col gap-6 px-4 py-8 sm:px-6 lg:py-12">
      <header className="flex max-w-measure flex-col gap-2">
        <h1 className="text-h1">{t("chooseTitle")}</h1>
        <p className="text-secondary-foreground">{t("chooseLead")}</p>
      </header>
      <div className="grid gap-4 md:grid-cols-2">
        {card("custom", custom)}
        {card("branded", branded, t("brandedBadge"))}
      </div>
    </main>
  );
}
