"use client";

import { QR_CONTENT_TYPES, type QrContentType } from "@heyqr/qr-core";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { cn } from "@/shared/lib/utils";
import { TYPE_ICONS } from "./type-icons";
import { draftForType, writeDraft } from "./use-draft";

function useOpenType() {
  const router = useRouter();
  return (type: QrContentType) => {
    writeDraft(draftForType(type));
    router.push("/create?step=content");
  };
}

/** Design "tgrid" / "tchip": the nine content types; each opens the editor on that type's form. */
export function TypeChips() {
  const t = useTranslations("home.types");
  const open = useOpenType();
  return (
    <div className="grid grid-cols-2 gap-2 md:grid-cols-3 md:gap-3">
      {QR_CONTENT_TYPES.map((type) => {
        const Icon = TYPE_ICONS[type];
        return (
          <button
            key={type}
            type="button"
            onClick={() => open(type)}
            className="group flex min-h-15 min-w-0 cursor-pointer items-center gap-3 rounded-lg border border-border bg-surface px-3.5 py-3 text-left transition-[border-color,background-color] duration-(--motion-fast) hover:border-accent-strong-hover hover:bg-accent md:min-h-19 md:px-4 md:py-3.5"
          >
            <span className="grid size-9.5 shrink-0 place-items-center rounded-full bg-subtle text-icon-muted transition-colors duration-(--motion-fast) group-hover:bg-surface group-hover:text-accent-text">
              <Icon aria-hidden className="size-5" strokeWidth={1.9} />
            </span>
            <span className="flex min-w-0 flex-col gap-0.5">
              <b className="text-[0.9375rem] leading-tight font-semibold">{t(`${type}.label`)}</b>
              <span className="hidden text-caption text-muted-foreground md:block">{t(`${type}.desc`)}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

/** Footer "Make a code for" link: same handoff as the chips, styled as a text link. */
export function TypeLink({ type, className }: { type: QrContentType; className?: string }) {
  const t = useTranslations("home.types");
  const open = useOpenType();
  return (
    <button type="button" onClick={() => open(type)} className={cn("cursor-pointer text-left", className)}>
      {t(`${type}.label`)}
    </button>
  );
}
