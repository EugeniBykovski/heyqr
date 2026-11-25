"use client";

import { CheckCircle2Icon, CircleAlertIcon, LoaderCircleIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";

const REASONS = ["scam", "malware", "illegal", "impersonation", "other"] as const;

export function ReportForm({ code }: { code: string }) {
  const t = useTranslations("hosted.reportForm");
  const [reason, setReason] = useState<(typeof REASONS)[number] | "">("");
  const [details, setDetails] = useState("");
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent" | "failed" | "invalid">("idle");

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!reason || (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) return setState("invalid");
    setState("sending");
    const res = await fetch("/api/hosted/report", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code, reason, details, email }),
    }).catch(() => null);
    setState(res?.ok ? "sent" : res?.status === 400 ? "invalid" : "failed");
  };

  if (state === "sent")
    return (
      <div role="status" className="flex flex-1 flex-col items-center justify-center gap-3 px-6 py-16 text-center">
        <CheckCircle2Icon aria-hidden className="size-10 text-success" />
        <p className="text-h3">{t("sent")}</p>
        <a href={`/p/${code}`} className="text-label underline underline-offset-2">
          {t("back")}
        </a>
      </div>
    );

  return (
    <form noValidate onSubmit={submit} className="flex flex-col gap-4 px-5 py-4">
      <header className="flex flex-col gap-1">
        <h1 className="text-h2">{t("title")}</h1>
        <p className="text-caption text-secondary-foreground">{t("lead")}</p>
      </header>
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 text-label">{t("reason")}</legend>
        {REASONS.map((r) => (
          <label
            key={r}
            className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg border border-border px-3 has-checked:border-selected-border has-checked:bg-selected"
          >
            <input
              type="radio"
              name="reason"
              value={r}
              checked={reason === r}
              onChange={() => setReason(r)}
              className="size-4 accent-current"
            />
            <span>{t(`reasons.${r}`)}</span>
          </label>
        ))}
      </fieldset>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="report-details">{t("details")}</Label>
        <textarea
          id="report-details"
          rows={4}
          maxLength={1000}
          value={details}
          placeholder={t("detailsPlaceholder")}
          onChange={(e) => setDetails(e.target.value)}
          className="rounded-md border border-input bg-surface px-3 py-2 text-body outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring-soft"
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="report-email">{t("email")}</Label>
        <Input
          id="report-email"
          type="email"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          aria-describedby="report-email-hint"
        />
        <p id="report-email-hint" className="text-caption text-muted-foreground">
          {t("emailHint")}
        </p>
      </div>
      {state === "invalid" || state === "failed" ? (
        <p role="alert" className="flex items-start gap-2 rounded-md bg-danger-soft px-3 py-2.5 text-caption text-danger">
          <CircleAlertIcon aria-hidden className="mt-0.5 size-4 shrink-0" />
          {t(state === "invalid" ? "invalid" : "failed")}
        </p>
      ) : null}
      <div className="flex items-center gap-3">
        <Button type="submit" variant="primary" disabled={state === "sending"} aria-busy={state === "sending" || undefined}>
          {state === "sending" ? <LoaderCircleIcon aria-hidden className="animate-spin" /> : null}
          {state === "sending" ? t("sending") : t("send")}
        </Button>
        <a href={`/p/${code}`} className="text-label text-secondary-foreground underline underline-offset-2">
          {t("back")}
        </a>
      </div>
    </form>
  );
}
