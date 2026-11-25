"use client";

import { CheckCircle2Icon, CircleAlertIcon, LoaderCircleIcon, MailIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";

/** Design 12.1 "Email me when it’s published": a real sign-up (stored once per address), with its states. */
export function NotifyForm() {
  const t = useTranslations("developers.notify");
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "done" | "invalid" | "failed">("idle");
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) return setState("invalid");
    setState("sending");
    const res = await fetch("/api/developers/notify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: email.trim(), topic: "packages" }),
    }).catch(() => null);
    setState(res?.ok ? "done" : res?.status === 400 ? "invalid" : "failed");
  };
  if (state === "done")
    return (
      <p role="status" className="flex items-start gap-2 text-caption font-medium text-success">
        <CheckCircle2Icon aria-hidden className="mt-0.5 size-4 shrink-0" />
        {t("success")}
      </p>
    );
  if (!open)
    return (
      <Button type="button" variant="secondary" size="sm" className="self-start" onClick={() => setOpen(true)}>
        <MailIcon aria-hidden />
        {t("button")}
      </Button>
    );
  const bad = state === "invalid" || state === "failed";
  return (
    <form noValidate onSubmit={submit} className="flex flex-col gap-1.5">
      <Label htmlFor="dev-notify-email">{t("label")}</Label>
      <div className="flex flex-wrap gap-2">
        <Input
          id="dev-notify-email"
          type="email"
          autoComplete="email"
          className="max-w-72 min-w-0 flex-1"
          placeholder={t("placeholder")}
          value={email}
          aria-invalid={bad || undefined}
          aria-describedby={bad ? "dev-notify-error" : "dev-notify-hint"}
          onChange={(e) => setEmail(e.target.value)}
          autoFocus
        />
        <Button type="submit" variant="primary" disabled={state === "sending"} aria-busy={state === "sending" || undefined}>
          {state === "sending" ? <LoaderCircleIcon aria-hidden className="animate-spin" /> : null}
          {state === "sending" ? t("sending") : t("send")}
        </Button>
      </div>
      {bad ? (
        <p id="dev-notify-error" role="alert" className="flex items-start gap-1.5 text-caption font-medium text-danger">
          <CircleAlertIcon aria-hidden className="mt-0.5 size-3.5 shrink-0" />
          {t(state === "invalid" ? "invalid" : "failed")}
        </p>
      ) : (
        <p id="dev-notify-hint" className="text-caption text-muted-foreground">
          {t("privacy")}
        </p>
      )}
    </form>
  );
}
