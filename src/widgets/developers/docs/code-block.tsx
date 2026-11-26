"use client";

import { CheckIcon, CodeXmlIcon, CopyIcon } from "lucide-react";
import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { cn } from "@/shared/lib/utils";

export type CodeTab = { id: string; label: string; code: string; note?: string };
export type CodeLabels = { copy: string; copied: string; copiedAnnounce: string; copyFailed: string; env: string };

/**
 * Design 12.3 / 12.21 code block: file name or tabs, an environment chip, Copy (confirmed for two seconds and
 * announced politely), and code that scrolls on its own (horizontally, and up to 440 px tall). Tabs are a real
 * tablist: arrow keys, Home and End move between them.
 */
export function CodeBlock({
  file,
  tabs,
  tabsLabel,
  prompt = false,
  labels,
}: {
  /** Shown when there are no tabs. */
  file?: string;
  tabs: CodeTab[];
  tabsLabel?: string;
  prompt?: boolean;
  labels: CodeLabels;
}) {
  const [active, setActive] = useState(0);
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const base = useId();
  const tab = tabs[active] ?? tabs[0];
  useEffect(() => {
    if (state === "idle") return;
    const id = setTimeout(() => setState("idle"), 2000);
    return () => clearTimeout(id);
  }, [state]);
  if (!tab) return null;
  const name = file ?? tab.label;
  const copy = () =>
    navigator.clipboard?.writeText(tab.code).then(
      () => setState("copied"),
      () => setState("failed"),
    ) ?? setState("failed");
  const onKey = (e: KeyboardEvent) => {
    const last = tabs.length - 1;
    const next =
      e.key === "ArrowRight" ? active + 1 : e.key === "ArrowLeft" ? active - 1 : e.key === "Home" ? 0 : e.key === "End" ? last : null;
    if (next === null) return;
    e.preventDefault();
    const i = next < 0 ? last : next > last ? 0 : next;
    setActive(i);
    refs.current[i]?.focus();
  };
  return (
    <figure className="min-w-0 overflow-hidden rounded-xl border border-inverse bg-inverse text-inverse-foreground">
      <figcaption className="flex min-h-11 flex-wrap items-center gap-2 border-b border-inverse-border py-1 pr-1.5 pl-3">
        {tabs.length > 1 ? (
          <div role="tablist" aria-label={tabsLabel} className="flex min-w-0 flex-wrap gap-1" onKeyDown={onKey}>
            {tabs.map((t, i) => (
              <button
                key={t.id}
                ref={(el) => {
                  refs.current[i] = el;
                }}
                type="button"
                role="tab"
                id={`${base}-tab-${t.id}`}
                aria-selected={i === active}
                aria-controls={`${base}-panel`}
                tabIndex={i === active ? 0 : -1}
                onClick={() => setActive(i)}
                className={cn(
                  "min-h-8 cursor-pointer rounded-md px-2.5 font-mono text-caption",
                  i === active ? "bg-inverse-foreground/12 text-inverse-foreground" : "text-inverse-muted hover:text-inverse-foreground",
                )}
              >
                {t.label}
              </button>
            ))}
          </div>
        ) : (
          <span className="flex min-w-0 items-center gap-1.5 font-mono text-caption text-inverse-muted">
            <CodeXmlIcon aria-hidden className="size-3.5 shrink-0" />
            <span className="truncate">{name}</span>
          </span>
        )}
        <span className="ml-auto rounded-full bg-inverse-foreground/10 px-2 py-0.5 text-micro font-semibold text-inverse-foreground">
          {labels.env}
        </span>
        <button
          type="button"
          onClick={copy}
          aria-label={`${state === "copied" ? labels.copied : labels.copy} · ${name}`}
          className="inline-flex min-h-9 cursor-pointer items-center gap-1.5 rounded-full border border-inverse-border px-3 text-caption font-semibold text-inverse-foreground hover:bg-inverse-foreground/8"
        >
          {state === "copied" ? <CheckIcon aria-hidden className="size-3.5" /> : <CopyIcon aria-hidden className="size-3.5" />}
          {state === "copied" ? labels.copied : labels.copy}
        </button>
        <span role="status" aria-live="polite" className="sr-only">
          {state === "copied" ? labels.copiedAnnounce.replace("{file}", name) : state === "failed" ? labels.copyFailed : ""}
        </span>
      </figcaption>
      {tab.note ? <p className="border-b border-inverse-border px-4 py-2 text-caption text-inverse-muted">{tab.note}</p> : null}
      <pre
        id={`${base}-panel`}
        role={tabs.length > 1 ? "tabpanel" : undefined}
        aria-labelledby={tabs.length > 1 ? `${base}-tab-${tab.id}` : undefined}
        tabIndex={0}
        className="max-h-110 overflow-auto p-4 font-mono text-[0.8125rem] leading-[1.6] focus-visible:outline-offset-[-2px]"
      >
        <code>
          {prompt ? (
            <span aria-hidden className="text-inverse-muted select-none">
              ${" "}
            </span>
          ) : null}
          {tab.code}
        </code>
      </pre>
      {state === "failed" ? <p className="px-4 pb-3 text-caption text-inverse-muted">{labels.copyFailed}</p> : null}
    </figure>
  );
}
