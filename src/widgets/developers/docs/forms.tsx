"use client";

import { CheckCircle2Icon, CircleAlertIcon } from "lucide-react";
import { useId, useRef, useState, type FormEvent } from "react";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { cn } from "@/shared/lib/utils";

export type SignupLabels = {
  label: string;
  placeholder: string;
  join: string;
  joining: string;
  invalid: string;
  failed: string;
  joined: string;
  hint: string;
};

/**
 * Design 12.18–12.20 (and 12.2's "Email me"): one email, stored once per address and topic by the existing release
 * list (developer_notify). The address is checked as you send; an error is shown inline and focus returns to the
 * field (12.19). "Joined" replaces the form only after the server accepted it (12.20).
 */
export function SignupForm({ topic, labels }: { topic: "packages" | "rest"; labels: SignupLabels }) {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "joined" | "invalid" | "failed">("idle");
  const [joined, setJoined] = useState("");
  const field = useRef<HTMLInputElement>(null);
  const id = useId();
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const address = email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) {
      setState("invalid");
      field.current?.focus();
      return;
    }
    setState("sending");
    const res = await fetch("/api/developers/notify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: address, topic }),
    }).catch(() => null);
    if (res?.ok) {
      setJoined(address);
      setState("joined");
      return;
    }
    setState(res?.status === 400 ? "invalid" : "failed");
    field.current?.focus();
  };
  if (state === "joined")
    return (
      <p role="status" className="flex items-start gap-2 rounded-lg bg-success-soft px-4 py-3 text-caption font-medium text-success">
        <CheckCircle2Icon aria-hidden className="mt-0.5 size-4 shrink-0" />
        {labels.joined.replace("{email}", joined)}
      </p>
    );
  const bad = state === "invalid" || state === "failed";
  return (
    <form noValidate onSubmit={submit} className="flex flex-col gap-2 rounded-xl border border-border bg-surface p-4">
      <Label htmlFor={`${id}-email`} className="text-label font-semibold">
        {labels.label}
      </Label>
      <Input
        ref={field}
        id={`${id}-email`}
        type="email"
        autoComplete="email"
        placeholder={labels.placeholder}
        value={email}
        aria-invalid={bad || undefined}
        aria-describedby={bad ? `${id}-error` : `${id}-hint`}
        onChange={(e) => setEmail(e.target.value)}
        className={cn(bad && "border-danger")}
      />
      <Button type="submit" variant="primary" size="sm" className="self-start" loading={state === "sending"}>
        {state === "sending" ? labels.joining : labels.join}
      </Button>
      {bad ? (
        <p id={`${id}-error`} role="alert" className="flex items-start gap-1.5 text-caption font-medium text-danger">
          <CircleAlertIcon aria-hidden className="mt-0.5 size-3.5 shrink-0" />
          {state === "invalid" ? labels.invalid : labels.failed}
        </p>
      ) : null}
      <p id={`${id}-hint`} className="text-caption text-muted-foreground">
        {labels.hint}
      </p>
    </form>
  );
}

export type HelpfulLabels = { question: string; yes: string; no: string; sending: string; thanks: string; failed: string };

/** Design 12.1 / 12.14 "Was this page helpful?": thanks only after the server stored the answer. */
export function Helpful({ page, labels }: { page: string; labels: HelpfulLabels }) {
  const [state, setState] = useState<"idle" | "sending" | "done" | "failed">("idle");
  const [choice, setChoice] = useState<boolean | null>(null);
  const send = async (helpful: boolean) => {
    setChoice(helpful);
    setState("sending");
    const res = await fetch("/api/developers/feedback", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ page, helpful }),
    }).catch(() => null);
    setState(res?.ok ? "done" : "failed");
  };
  return (
    <div className="flex flex-wrap items-center gap-2.5">
      <span id={`helpful-${page}`} className="text-label font-semibold">
        {labels.question}
      </span>
      <div role="group" aria-labelledby={`helpful-${page}`} className="flex gap-2">
        {[true, false].map((v) => (
          <button
            key={String(v)}
            type="button"
            aria-pressed={choice === v}
            disabled={state === "sending" || state === "done"}
            onClick={() => void send(v)}
            className="min-h-9 cursor-pointer rounded-full border border-border bg-surface px-3.5 text-caption font-semibold hover:border-border-hover disabled:cursor-default aria-pressed:border-accent-strong aria-pressed:bg-selected"
          >
            {v ? labels.yes : labels.no}
          </button>
        ))}
      </div>
      <span role="status" aria-live="polite" className={cn("text-caption", state === "failed" ? "text-danger" : "text-success")}>
        {state === "sending" ? labels.sending : state === "done" ? labels.thanks : state === "failed" ? labels.failed : ""}
      </span>
    </div>
  );
}
