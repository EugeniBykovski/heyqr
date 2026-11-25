"use client";

import { ArrowLeftIcon, CircleAlertIcon, LoaderCircleIcon, SaveIcon, SendIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { hostedErrors, type HostedContent, type HostedErrors } from "@/entities/qr";
import { Link, useRouter } from "@/i18n/navigation";
import { publishHostedPage, saveHostedPage } from "@/server/actions/hosted";
import { cn } from "@/shared/lib/utils";
import { Button } from "@/shared/ui/button";
import { contentAside, contentStepGrid } from "./editor-layout";
import { HostedForm } from "./hosted-form";
import type { PdfState } from "./hosted-files";
import { HostedPreview } from "./hosted-preview";

/*
 * QR details → Edit page: the hosted page of a saved code, with the same form and live preview as the editor.
 * "Save draft" stores the draft (visitors don't see it); "Save and publish" stores it and publishes it to the same
 * short link. A failed save or a refused publish leaves the live page as it was. Leaving with unsaved changes warns.
 */
export function HostedPageEditor({
  qrCodeId,
  initial,
  shortLabel,
  signedIn = true,
}: {
  qrCodeId: string;
  initial: HostedContent;
  shortLabel: string;
  signedIn?: boolean;
}) {
  const t = useTranslations("qr.hostedEditor");
  const tHosted = useTranslations("qr.hostedPage");
  const tEd = useTranslations("editor");
  const router = useRouter();
  const [content, setContent] = useState<HostedContent>(initial);
  const [saved, setSaved] = useState<HostedContent>(initial);
  const [showErrors, setShowErrors] = useState(false);
  const [serverErrors, setServerErrors] = useState<HostedErrors>({});
  const [pdfState, setPdfState] = useState<PdfState>({ status: "idle" });
  const [couponPreview, setCouponPreview] = useState<"valid" | "expired">("valid");
  const [pending, start] = useTransition();
  const dirty = JSON.stringify(content) !== JSON.stringify(saved);
  const errors = useMemo(() => {
    const e = { ...hostedErrors(content), ...serverErrors };
    if (content.type === "pdf" && (pdfState.status === "uploading" || pdfState.status === "processing")) e.file = "pdfUploading";
    return e;
  }, [content, serverErrors, pdfState.status]);
  const count = showErrors ? Object.keys(errors).length : 0;

  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const save = (publish: boolean) =>
    start(async () => {
      setServerErrors({});
      if (publish && Object.keys(errors).length) {
        setShowErrors(true);
        window.setTimeout(() => document.querySelector<HTMLElement>("form [aria-invalid=true]")?.focus(), 50);
        return;
      }
      const result = await saveHostedPage(qrCodeId, content).catch(() => ({ ok: false, error: "failed" }) as const);
      if (!result.ok) return void toast.error(t("saveFailed"), { id: "hosted-save" });
      setContent(result.data.content);
      setSaved(result.data.content);
      if (!publish) {
        toast.success(t("saved"), { id: "hosted-save" });
        return router.refresh();
      }
      const published = await publishHostedPage(qrCodeId).catch(() => ({ ok: false, error: "failed" }) as const);
      if (published.ok) toast.success(published.data.unchanged ? tHosted("unchanged") : tHosted("published"), { id: "hosted-save" });
      else if (published.error === "rules") {
        setServerErrors(published.errors);
        setShowErrors(true);
        toast.error(tHosted("rules"), { id: "hosted-save" });
      } else toast.error(tHosted("failed"), { id: "hosted-save" });
      router.refresh();
    });

  return (
    <div className={cn("group/step", contentStepGrid, "px-0 sm:px-0 lg:px-0")}>
      <form
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          save(false);
        }}
        aria-labelledby="hosted-editor-title"
        className="flex min-w-0 flex-col gap-4.5"
      >
        <Button asChild variant="ghost" size="sm" className="self-start">
          <Link href={`/dashboard/qr/${qrCodeId}`}>
            <ArrowLeftIcon aria-hidden />
            {t("back")}
          </Link>
        </Button>
        <header className="flex flex-col gap-1.5">
          <h1 id="hosted-editor-title" className="text-h1">
            {t("title")}
          </h1>
          <p className="text-secondary-foreground">{t("lead")}</p>
        </header>
        <details className="rounded-lg border border-border bg-surface p-3 lg:hidden">
          <summary className="cursor-pointer text-label">{tEd("hosted.previews")}</summary>
          <div className="pt-4">
            <HostedPreview
              content={content}
              shortLabel={shortLabel}
              forceExpired={content.type === "coupon" && couponPreview === "expired"}
            />
          </div>
        </details>
        <HostedForm
          content={content}
          onChange={(c) => {
            setServerErrors({});
            setContent(c);
          }}
          errors={showErrors ? errors : {}}
          signedIn={signedIn}
          pdfState={pdfState}
          onPdfState={setPdfState}
          couponPreview={couponPreview}
          onCouponPreview={setCouponPreview}
        />
        {count ? (
          <div role="alert" className="flex items-start gap-3 rounded-md bg-danger-soft px-3.5 py-3 text-[0.875rem] text-danger">
            <CircleAlertIcon aria-hidden className="mt-0.5 size-4 shrink-0" />
            <span>{count === 1 ? tEd("contentStep.errorsOne") : tEd("contentStep.errorsMany", { count })}</span>
          </div>
        ) : null}
        <div className="sticky bottom-0 flex flex-wrap items-center gap-2 border-t border-border bg-page py-3">
          {dirty ? <span className="text-caption text-muted-foreground">{t("unsaved")}</span> : null}
          <span className="grow" />
          <Button type="submit" variant="secondary" disabled={pending}>
            {pending ? <LoaderCircleIcon aria-hidden className="animate-spin" /> : <SaveIcon aria-hidden />}
            {pending ? t("saving") : t("save")}
          </Button>
          <Button type="button" variant="primary" disabled={pending} onClick={() => save(true)}>
            <SendIcon aria-hidden />
            {t("publish")}
          </Button>
        </div>
      </form>
      <aside aria-label={tEd("afterScanning.label")} className={contentAside}>
        <div className="flex flex-col items-center gap-4">
          <HostedPreview
            content={content}
            shortLabel={shortLabel}
            forceExpired={content.type === "coupon" && couponPreview === "expired"}
          />
        </div>
      </aside>
    </div>
  );
}
