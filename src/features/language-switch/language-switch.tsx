"use client";

import { CheckIcon, ChevronDownIcon, SearchIcon } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { Popover } from "radix-ui";
import { useState, useTransition } from "react";
import { usePathname, useRouter } from "@/i18n/navigation";
import { LOCALES, localeMeta, type Locale } from "@/i18n/locales";
import { announceLocaleChange } from "@/shared/lib/locale-carry";
import { cn } from "@/shared/lib/utils";

function Flag({ className }: { className: string }) {
  return (
    <span aria-hidden className={cn("h-3.75 w-5.5 shrink-0 rounded-xs bg-cover shadow-[inset_0_0_0_1px_rgb(13_13_18/0.12)]", className)} />
  );
}

/** Matches a language by its native or English name or its code, ignoring case and accents. */
export function matchesLanguage(l: (typeof LOCALES)[number], query: string): boolean {
  const fold = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
  const q = fold(query.trim());
  return !q || [l.native, l.english, l.code].some((v) => fold(v).includes(q));
}

/*
 * Design 1.13 "Header · language switch": a searchable panel with the 21 interface languages (flags, native names and
 * English names, the current one marked), two columns, full width on phones. Choosing one keeps the current page;
 * Arabic switches the layout to right-to-left (the root layout sets dir). Locale never changes the display currency.
 */
export function LanguageSwitch() {
  const t = useTranslations("nav");
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const current = localeMeta(locale);
  const list = LOCALES.filter((l) => matchesLanguage(l, query));

  const choose = (next: Locale) => {
    setOpen(false);
    if (next === locale) return;
    // HEY-192: the same page in the other language: its query (editor step, plan, currency, filters) and hash stay, and
    // the page hands its unsaved state over before it remounts. A plain navigation: nothing is submitted or bought.
    const { search, hash } = window.location;
    announceLocaleChange();
    startTransition(() => router.replace(`${pathname}${search}${hash}`, { locale: next, scroll: false }));
  };

  return (
    <Popover.Root
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) setQuery("");
      }}
    >
      <Popover.Trigger asChild>
        <button
          type="button"
          aria-label={`${t("language")}: ${current.native}`}
          disabled={pending}
          className="group inline-flex min-h-9 cursor-pointer items-center gap-2 rounded-full border border-border bg-surface pr-2.5 pl-2 text-[0.8125rem] font-bold tracking-[0.02em] transition-[border-color,box-shadow] duration-(--motion-fast) hover:border-border-hover hover:shadow-1 disabled:opacity-40 aria-expanded:border-violet-300 aria-expanded:ring-3 aria-expanded:ring-violet-100"
        >
          <Flag className={current.flag} />
          <span className="max-[390px]:hidden">{current.short}</span>
          <ChevronDownIcon
            aria-hidden
            className="size-3.5 text-muted-foreground transition-transform duration-(--motion-base) group-aria-expanded:rotate-180 motion-reduce:transition-none"
          />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="end"
          sideOffset={6}
          collisionPadding={8}
          aria-label={t("languageChoose")}
          className="z-80 flex w-[calc(100vw-1rem)] animate-pop flex-col gap-2.5 rounded-xl border border-border bg-surface p-3 shadow-3 sm:w-105"
        >
          <div className="flex items-center justify-between gap-3">
            <span className="text-label">{t("language")}</span>
            <bdi className="text-caption text-muted-foreground">{t("languageCount", { count: LOCALES.length })}</bdi>
          </div>
          <div className="relative">
            <SearchIcon
              aria-hidden
              className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            />
            <input
              type="search"
              aria-label={t("languageSearch")}
              placeholder={t("languageSearch")}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                const first = list[0];
                if (e.key === "Enter" && first) choose(first.code);
              }}
              className="border-border-control focus-visible:outline-focus-ring min-h-10 w-full rounded-md border bg-surface ps-9 pe-3 text-[0.9375rem] focus-visible:outline-2"
            />
          </div>
          <div role="group" aria-label={t("languages")} className="grid max-h-[50vh] grid-cols-2 gap-1 overflow-auto p-0.5 sm:max-h-90">
            {list.map((l) => (
              <button
                key={l.code}
                type="button"
                lang={l.code}
                aria-pressed={l.code === locale}
                onClick={() => choose(l.code)}
                className="flex min-h-12 min-w-0 cursor-pointer items-center gap-2.5 rounded-md border border-transparent px-2.5 py-1.5 text-start transition-colors duration-(--motion-fast) hover:bg-subtle aria-pressed:border-violet-200 aria-pressed:bg-selected"
              >
                <Flag className={l.flag} />
                <span className="flex min-w-0 flex-1 flex-col leading-tight">
                  {/* Each name keeps its own direction, so it truncates at its end in either layout. */}
                  <b dir="auto" className="truncate text-[0.875rem] font-semibold">
                    {l.native}
                  </b>
                  <span lang="en" dir="ltr" className="truncate text-start text-caption text-muted-foreground">
                    {l.english}
                  </span>
                </span>
                {l.code === locale ? <CheckIcon aria-hidden className="size-4 shrink-0 text-violet-700" /> : null}
              </button>
            ))}
          </div>
          {list.length === 0 ? (
            <p role="status" className="p-2 text-caption text-muted-foreground">
              {t("languageEmpty", { query: query.trim() })}
            </p>
          ) : null}
          <p className="text-caption text-muted-foreground">{t("languageNote")}</p>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
