"use client";

import { ChevronDownIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { cn } from "@/shared/lib/utils";

export type DocsNavGroup = { label: string; items: { id: string; label: string }[] };

/**
 * Design 12.4: the docs navigation. From 900 px a sticky sidebar that marks the section in view; below that a
 * collapsible "On this page" above the content. Links are plain anchors, so they work without JavaScript.
 */
export function DocsNav({ groups, title }: { groups: DocsNavGroup[]; title: string }) {
  const [active, setActive] = useState(groups[0]?.items[0]?.id ?? "");
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const ids = groups.flatMap((g) => g.items.map((i) => i.id));
    const seen = new IntersectionObserver(
      (entries) => {
        const top = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (top) setActive(top.target.id);
      },
      { rootMargin: "-20% 0px -70% 0px" },
    );
    for (const id of ids) {
      const el = document.getElementById(id);
      if (el) seen.observe(el);
    }
    return () => seen.disconnect();
  }, [groups]);
  const list = (
    <div className="flex flex-col gap-4">
      {groups.map((g) => (
        <div key={g.label} className="flex flex-col gap-1">
          <span className="px-2.5 text-micro text-muted-foreground uppercase">{g.label}</span>
          <ul className="flex flex-col">
            {g.items.map((i) => (
              <li key={i.id}>
                <a
                  href={`#${i.id}`}
                  aria-current={active === i.id ? "location" : undefined}
                  onClick={() => setOpen(false)}
                  className={cn(
                    "flex min-h-9 items-center rounded-md px-2.5 text-[0.875rem] transition-colors hover:bg-subtle",
                    active === i.id ? "bg-selected font-semibold text-foreground" : "text-secondary-foreground",
                  )}
                >
                  {i.label}
                </a>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
  return (
    <>
      <nav
        aria-label={title}
        className="sticky top-[calc(var(--spacing-header)+1.5rem)] hidden max-h-[calc(100dvh-var(--spacing-header)-3rem)] overflow-y-auto min-[900px]:block"
      >
        {list}
      </nav>
      <nav aria-label={title} className="rounded-lg border border-border bg-surface min-[900px]:hidden">
        <button
          type="button"
          aria-expanded={open}
          aria-controls="dv-toc"
          onClick={() => setOpen((o) => !o)}
          className="flex min-h-12 w-full cursor-pointer items-center justify-between gap-2 px-4 text-label"
        >
          {title}
          <ChevronDownIcon aria-hidden className={cn("size-4 transition-transform", open && "rotate-180")} />
        </button>
        <div id="dv-toc" hidden={!open} className="border-t border-border p-2">
          {list}
        </div>
      </nav>
    </>
  );
}
