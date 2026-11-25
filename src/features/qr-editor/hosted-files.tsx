"use client";

import { CircleAlertIcon, FileTextIcon, ImagePlusIcon, LoaderCircleIcon, RefreshCwIcon, Trash2Icon, UploadIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRef, useState } from "react";
import { formatFileSize, HOSTED_LIMITS, hostedImageSrc, type PdfFile } from "@/entities/qr";
import { cn } from "@/shared/lib/utils";
import { Button } from "@/shared/ui/button";

/*
 * Files of hosted pages in the editor. Photos (JPG or PNG, up to 5 MB) are resized here for phones and kept in the
 * draft as data URLs until the code is saved; the server checks them again and stores them privately. The PDF is
 * uploaded straight away (signed-in owners only) and the server's answer (pages, size) is what the draft keeps.
 */

const PHOTO_ACCEPT = "image/jpeg,image/png,.jpg,.jpeg,.png";
const MAX_EDGE = 1600;

export type PhotoProblem = { key: "photoType" | "photoTooLarge" | "photoUnreadable"; name: string; size?: string };

/** Reads, checks and resizes one photo; JPEG stays JPEG, PNG stays PNG (transparency kept). */
export async function preparePhoto(
  file: File,
  maxEdge = MAX_EDGE,
): Promise<{ ok: true; dataUrl: string } | { ok: false; problem: PhotoProblem }> {
  const head = new Uint8Array(await file.slice(0, 8).arrayBuffer());
  const png = head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4e && head[3] === 0x47;
  const jpeg = head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff;
  if (!png && !jpeg) return { ok: false, problem: { key: "photoType", name: file.name } };
  if (file.size > HOSTED_LIMITS.imageBytes)
    return { ok: false, problem: { key: "photoTooLarge", name: file.name, size: formatFileSize(file.size) } };
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("no canvas");
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const dataUrl = png ? canvas.toDataURL("image/png") : canvas.toDataURL("image/jpeg", 0.86);
    // A resized PNG can still be large; the server limit is on the stored file.
    if (dataUrl.length * 0.75 > HOSTED_LIMITS.imageBytes)
      return { ok: false, problem: { key: "photoTooLarge", name: file.name, size: formatFileSize(dataUrl.length * 0.75) } };
    return { ok: true, dataUrl };
  } catch {
    return { ok: false, problem: { key: "photoUnreadable", name: file.name } };
  }
}

/** One photo slot: add, replace, remove, with the problem shown under it. */
export function PhotoField({
  id,
  label,
  value,
  onChange,
  shape = "square",
  maxEdge,
}: {
  id: string;
  label: string;
  value: string | null;
  onChange: (value: string | null) => void;
  shape?: "square" | "round";
  maxEdge?: number;
}) {
  const t = useTranslations("editor.hosted");
  const input = useRef<HTMLInputElement>(null);
  const [problem, setProblem] = useState<PhotoProblem | null>(null);
  const [busy, setBusy] = useState(false);
  const pick = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    const out = await preparePhoto(file, maxEdge);
    setBusy(false);
    if (!out.ok) return setProblem(out.problem);
    setProblem(null);
    onChange(out.dataUrl);
  };
  return (
    <div className="flex flex-col gap-1.5">
      <span id={`${id}-label`} className="text-label">
        {label}
        <span className="font-normal text-muted-foreground"> · {t("optional")}</span>
      </span>
      <div className="flex items-center gap-3">
        <span
          className={cn(
            "grid size-16 shrink-0 place-items-center overflow-hidden bg-subtle text-icon-muted",
            shape === "round" ? "rounded-full" : "rounded-lg",
          )}
        >
          {value ? (
            // eslint-disable-next-line @next/next/no-img-element -- local preview of the owner's photo
            <img src={hostedImageSrc(value)} alt="" className="size-full object-cover" />
          ) : (
            <ImagePlusIcon aria-hidden className="size-6" />
          )}
        </span>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={busy}
            aria-describedby={problem ? `${id}-error` : undefined}
            onClick={() => input.current?.click()}
          >
            {busy ? <LoaderCircleIcon aria-hidden className="animate-spin" /> : <UploadIcon aria-hidden />}
            {value ? t("photoReplace") : t("photoAdd")}
          </Button>
          {value ? (
            <Button type="button" variant="ghost" size="sm" onClick={() => onChange(null)}>
              <Trash2Icon aria-hidden />
              {t("photoRemove")}
            </Button>
          ) : null}
        </div>
        <input
          ref={input}
          id={id}
          type="file"
          accept={PHOTO_ACCEPT}
          className="sr-only"
          tabIndex={-1}
          aria-labelledby={`${id}-label`}
          onChange={(e) => {
            void pick(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
      </div>
      {problem ? <FileProblem id={`${id}-error`}>{t(problem.key, { name: problem.name, size: problem.size ?? "" })}</FileProblem> : null}
    </div>
  );
}

export function FileProblem({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <p
      id={id}
      className="flex animate-rise items-start gap-1.5 text-caption font-medium text-danger [animation-duration:var(--motion-fast)]"
    >
      <CircleAlertIcon aria-hidden className="mt-0.5 size-3.5 shrink-0" />
      {children}
    </p>
  );
}

/* ── PDF ─────────────────────────────────────────────────────────────────────────────────────────────────────── */

export type PdfState =
  | { status: "idle" }
  | { status: "uploading"; name: string; pct: number }
  | { status: "processing"; name: string }
  | { status: "error"; message: string };

type PdfAnswer = { asset: string; name: string; bytes: number; pages: number };

/**
 * Design 11.10–11.13: the PDF drop zone and its states (empty, uploading with progress and Cancel, processing,
 * ready with page count and size, failure). Replacing a ready file keeps the draft's current file until the new one
 * is ready; the published page is unaffected until the owner publishes.
 */
export function PdfField({
  file,
  onChange,
  signedIn,
  state,
  onState,
  error,
}: {
  file: PdfFile | null;
  onChange: (file: PdfFile | null) => void;
  signedIn: boolean;
  state: PdfState;
  onState: (s: PdfState) => void;
  /** The form's error for the file (e.g. "Upload a PDF to continue."). */
  error?: string;
}) {
  const t = useTranslations("editor.hosted.pdf");
  const input = useRef<HTMLInputElement>(null);
  const xhr = useRef<XMLHttpRequest | null>(null);
  const [drag, setDrag] = useState(false);

  const upload = (f: File) => {
    if (!signedIn) return onState({ status: "error", message: t("signIn") });
    if (!/\.pdf$/i.test(f.name) && f.type !== "application/pdf")
      return onState({ status: "error", message: t("notPdf", { name: f.name }) });
    if (f.size === 0) return onState({ status: "error", message: t("empty", { name: f.name }) });
    if (f.size > HOSTED_LIMITS.pdfBytes)
      return onState({ status: "error", message: t("tooLarge", { name: f.name, size: formatFileSize(f.size) }) });
    const body = new FormData();
    body.append("file", f);
    const req = new XMLHttpRequest();
    xhr.current = req;
    onState({ status: "uploading", name: f.name, pct: 0 });
    req.upload.onprogress = (e) => {
      if (!e.lengthComputable) return;
      const pct = Math.min(99, Math.round((e.loaded / e.total) * 100));
      onState(pct >= 99 ? { status: "processing", name: f.name } : { status: "uploading", name: f.name, pct });
    };
    req.upload.onload = () => onState({ status: "processing", name: f.name });
    req.onerror = () => onState({ status: "error", message: t("failed") });
    req.onload = () => {
      xhr.current = null;
      let data: Partial<PdfAnswer> & { error?: string; pages?: number } = {};
      try {
        data = JSON.parse(req.responseText) as typeof data;
      } catch {
        // fall through to the generic failure
      }
      if (req.status === 200 && data.asset && data.bytes && data.pages) {
        onChange({ asset: data.asset, name: data.name ?? f.name, bytes: data.bytes, pages: data.pages });
        return onState({ status: "idle" });
      }
      const message =
        data.error === "notPdf"
          ? t("notPdf", { name: f.name })
          : data.error === "empty"
            ? t("empty", { name: f.name })
            : data.error === "tooLarge"
              ? t("tooLarge", { name: f.name, size: formatFileSize(f.size) })
              : data.error === "tooManyPages"
                ? t("tooManyPages", { name: f.name, pages: data.pages ?? 0 })
                : data.error === "unauthorized"
                  ? t("signIn")
                  : data.error === "unreadable"
                    ? t("notPdf", { name: f.name })
                    : t("failed");
      onState({ status: "error", message });
    };
    req.open("POST", "/api/hosted/pdf");
    req.send(body);
  };

  const cancel = () => {
    xhr.current?.abort();
    xhr.current = null;
    onState({ status: "idle" });
  };

  const loadSample = async () => {
    const res = await fetch("/samples/spring-class-schedule.pdf").catch(() => null);
    if (!res?.ok) return onState({ status: "error", message: t("failed") });
    const blob = await res.blob();
    upload(new File([blob], "spring-class-schedule.pdf", { type: "application/pdf" }));
  };

  const busy = state.status === "uploading" || state.status === "processing";
  const message = state.status === "error" ? state.message : error;
  const chooser = (
    <input
      ref={input}
      id="hosted-pdf-file"
      type="file"
      accept="application/pdf,.pdf"
      className="sr-only"
      tabIndex={-1}
      onChange={(e) => {
        const f = e.target.files?.[0];
        if (f) upload(f);
        e.target.value = "";
      }}
    />
  );

  return (
    <div className="flex flex-col gap-1.5">
      <span id="hosted-pdf-label" className="text-label">
        {t("file")}
      </span>
      {busy ? (
        <div role="status" className="flex items-center gap-3 rounded-lg border border-border bg-surface p-3.5">
          <FileTextIcon aria-hidden className="size-6 shrink-0 text-muted-foreground" />
          <span className="flex min-w-0 flex-1 flex-col gap-1.5">
            <span className="truncate text-label">{state.name}</span>
            <span className="text-caption text-muted-foreground">
              {state.status === "uploading" ? t("uploading", { pct: state.pct }) : t("processing")}
            </span>
            <span className="h-1.5 overflow-hidden rounded-full bg-subtle">
              <span
                className={cn("block h-full rounded-full bg-primary transition-[width]", state.status === "processing" && "animate-pulse")}
                style={{ width: `${state.status === "uploading" ? state.pct : 100}%` }}
              />
            </span>
          </span>
          {state.status === "uploading" ? (
            <Button type="button" variant="ghost" size="sm" onClick={cancel}>
              {t("cancel")}
            </Button>
          ) : (
            <LoaderCircleIcon aria-hidden className="size-5 animate-spin text-muted-foreground" />
          )}
        </div>
      ) : file ? (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-surface p-3.5">
          <FileTextIcon aria-hidden className="size-6 shrink-0 text-danger" />
          <span className="flex min-w-0 flex-1 flex-col">
            <a
              href={`${hostedImageSrc(file.asset)}?name=${encodeURIComponent(file.name)}`}
              target="_blank"
              rel="noreferrer"
              className="truncate text-label underline-offset-2 hover:underline"
            >
              {file.name}
            </a>
            <span className="text-caption text-muted-foreground">
              {file.pages
                ? t("meta", { pages: file.pages, size: formatFileSize(file.bytes) })
                : t("metaNoPages", { size: formatFileSize(file.bytes) })}
            </span>
          </span>
          <span className="flex gap-1.5">
            <Button type="button" variant="secondary" size="sm" onClick={() => input.current?.click()}>
              <RefreshCwIcon aria-hidden />
              {t("replace")}
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={() => onChange(null)}>
              {t("remove")}
            </Button>
          </span>
          {chooser}
        </div>
      ) : (
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDrag(true);
          }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDrag(false);
            const f = e.dataTransfer.files[0];
            if (f) upload(f);
          }}
          className={cn(
            "flex flex-col items-center gap-2 rounded-lg border-[1.5px] border-dashed p-5 text-center transition-colors",
            drag ? "border-selected-border bg-selected" : message ? "border-danger" : "border-border-strong",
          )}
        >
          <UploadIcon aria-hidden className="size-6 text-muted-foreground" />
          <Button type="button" variant="secondary" size="sm" aria-describedby="hosted-pdf-limits" onClick={() => input.current?.click()}>
            {t("choose")}
          </Button>
          <span id="hosted-pdf-limits" className="text-caption text-muted-foreground">
            {t("limits")}
          </span>
          <Button type="button" variant="ghost" size="sm" onClick={() => void loadSample()}>
            {t("sample")}
          </Button>
          {chooser}
        </div>
      )}
      {message ? <FileProblem id="hosted-pdf-error">{message}</FileProblem> : null}
      <p className="text-caption text-muted-foreground">{t("hint")}</p>
    </div>
  );
}

/** A compact photo slot (menu dishes): the thumbnail is the button; a small × removes the photo. */
export function CompactPhoto({
  id,
  label,
  value,
  onChange,
  maxEdge = 800,
}: {
  id: string;
  label: string;
  value: string | null;
  onChange: (v: string | null) => void;
  maxEdge?: number;
}) {
  const t = useTranslations("editor.hosted");
  const input = useRef<HTMLInputElement>(null);
  const [problem, setProblem] = useState<PhotoProblem | null>(null);
  const [busy, setBusy] = useState(false);
  const pick = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    const out = await preparePhoto(file, maxEdge);
    setBusy(false);
    if (!out.ok) return setProblem(out.problem);
    setProblem(null);
    onChange(out.dataUrl);
  };
  return (
    <div className="flex w-16 shrink-0 flex-col gap-1">
      <div className="relative">
        <button
          type="button"
          aria-label={`${value ? t("photoReplace") : t("photoAdd")} · ${label}`}
          aria-describedby={problem ? `${id}-error` : undefined}
          onClick={() => input.current?.click()}
          className="grid size-16 cursor-pointer place-items-center overflow-hidden rounded-lg border border-dashed border-border-strong bg-subtle text-icon-muted hover:border-border-hover"
        >
          {busy ? (
            <LoaderCircleIcon aria-hidden className="size-5 animate-spin" />
          ) : value ? (
            // eslint-disable-next-line @next/next/no-img-element -- local preview of the owner's photo
            <img src={hostedImageSrc(value)} alt="" className="size-full object-cover" />
          ) : (
            <ImagePlusIcon aria-hidden className="size-5" />
          )}
        </button>
        {value ? (
          <button
            type="button"
            aria-label={`${t("photoRemove")} · ${label}`}
            onClick={() => onChange(null)}
            className="absolute -top-1.5 -right-1.5 grid size-6 cursor-pointer place-items-center rounded-full border border-border bg-surface shadow-1"
          >
            <Trash2Icon aria-hidden className="size-3" />
          </button>
        ) : null}
        <input
          ref={input}
          id={id}
          type="file"
          accept={PHOTO_ACCEPT}
          className="sr-only"
          tabIndex={-1}
          onChange={(e) => {
            void pick(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
      </div>
      {problem ? <FileProblem id={`${id}-error`}>{t(problem.key, { name: problem.name, size: problem.size ?? "" })}</FileProblem> : null}
    </div>
  );
}
