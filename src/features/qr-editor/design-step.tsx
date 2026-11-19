"use client";

import type { Layout, QrCapacity, ScanReport } from "@heyqr/qr-core";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import type { EditorDesign } from "@/entities/qr";
import { Badge } from "@/shared/ui/badge";
import { Stage, StageBar, StageCanvas, StageFoot } from "@/shared/ui/stage";
import { BottomBar } from "./bottom-bar";
import { DesignCanvas } from "./design-canvas";
import { DesignPanel } from "./design-panel";
import { editorPanel, editorRoot, editorStage } from "./editor-layout";
import { FramePanel } from "./frame-panel";
import { ScanStatus } from "./scan-status";
import { SizePanel } from "./size-panel";
import { TooLongNotice } from "./too-long-notice";

/*
 * Design "editor · Design": the canvas and the design settings. Shared by creating a code (QrEditor) and editing a
 * saved layout (LayoutEditor, HEY-45), so both edit with exactly the same controls, checks and rendering.
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
}) {
  const t = useTranslations("editor");
  return (
    <div className={`${editorRoot} group/step`}>
      <section aria-label={t("preview")} className={editorStage}>
        <Stage className="rounded-xl">
          <StageBar>
            <span className="min-w-0 grow truncate px-1 text-label">{title}</span>
            <Badge variant={design.model === "dynamic" ? "accent" : "neutral"}>{t(`model.${design.model}`)}</Badge>
          </StageBar>
          <StageCanvas className="select-none">
            <DesignCanvas
              layout={shown.layout}
              value={shown.value}
              rebuilding={shown.rebuilding}
              label={t("preview")}
              tooLongLabel={t("tooLong.preview")}
              watermark={t("preview")}
              updatingLabel={t("updatingPreview")}
            />
          </StageCanvas>
          <StageFoot>
            {scan ? <ScanStatus report={scan} compact /> : <Badge variant="danger">{t("tooLong.badge")}</Badge>}
            <span className="text-caption text-muted-foreground max-lg:hidden">{note}</span>
            {action("md", "max-lg:hidden")}
          </StageFoot>
        </Stage>
      </section>

      <section aria-label={t("settings")} className={editorPanel}>
        <h1 className="sr-only">{t("steps.design")}</h1>
        {tooLong ? (
          <TooLongNotice className="mb-5" capacity={tooLong} onEdit={onEditContent} />
        ) : scan && !scan.ok ? (
          <div className="mb-5">
            <ScanStatus report={scan} onReduceLogo={(logoSize) => onChange({ logoSize })} />
          </div>
        ) : null}
        <div className="flex flex-col gap-8">
          <DesignPanel
            design={design}
            onChange={onChange}
            showColorErrors={showFieldErrors}
            onColorValidity={onFieldValidity}
            logoScanMax={scan?.maxLogoSize}
          />
          <section aria-labelledby="design-frame" className="flex flex-col gap-4 border-t border-border pt-6">
            <h2 id="design-frame" className="text-h3">
              {t("frameGroup")}
            </h2>
            <FramePanel design={design} onChange={onChange} onValidity={onFieldValidity} />
          </section>
          <section aria-labelledby="design-size" className="flex flex-col gap-4 border-t border-border pt-6">
            <h2 id="design-size" className="text-h3">
              {t("size.title")}
            </h2>
            <SizePanel design={design} onChange={onChange} showErrors={showFieldErrors} onValidity={onFieldValidity} />
          </section>
        </div>
        <BottomBar className="lg:hidden">
          {bottomInfo}
          {action("md")}
        </BottomBar>
      </section>
    </div>
  );
}
