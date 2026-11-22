"use client";

import { encodePayload, layoutCapacity, type QrContentType } from "@heyqr/qr-core";
import { ArrowLeftIcon, ArrowRightIcon, LoaderCircleIcon } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Tabs as TabsPrimitive } from "radix-ui";
import { useCallback, useEffect, useEffectEvent, useMemo, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { env } from "@/env";
import {
  composeShared,
  contentDisplayName,
  DEFAULT_DESIGN,
  designSettingsOf,
  designToLayout,
  emptyContent,
  isContentComplete,
  modeFor,
  type EditorDesign,
} from "@/entities/qr";
import { Link, useRouter } from "@/i18n/navigation";
import { saveDraft } from "@/server/actions/qr";
import { formatMoney } from "@/shared/config/catalog";
import { usePrices } from "@/shared/lib/currency";
import { Button } from "@/shared/ui/button";
import { BottomBarInfo } from "./bottom-bar";
import { ContentStep } from "./content-step";
import { contentErrors } from "./content-validation";
import { useShownRender } from "./design-canvas";
import { DesignStep } from "./design-step";
import { editorTopBar, editorTopBarInner } from "./editor-layout";
import { EditorSteps } from "./editor-steps";
import { TypeStep } from "./type-step";
import { clearDraft, draftClaimKey, useDraft } from "./use-draft";

/** True while no design setting differs from the defaults (content, mode and name aside). */
function isUntouchedDesign(d: EditorDesign): boolean {
  const skip = new Set(["name", "model", "content"]);
  const a = d as unknown as Record<string, unknown>;
  const b = DEFAULT_DESIGN as unknown as Record<string, unknown>;
  const keys = new Set([...Object.keys(a), ...Object.keys(b)].filter((k) => !skip.has(k)));
  return [...keys].every((k) => JSON.stringify(a[k]) === JSON.stringify(b[k]));
}

/** Placeholder encoded in dynamic previews: the real short code is assigned when the plan starts. */
const DYNAMIC_PREVIEW_CODE = "preview";
export const EDITOR_STEPS = ["type", "content", "design"] as const;
export type EditorStep = (typeof EDITOR_STEPS)[number];
const isStep = (v: string | null): v is EditorStep => EDITOR_STEPS.includes(v as EditorStep);

/**
 * Design "editor": Type → Content → Design, then Export. The step lives in the URL (?step=), so refresh, browser
 * Back/Forward and reopening land on the same step; the draft itself is the versioned guest draft (use-draft).
 */
export function QrEditor({ signedIn, resume }: { signedIn: boolean; resume: boolean }) {
  const t = useTranslations("editor");
  const tErrors = useTranslations("errors");
  const tTypes = useTranslations("contentTypes");
  const router = useRouter();
  const params = useSearchParams();
  const { design, setDesign, restored, unreadable, modeAdjusted } = useDraft();
  const urlStep = params.get("step");
  const step: EditorStep = resume ? "design" : isStep(urlStep) ? urlStep : "type";
  const [showErrors, setShowErrors] = useState(false);
  const [saving, startSaving] = useTransition();
  const autoResumed = useRef(false);
  const patch = (p: Partial<EditorDesign>) => setDesign((d) => ({ ...d, ...p }));

  useEffect(() => {
    // Fixed id: shown once even when the effect runs twice (React Strict Mode in development).
    if (restored && !resume) toast(t("draftRestored"), { id: "draft-restored" });
    // A malformed draft or one from a newer version is kept aside, not overwritten; the editor starts fresh.
    if (unreadable) toast(t("draftUnreadable"), { id: "draft-unreadable" });
    // A draft from an earlier build had Dynamic on a type that can't redirect; it was kept as Static.
    if (modeAdjusted) toast(t("mode.adjusted"), { id: "mode-adjusted" });
  }, [restored, unreadable, modeAdjusted, resume, t]);

  const errors = useMemo(() => contentErrors(design.content), [design.content]);
  // An empty caption hides the caption (HEY-43); preview and export render exactly the accepted text.
  const layout = useMemo(() => designToLayout(design), [design]);
  // What the printed code actually holds: the short link for dynamic codes, the serialized content (escaping,
  // vCard folding, UTF-8) for static ones. Capacity is checked on exactly this value with this layout's ECL (HEY-24).
  const encoded = useMemo(
    () =>
      design.model === "dynamic"
        ? `${env.NEXT_PUBLIC_SHORT_LINK_BASE.replace(/\/$/, "")}/${DYNAMIC_PREVIEW_CODE}`
        : encodePayload(design.content),
    [design.model, design.content],
  );
  const capacity = useMemo(() => layoutCapacity(layout, encoded), [layout, encoded]);
  const tooLong = capacity.ok ? null : capacity;
  const complete = isContentComplete(design.content) && Object.keys(errors).length === 0 && !tooLong;
  const value = design.model === "dynamic" || complete || tooLong ? encoded : "https://heyqr.app";
  // HEY-41: the canvas and its scan check render deferred, so settings stay responsive and the canvas keeps its last
  // finished render while a newer one is built. React discards a deferred render that newer settings overtake.
  const { layout: shownLayout, value: shownValue, rebuilding } = useShownRender(layout, value);
  const scan = useMemo(
    () => (layoutCapacity(shownLayout, shownValue).ok ? composeShared(shownLayout, shownValue).scan : null),
    [shownLayout, shownValue],
  );
  const prices = usePrices();
  const priceCents = design.model === "dynamic" ? prices.cents.starter : prices.cents.single;
  const price = formatMoney(priceCents, prices.currency);
  const canDownload = complete && Boolean(scan?.ok) && !saving;

  /** Steps are URL state: pushState keeps browser Back working without a server round trip. */
  const goTo = (next: EditorStep) => {
    const url = new URL(window.location.href);
    url.searchParams.set("step", next);
    url.searchParams.delete("resume");
    window.history.pushState(null, "", url);
    window.scrollTo({ top: 0 });
  };

  /** Content must be valid before Design; otherwise show the errors and focus the first one. */
  const toDesign = () => {
    const keys = Object.keys(errors);
    if (keys.length === 0 && !tooLong) return goTo("design");
    if (keys.length === 0) {
      // Too long: stay on Content, where the notice says what to shorten; focus the first field to edit.
      if (step !== "content") goTo("content");
      window.setTimeout(() => document.querySelector<HTMLElement>("[id^=content-]:is(input, textarea)")?.focus(), 50);
      return;
    }
    setShowErrors(true);
    if (step !== "content") goTo("content");
    window.setTimeout(() => document.getElementById(`content-${keys[0]}`)?.focus(), 50);
  };

  const requestStep = (target: EditorStep) => (target === "design" ? toDesign() : goTo(target));

  /** A new type keeps the mode when it supports it; otherwise it becomes Static and the user is told. */
  const changeType = (type: QrContentType) => {
    if (type === design.content.type) return;
    const model = modeFor(type, design.model);
    if (model !== design.model) toast(t("mode.switched", { type: tTypes(type) }), { id: "mode-switched" });
    setShowErrors(false);
    patch({ content: emptyContent(type), model });
  };

  // HEY-34 / HEY-35: colour and size fields whose text isn't valid. Export stops there instead of using the previous value.
  const [invalidColors, setInvalidColors] = useState<string[]>([]);
  const [showColorErrors, setShowColorErrors] = useState(false);
  const onColorValidity = useCallback(
    (id: string, valid: boolean) =>
      setInvalidColors((cur) => (valid ? (cur.includes(id) ? cur.filter((x) => x !== id) : cur) : cur.includes(id) ? cur : [...cur, id])),
    [],
  );

  const download = () => {
    // The scan check shown may still describe the previous settings; export only what passes now.
    if (!complete || !composeShared(layout, value).scan.ok) return;
    const firstInvalid = invalidColors[0];
    if (firstInvalid) {
      setShowColorErrors(true);
      document.getElementById(firstInvalid)?.focus();
      return;
    }
    startSaving(async () => {
      if (!signedIn) {
        // Design 3.1: a guest first sees the export screen (layout, file, price), then continues with Google.
        router.push("/create/export");
        return;
      }
      const name = design.name.trim() || contentDisplayName(design.content) || t("namePlaceholder");
      const destination = design.model === "dynamic" && design.content.type === "website" ? encodePayload(design.content) : undefined;
      // HEY-77: the draft's claim key makes this save safe to repeat (refresh, retry, second tab): the account gets one
      // code for this draft. A request that fails outright (network, lost response) keeps the draft for a retry.
      const result = await saveDraft({
        name,
        model: design.model,
        content: design.content,
        destination,
        claimKey: draftClaimKey(),
        // HEY-76: the layout keeps the name the guest saw on Export ("Vertical card"); the code keeps its own name.
        layouts: [{ name: t(`presets.${design.preset}`), layout, editor: designSettingsOf(design) }],
      }).catch(() => ({ ok: false as const, error: "generic" as const }));
      if (!result.ok) {
        toast.error(
          tErrors(
            result.error === "unauthorized" || result.error === "invalid" || result.error === "too_long" || result.error === "draft_limit"
              ? result.error
              : "generic",
          ),
        );
        return;
      }
      clearDraft();
      // Back from sign-in (3.3): the export screen opens with the format, size and transparency chosen as a guest.
      const next = new URLSearchParams({ qr: result.data.qrCodeId, layout: result.data.layoutIds[0] ?? "" });
      if (resume) {
        next.set("signedIn", "1");
        for (const k of ["format", "res", "transparent"]) {
          const v = params.get(k);
          if (v) next.set(k, v);
        }
      }
      router.push(`/create/export?${next.toString()}`);
    });
  };

  // Coming back from Google sign-in: continue to the export step automatically.
  const continueAfterSignIn = useEffectEvent(() => {
    if (autoResumed.current || !complete || !scan?.ok) return;
    autoResumed.current = true;
    download();
  });
  useEffect(() => {
    if (resume && signedIn && restored) continueAfterSignIn();
  }, [resume, signedIn, restored]);

  const exportButton = (size: "sm" | "md" | "lg", className?: string) => (
    <Button variant="primary" size={size} className={className} disabled={!canDownload} aria-busy={saving || undefined} onClick={download}>
      {saving ? <LoaderCircleIcon aria-hidden className="animate-spin" /> : null}
      {saving ? t("saving") : t("export")}
      {!saving ? <ArrowRightIcon aria-hidden /> : null}
    </Button>
  );

  const back =
    step === "type" ? (
      <Button asChild variant="ghost" size="sm">
        <Link href="/">
          <ArrowLeftIcon aria-hidden />
          <span className="max-sm:sr-only">{t("backTo.home")}</span>
        </Link>
      </Button>
    ) : (
      <Button variant="ghost" size="sm" onClick={() => goTo(step === "content" ? "type" : "content")}>
        <ArrowLeftIcon aria-hidden />
        <span className="max-sm:sr-only">{t(step === "content" ? "backTo.type" : "backTo.content")}</span>
      </Button>
    );

  return (
    <TabsPrimitive.Root value={step} onValueChange={(v) => requestStep(v as EditorStep)} className="flex flex-col">
      <div className={editorTopBar}>
        <div className={editorTopBarInner}>
          <div className="flex min-w-0 flex-1">{back}</div>
          <EditorSteps label={t("stepsLabel")} current={step} steps={EDITOR_STEPS.map((s) => ({ value: s, label: t(`steps.${s}`) }))} />
          <div className="flex min-w-0 flex-1 items-center justify-end">
            {step === "design" ? (
              exportButton("sm", "max-sm:hidden")
            ) : (
              <span className="text-caption text-muted-foreground max-lg:hidden">{t("previewFrom", { price })}</span>
            )}
          </div>
        </div>
      </div>

      <TabsPrimitive.Content value="type" className="animate-rise outline-none">
        <TypeStep
          type={design.content.type}
          mode={design.model}
          onTypeChange={changeType}
          onModeChange={(model) => patch({ model })}
          onContinue={() => goTo("content")}
        />
      </TabsPrimitive.Content>

      <TabsPrimitive.Content value="content" className="animate-rise outline-none">
        <ContentStep
          content={design.content}
          mode={design.model}
          name={design.name}
          errors={errors}
          showErrors={showErrors}
          tooLong={tooLong}
          onContentChange={(content) => patch({ content })}
          onNameChange={(name) => patch({ name })}
          onBack={() => goTo("type")}
          onContinue={toDesign}
        />
      </TabsPrimitive.Content>

      <TabsPrimitive.Content value="design" className="animate-rise outline-none">
        <DesignStep
          design={design}
          onChange={patch}
          // Design 2.4: a new design asks Custom or Branded first; a draft that already has design work goes straight on.
          offerChooser={design.designMode === undefined && isUntouchedDesign(design)}
          title={design.name.trim() || contentDisplayName(design.content) || t("namePlaceholder")}
          shown={{ layout: shownLayout, value: shownValue, rebuilding }}
          latest={{ layout, value }}
          scan={scan}
          tooLong={tooLong}
          onEditContent={() => goTo("content")}
          showFieldErrors={showColorErrors}
          onFieldValidity={onColorValidity}
          action={exportButton}
          bottomInfo={
            <BottomBarInfo title={t(design.model === "dynamic" ? "pricePerMonth" : "priceOnce", { price })} hint={t("previewFree")} />
          }
          note={t("previewNote")}
        />
      </TabsPrimitive.Content>
    </TabsPrimitive.Root>
  );
}
