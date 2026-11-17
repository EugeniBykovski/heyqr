"use client";

import { CheckIcon, ChevronDownIcon } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useTransition } from "react";
import { usePathname, useRouter } from "@/i18n/navigation";
import { LOCALES, localeMeta, type Locale } from "@/i18n/locales";
import { cn } from "@/shared/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/shared/ui/dropdown-menu";

function Flag({ className }: { className: string }) {
  return (
    <span aria-hidden className={cn("h-3.75 w-5.5 shrink-0 rounded-xs bg-cover shadow-[inset_0_0_0_1px_rgb(13_13_18/0.12)]", className)} />
  );
}

/** Language switch with flags for all 21 languages; keeps the current page. */
export function LanguageSwitch() {
  const t = useTranslations("nav");
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();
  const current = localeMeta(locale);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={`${t("language")}: ${current.native}`}
          disabled={pending}
          className="group inline-flex min-h-9 cursor-pointer items-center gap-2 rounded-full border border-border bg-surface pr-2.5 pl-2 text-[0.8125rem] font-bold tracking-[0.02em] transition-[border-color,box-shadow] duration-(--motion-fast) hover:border-border-hover hover:shadow-1 disabled:opacity-40 aria-expanded:border-accent-strong-hover aria-expanded:ring-3 aria-expanded:ring-ring-soft"
        >
          <Flag className={current.flag} />
          <span>{current.short}</span>
          <ChevronDownIcon
            aria-hidden
            className="size-3.5 text-muted-foreground transition-transform duration-(--motion-base) group-aria-expanded:rotate-180"
          />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel>{t("language")}</DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={locale}
          onValueChange={(next) =>
            startTransition(() => {
              router.replace(pathname, { locale: next as Locale });
            })
          }
        >
          {LOCALES.map((l) => (
            <DropdownMenuRadioItem key={l.code} value={l.code} lang={l.code}>
              <Flag className={l.flag} />
              <span className="flex-1">{l.native}</span>
              {l.code === locale ? <CheckIcon aria-hidden /> : <span className="text-caption text-muted-foreground">{l.short}</span>}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
