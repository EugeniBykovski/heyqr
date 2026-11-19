"use client";

import { composeLayout, layoutCapacity } from "@heyqr/qr-core";
import { ArrowLeftIcon, CheckIcon, LoaderCircleIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { designSettingsOf, designToLayout, type EditorDesign } from "@/entities/qr";
import { Link, useRouter } from "@/i18n/navigation";
import { saveLayoutEdit } from "@/server/actions/qr";
import { Button } from "@/shared/ui/button";
import { BottomBarInfo } from "./bottom-bar";
import { useShownRender } from "./design-canvas";
import { DesignStep } from "./design-step";
import { editorTopBar, editorTopBarInner } from "./editor-layout";

/*
 * HEY-45 "Edit design": the Design editor for one saved layout of an existing code. It starts from the saved settings
 * and keeps its own state: the guest draft of "Create" (localStorage) is never read or written here. The code's
 * content and mode are fixed; the canvas encodes exactly what the printed code holds (`value`). Saving replaces this
 * layout's design only. A failed save keeps every edit and offers Try again.
 */
export function LayoutEditor({
  qrCodeId,
  layoutId,
  layoutName,
  initialDesign,
  value,
  detailsHref,
}: {
  qrCodeId: string;
  layoutId: string;
  layoutName: string;
  initialDesign: EditorDesign;
  /** What the printed code encodes: the payload of a static code, the short link of a dynamic one. */
  value: string;
  detailsHref: string;
}) {
  const t = useTranslations("editor");
  const tEdit = useTranslations("editor.edit");
  const tErrors = useTranslations("errors");
  const router = useRouter();
  const [design, setDesign] = useState(initialDesign);
  const [saved, setSaved] = useState(initialDesign);
  const [saving, startSaving] = useTransition();
  const patch = (p: Partial<EditorDesign>) => setDesign((d) => ({ ...d, ...p }));

  const layout = useMemo(() => designToLayout(design), [design]);
  const capacity = useMemo(() => layoutCapacity(layout, value), [layout, value]);
  const tooLong = capacity.ok ? null : capacity;
  const shown = useShownRender(layout, value);
  const scan = useMemo(
    () => (layoutCapacity(shown.layout, shown.value).ok ? composeLayout(shown.layout, shown.value).scan : null),
    [shown.layout, shown.value],
  );
  const changed = design !== saved;

  const [invalidFields, setInvalidFields] = useState<string[]>([]);
  const [showFieldErrors, setShowFieldErrors] = useState(false);
  const onFieldValidity = useCallback(
    (id: string, valid: boolean) =>
      setInvalidFields((cur) => (valid ? (cur.includes(id) ? cur.filter((x) => x !== id) : cur) : cur.includes(id) ? cur : [...cur, id])),
    [],
  );

  const save = () => {
    const firstInvalid = invalidFields[0];
    if (firstInvalid) {
      setShowFieldErrors(true);
      document.getElementById(firstInvalid)?.focus();
      return;
    }
    // The scan check shown may still describe earlier settings; save only what passes now.
    if (tooLong || !composeLayout(layout, value).scan.ok) return;
    const submitted = design;
    startSaving(async () => {
      // A lost connection rejects the call instead of returning an error: treat it the same, keeping every edit.
      const result = await saveLayoutEdit({ qrCodeId, layoutId, layout, editor: designSettingsOf(submitted) }).catch(
        () => ({ ok: false, error: "failed" }) as const,
      );
      if (!result.ok) {
        const message =
          result.error === "not_found"
            ? tEdit("notFound")
            : result.error === "unauthorized" || result.error === "too_long"
              ? tErrors(result.error)
              : tEdit("failed");
        toast.error(message, { id: "layout-save", action: { label: tEdit("retry"), onClick: save } });
        return;
      }
      setSaved(submitted);
      toast.success(tEdit("saved"), { id: "layout-save" });
      router.push(detailsHref);
    });
  };

  const saveButton = (size: "sm" | "md", className?: string) => (
    <Button
      variant="primary"
      size={size}
      className={className}
      disabled={saving || !scan?.ok || Boolean(tooLong)}
      aria-busy={saving || undefined}
      onClick={save}
    >
      {saving ? <LoaderCircleIcon aria-hidden className="animate-spin" /> : <CheckIcon aria-hidden />}
      {saving ? t("saving") : tEdit("save")}
    </Button>
  );

  return (
    <div className="flex flex-col">
      <div className={editorTopBar}>
        <div className={editorTopBarInner}>
          <div className="flex min-w-0 flex-1">
            <Button asChild variant="ghost" size="sm">
              <Link href={detailsHref}>
                <ArrowLeftIcon aria-hidden />
                <span className="max-sm:sr-only">{tEdit("back")}</span>
              </Link>
            </Button>
          </div>
          <p className="min-w-0 truncate text-label">
            {tEdit("title", { layout: layoutName })}
            {changed ? <span className="ml-2 text-caption text-muted-foreground">{tEdit("unsaved")}</span> : null}
          </p>
          <div className="flex min-w-0 flex-1 items-center justify-end">{saveButton("sm", "max-sm:hidden")}</div>
        </div>
      </div>
      <DesignStep
        design={design}
        onChange={patch}
        title={`${design.name} · ${layoutName}`}
        shown={shown}
        scan={scan}
        tooLong={tooLong}
        showFieldErrors={showFieldErrors}
        onFieldValidity={onFieldValidity}
        action={saveButton}
        bottomInfo={<BottomBarInfo title={layoutName} hint={tEdit("hint")} />}
        note={tEdit("note")}
      />
    </div>
  );
}
