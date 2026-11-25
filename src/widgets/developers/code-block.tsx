"use client";

import { CheckIcon, CopyIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { cn } from "@/shared/lib/utils";

/** Design 12.3 code block: a file name, the code, and Copy (confirmed for two seconds). */
export function CodeBlock({
  name,
  code,
  copyLabel,
  copiedLabel,
  prompt = false,
  className,
}: {
  name: string;
  code: string;
  copyLabel: string;
  copiedLabel: string;
  prompt?: boolean;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const id = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(id);
  }, [copied]);
  return (
    <figure className={cn("min-w-0 overflow-hidden rounded-xl border border-inverse bg-inverse text-inverse-foreground", className)}>
      <figcaption className="flex min-h-11 items-center justify-between gap-2 border-b border-inverse-border py-1 pr-1.5 pl-4">
        <span className="truncate font-mono text-caption text-inverse-muted">{name}</span>
        <button
          type="button"
          aria-label={`${copied ? copiedLabel : copyLabel} · ${name}`}
          onClick={() =>
            navigator.clipboard?.writeText(code).then(
              () => setCopied(true),
              () => undefined,
            )
          }
          className="inline-flex min-h-9 cursor-pointer items-center gap-1.5 rounded-full px-3 text-caption font-semibold text-inverse-foreground hover:bg-inverse-foreground/8"
        >
          {copied ? <CheckIcon aria-hidden className="size-3.5" /> : <CopyIcon aria-hidden className="size-3.5" />}
          <span aria-live="polite">{copied ? copiedLabel : copyLabel}</span>
        </button>
      </figcaption>
      <pre className="overflow-x-auto p-4 font-mono text-[0.8125rem] leading-[1.6]">
        <code>
          {prompt ? (
            <span aria-hidden className="text-inverse-muted select-none">
              ${" "}
            </span>
          ) : null}
          {code}
        </code>
      </pre>
    </figure>
  );
}
