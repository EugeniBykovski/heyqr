"use client";

import {
  BookOpenIcon,
  BracesIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  LifeBuoyIcon,
  MenuIcon,
  RocketIcon,
  SearchIcon,
  ServerIcon,
  XIcon,
} from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Link } from "@/i18n/navigation";
import { cn } from "@/shared/lib/utils";
import type { DocsGroup } from "./registry";

export type NavItem = { id: string; href: string; label: string; group: DocsGroup; state?: "design" };
/** A searchable page: its title, intro and section headings (design 12.16). Public pages only. */
export type SearchEntry = { href: string; title: string; lead: string; group: DocsGroup; sections: { href: string; title: string }[] };
export type NavLabels = {
  groups: Record<DocsGroup, string>;
  search: string;
  clear: string;
  /** "{count}" is replaced. */
  resultsOne: string;
  resultsOther: string;
  /** "{query}" is replaced. */
  empty: string;
  emptyHint: string;
  suggestions: string[];
  preview: string;
  menuOpen: string;
  menuClose: string;
  menuLabel: string;
  packageName: string;
  packageStatus: string;
  packageLive: boolean;
};

const ICONS: Record<DocsGroup, typeof RocketIcon> = {
  start: RocketIcon,
  guides: BookOpenIcon,
  ref: BracesIcon,
  help: LifeBuoyIcon,
  rest: ServerIcon,
};

/** Case- and accent-insensitive match of every word of the query. */
function matches(entry: { title: string; lead: string; sections: { title: string }[] }, query: string) {
  const norm = (s: string) => s.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase();
  const hay = norm([entry.title, entry.lead, ...entry.sections.map((s) => s.title)].join(" "));
  return norm(query)
    .split(/\s+/)
    .filter(Boolean)
    .every((w) => hay.includes(w));
}

/**
 * Design 12.1 / 12.16 / 12.17: the docs sidebar. Search, the package and its status, and the pages grouped with icons;
 * the current page is marked (aria-current). From 900 px it is a sticky column; below, a sticky "Docs" button opens
 * the same panel in place. Search filters public pages by title, intro and section headings, and suggests terms when
 * nothing matches.
 */
export function DocsNav({
  items,
  current,
  index,
  labels,
  pageTitle,
}: {
  items: NavItem[];
  current: string;
  index: SearchEntry[];
  labels: NavLabels;
  pageTitle: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const toggleRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  const searching = query.trim().length > 0;
  const results = useMemo(() => (searching ? index.filter((e) => matches(e, query)) : []), [index, query, searching]);
  const groupOf = items.find((i) => i.id === current)?.group ?? "start";
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setOpen(false);
      toggleRef.current?.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const groups = (Object.keys(labels.groups) as DocsGroup[]).map((g) => ({ g, items: items.filter((i) => i.group === g) }));
  const searchBox = (
    <div className="relative">
      <SearchIcon aria-hidden className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
      <input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        aria-label={labels.search}
        placeholder={labels.search}
        aria-controls={`${panelId}-results`}
        className="border-border-control h-10 w-full rounded-lg border bg-surface ps-9 pe-9 text-body outline-offset-2 placeholder:text-muted-foreground [&::-webkit-search-cancel-button]:hidden"
      />
      {searching ? (
        <button
          type="button"
          onClick={() => setQuery("")}
          aria-label={labels.clear}
          className="absolute end-1 top-1/2 grid size-8 -translate-y-1/2 cursor-pointer place-items-center rounded-md text-muted-foreground hover:bg-subtle"
        >
          <XIcon aria-hidden className="size-4" />
        </button>
      ) : null}
    </div>
  );
  const pageList = (
    <div className="flex flex-col gap-4">
      {groups.map(({ g, items: list }) => {
        const Icon = ICONS[g];
        return list.length ? (
          <div key={g} className="flex flex-col gap-0.5">
            <span className="flex min-h-9 items-center gap-2.5 px-2 text-label font-semibold">
              <span className="grid size-6 place-items-center text-accent-text">
                <Icon aria-hidden className="size-4" />
              </span>
              {labels.groups[g]}
            </span>
            <ul className="flex flex-col">
              {list.map((i) => (
                <li key={i.id}>
                  <Link
                    href={i.href}
                    aria-current={i.id === current ? "page" : undefined}
                    onClick={() => setOpen(false)}
                    className={cn(
                      "flex min-h-9 items-center justify-between gap-2 rounded-md border-s-2 ps-9.5 pe-2 text-[0.875rem] transition-colors hover:bg-subtle",
                      i.id === current
                        ? "border-accent-strong bg-selected font-semibold text-accent-text"
                        : "border-transparent text-secondary-foreground",
                    )}
                  >
                    {i.label}
                    {i.state ? <span className="text-micro tracking-wide text-warning uppercase">{labels.preview}</span> : null}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ) : null;
      })}
    </div>
  );
  const resultList = (
    <div id={`${panelId}-results`} className="flex flex-col gap-3">
      <p role="status" aria-live="polite" className="px-2 text-caption text-muted-foreground">
        {results.length
          ? (results.length === 1 ? labels.resultsOne : labels.resultsOther).replace("{count}", String(results.length))
          : labels.empty.replace("{query}", query.trim())}
      </p>
      {results.length ? (
        <ul className="flex flex-col gap-1">
          {results.map((r) => {
            const Icon = ICONS[r.group];
            return (
              <li key={r.href}>
                <Link
                  href={r.href}
                  onClick={() => setOpen(false)}
                  className="flex min-h-11 items-start gap-2.5 rounded-md px-2 py-2 hover:bg-subtle"
                >
                  <Icon aria-hidden className="mt-0.5 size-4 shrink-0 text-accent-text" />
                  <span className="flex min-w-0 flex-col">
                    <span className="text-label">{r.title}</span>
                    <span className="truncate text-caption text-muted-foreground">{labels.groups[r.group]}</span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      ) : (
        <div className="flex flex-col gap-2 px-2">
          <p className="text-caption text-secondary-foreground">{labels.emptyHint}</p>
          <div className="flex flex-wrap gap-1.5">
            {labels.suggestions.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setQuery(s)}
                className="min-h-8 cursor-pointer rounded-full border border-border bg-surface px-3 text-caption hover:border-border-hover"
              >
                {s}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
  const version = (
    <div className="flex items-start justify-between gap-2 rounded-lg bg-subtle px-2.5 py-2">
      <span className="font-mono text-caption break-all">{labels.packageName}</span>
      <span className={cn("shrink-0 text-micro font-semibold", labels.packageLive ? "text-success" : "text-warning")}>
        {labels.packageStatus}
      </span>
    </div>
  );
  const panel = (
    <div className="flex flex-col gap-4">
      {searchBox}
      {searching ? (
        resultList
      ) : (
        <>
          {version}
          {pageList}
        </>
      )}
    </div>
  );

  return (
    <>
      <nav
        aria-label={labels.menuLabel}
        className="sticky top-[calc(var(--spacing-header)+1.5rem)] hidden max-h-[calc(100dvh-var(--spacing-header)-3rem)] w-62 shrink-0 overflow-y-auto pb-4 min-[900px]:block"
      >
        {panel}
      </nav>
      <div className="sticky top-[calc(var(--spacing-header)+0.5rem)] z-20 min-[900px]:hidden">
        <nav aria-label={labels.menuLabel} className="shadow-sm rounded-xl border border-border bg-surface">
          <button
            ref={toggleRef}
            type="button"
            aria-expanded={open}
            aria-controls={`${panelId}-menu`}
            aria-label={open ? labels.menuClose : labels.menuOpen}
            onClick={() => setOpen((o) => !o)}
            className="flex min-h-14 w-full cursor-pointer items-center gap-3 px-4 text-start"
          >
            <MenuIcon aria-hidden className="size-4 shrink-0" />
            <span className="flex min-w-0 flex-col">
              <span className="text-micro text-muted-foreground uppercase">
                {labels.menuLabel} · {labels.groups[groupOf]}
              </span>
              <span className="truncate text-label font-semibold">{pageTitle}</span>
            </span>
            {open ? <ChevronUpIcon aria-hidden className="ms-auto size-4" /> : <ChevronDownIcon aria-hidden className="ms-auto size-4" />}
          </button>
          <div id={`${panelId}-menu`} hidden={!open} className="max-h-[70dvh] overflow-y-auto border-t border-border p-3">
            {panel}
          </div>
        </nav>
      </div>
    </>
  );
}
