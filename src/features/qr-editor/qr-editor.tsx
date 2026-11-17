"use client";

import { composeLayout, encodePayload } from "@heyqr/qr-core";
import { ArrowRightIcon, LoaderCircleIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useEffectEvent, useMemo, useRef, useTransition } from "react";
import { toast } from "sonner";
import { env } from "@/env";
import { designToLayout, isContentComplete, QrPreview, type EditorDesign } from "@/entities/qr";
import { useRouter } from "@/i18n/navigation";
import { saveDraft } from "@/server/actions/qr";
import { cn } from "@/shared/lib/utils";
import { Button } from "@/shared/ui/button";
import { Card } from "@/shared/ui/card";
import { Field } from "@/shared/ui/field";
import { Input } from "@/shared/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/shared/ui/tabs";
import { ContentForm } from "./content-form";
import { DesignPanel } from "./design-panel";
import { FramePanel } from "./frame-panel";
import { ScanStatus } from "./scan-status";
import { clearDraft, useDraft } from "./use-draft";

/** Placeholder encoded in dynamic previews: the real short code is assigned when the plan starts. */
const DYNAMIC_PREVIEW_CODE = "preview";

export function QrEditor({ signedIn, resume }: { signedIn: boolean; resume: boolean }) {
  const t = useTranslations("editor");
  const tErrors = useTranslations("errors");
  const router = useRouter();
  const { design, setDesign, restored } = useDraft();
  const [saving, startSaving] = useTransition();
  const autoResumed = useRef(false);
  const patch = (p: Partial<EditorDesign>) => setDesign((d) => ({ ...d, ...p }));

  useEffect(() => {
    if (restored && !resume) toast(t("draftRestored"));
  }, [restored, resume, t]);

  const complete = isContentComplete(design.content);
  const value = useMemo(() => {
    if (design.model === "dynamic") return `${env.NEXT_PUBLIC_SHORT_LINK_BASE.replace(/\/$/, "")}/${DYNAMIC_PREVIEW_CODE}`;
    return complete ? encodePayload(design.content) : "https://heyqr.app";
  }, [design.model, design.content, complete]);
  const layout = useMemo(() => designToLayout({ ...design, caption: design.caption || t("captionPlaceholder") }), [design, t]);
  const scan = useMemo(() => composeLayout(layout, value).scan, [layout, value]);

  const download = () =>
    startSaving(async () => {
      if (!signedIn) {
        router.push(`/sign-in?next=${encodeURIComponent("/create?resume=1")}`);
        return;
      }
      const name = design.name.trim() || t("namePlaceholder");
      const destination = design.model === "dynamic" && design.content.type === "website" ? encodePayload(design.content) : undefined;
      const result = await saveDraft({ name, model: design.model, content: design.content, destination, layouts: [{ name, layout }] });
      if (!result.ok) {
        toast.error(tErrors(result.error === "unauthorized" || result.error === "invalid" ? result.error : "generic"));
        return;
      }
      clearDraft();
      router.push(`/create/export?qr=${result.data.qrCodeId}&layout=${result.data.layoutIds[0]}`);
    });

  // Coming back from Google sign-in: continue to the export step automatically.
  const continueAfterSignIn = useEffectEvent(() => {
    if (autoResumed.current || !complete || !scan.ok) return;
    autoResumed.current = true;
    download();
  });
  useEffect(() => {
    if (resume && signedIn && restored) continueAfterSignIn();
  }, [resume, signedIn, restored]);

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(20rem,26rem)] lg:items-start">
      <Card className="order-2 lg:order-1">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="qr-name" label={t("name")}>
            <Input
              id="qr-name"
              value={design.name}
              maxLength={80}
              placeholder={t("namePlaceholder")}
              onChange={(e) => patch({ name: e.target.value })}
            />
          </Field>
          <fieldset className="flex flex-col gap-1.5">
            <legend className="mb-1.5 text-label">{t("model.label")}</legend>
            <div className="grid grid-cols-2 gap-1 rounded-full bg-subtle p-1">
              {(["static", "dynamic"] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  aria-pressed={design.model === m}
                  title={t(`model.${m}Hint`)}
                  onClick={() => patch({ model: m })}
                  className={cn(
                    "min-h-9 cursor-pointer rounded-full text-label text-secondary-foreground",
                    design.model === m && "bg-surface text-foreground shadow-1",
                  )}
                >
                  {t(`model.${m}`)}
                </button>
              ))}
            </div>
            <p className="text-caption text-muted-foreground">{t(`model.${design.model}Hint`)}</p>
          </fieldset>
        </div>
        <Tabs defaultValue="content">
          <TabsList>
            <TabsTrigger value="content">{t("steps.content")}</TabsTrigger>
            <TabsTrigger value="design">{t("steps.design")}</TabsTrigger>
            <TabsTrigger value="frame">{t("steps.frame")}</TabsTrigger>
          </TabsList>
          <TabsContent value="content">
            <ContentForm content={design.content} onChange={(content) => patch({ content })} />
          </TabsContent>
          <TabsContent value="design">
            <DesignPanel design={design} onChange={patch} />
          </TabsContent>
          <TabsContent value="frame">
            <FramePanel design={design} onChange={patch} />
          </TabsContent>
        </Tabs>
      </Card>

      <aside
        aria-label={t("preview")}
        className="order-1 flex flex-col gap-4 lg:sticky lg:top-[calc(var(--spacing-header)+1.5rem)] lg:order-2"
      >
        <Card className="items-center gap-5">
          <div className="relative w-full overflow-hidden rounded-lg bg-stage p-6 select-none">
            <QrPreview layout={layout} value={value} label={t("preview")} className="mx-auto aspect-square max-w-80" />
            <span
              aria-hidden
              className="pointer-events-none absolute inset-0 grid -rotate-30 place-items-center text-h1 font-bold tracking-[0.3em] text-ink-950/7 uppercase"
            >
              {t("preview")}
            </span>
          </div>
          <ScanStatus report={scan} />
          <Button variant="primary" size="lg" className="w-full" disabled={!complete || !scan.ok || saving} onClick={download}>
            {saving ? <LoaderCircleIcon aria-hidden className="animate-spin" /> : null}
            {saving ? t("saving") : t("download")}
            {!saving ? <ArrowRightIcon aria-hidden /> : null}
          </Button>
          <p className="text-center text-caption text-muted-foreground">{t("previewNote")}</p>
        </Card>
      </aside>
    </div>
  );
}
