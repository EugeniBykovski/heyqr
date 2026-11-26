"use client";

import { ArrowUpIcon, ChevronDownIcon, TextIcon } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { cn } from "@/shared/lib/utils";

export type Section = { id: string; title: string };

/** Tracks the section in view (the one nearest the top of the reading area). */
function useActive(sections: Section[]) {
  const [active, setActive] = useState(sections[0]?.id ?? "");
  useEffect(() => {
    const seen = new IntersectionObserver(
      (entries) => {
        const top = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (top) setActive(top.target.id);
      },
      { rootMargin: "-15% 0px -70% 0px" },
    );
    for (const s of sections) {
      const el = document.getElementById(s.id);
      if (el) seen.observe(el);
    }
    return () => seen.disconnect();
  }, [sections]);
  return active;
}

/**
 * Design 12.1 / 12.10 "On this page". `rail`: the right column from 1280 px, marking the section in view, with
 * Back to top. `inline`: below 1280 px, a collapsible block under the page intro (open on 12.10).
 */
export function OnThisPage({
  sections,
  title,
  backToTop,
  variant,
}: {
  sections: Section[];
  title: string;
  backToTop: string;
  variant: "rail" | "inline";
}) {
  const active = useActive(sections);
  const [open, setOpen] = useState(false);
  const id = useId();
  if (!sections.length) return null;
  const list = (
    <ul className="flex flex-col">
      {sections.map((s) => (
        <li key={s.id}>
          <a
            href={`#${s.id}`}
            aria-current={variant === "rail" && active === s.id ? "location" : undefined}
            onClick={() => setOpen(false)}
            className={cn(
              "flex min-h-9 items-center text-[0.875rem] transition-colors hover:text-foreground",
              variant === "rail" && active === s.id ? "font-semibold text-accent-text" : "text-secondary-foreground",
            )}
          >
            {s.title}
          </a>
        </li>
      ))}
    </ul>
  );
  if (variant === "rail")
    return (
      <nav aria-label={title} className="sticky top-[calc(var(--spacing-header)+1.5rem)] flex flex-col gap-1 border-s border-border ps-6">
        <span className="pb-1 text-micro text-muted-foreground uppercase">{title}</span>
        {list}
        <a href="#docs-top" className="flex min-h-9 items-center gap-1.5 text-[0.875rem] text-secondary-foreground hover:text-foreground">
          <ArrowUpIcon aria-hidden className="size-3.5" />
          {backToTop}
        </a>
      </nav>
    );
  return (
    <nav aria-label={title} className="rounded-xl border border-border bg-surface">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={`${id}-list`}
        onClick={() => setOpen((o) => !o)}
        className="flex min-h-12 w-full cursor-pointer items-center gap-2.5 px-4 text-label font-semibold"
      >
        <TextIcon aria-hidden className="size-4" />
        {title}
        <ChevronDownIcon aria-hidden className={cn("ms-auto size-4 transition-transform", open && "rotate-180")} />
      </button>
      <div id={`${id}-list`} hidden={!open} className="border-t border-border px-4 py-2">
        {list}
      </div>
    </nav>
  );
}
