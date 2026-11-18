"use client";

import { encodePayload } from "@heyqr/qr-core";
import { ArrowRightIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { DEFAULT_DESIGN, designToLayout, QR_EXAMPLES, QrPreview } from "@/entities/qr";
import { useRouter } from "@/i18n/navigation";
import { Badge } from "@/shared/ui/badge";
import { writeDraft } from "./use-draft";

const EXAMPLES = QR_EXAMPLES.map((ex) => ({
  ...ex,
  layout: designToLayout({ ...DEFAULT_DESIGN, ...ex.design, model: ex.model, content: ex.content }),
  value: encodePayload(ex.content),
}));

/**
 * Design "rail" + "show": a native horizontal scroller with snap points (no JS scrolling). Each card opens the
 * example in the editor as the guest draft. Cards are about ¾ of the phone width so the next one peeks in.
 */
export function HomeExamples() {
  const t = useTranslations("home.examples");
  const router = useRouter();

  return (
    <div
      className={
        "-mx-4 grid snap-x snap-mandatory scroll-px-4 [scrollbar-width:thin] [scrollbar-color:var(--color-border-hover)_transparent] auto-cols-[minmax(14.5rem,76%)] grid-flow-col gap-4 overflow-x-auto overscroll-x-contain scroll-smooth px-4 pt-1 pb-5 " +
        "sm:auto-cols-[minmax(16.25rem,42%)] lg:auto-cols-[minmax(16.25rem,30%)] xl:auto-cols-[minmax(17.5rem,23.5%)]"
      }
    >
      {EXAMPLES.map((ex) => (
        <button
          key={ex.id}
          type="button"
          aria-label={t("use", { title: t(`items.${ex.id}.title`) })}
          onClick={() => {
            writeDraft({ ...DEFAULT_DESIGN, ...ex.design, name: t(`items.${ex.id}.title`), model: ex.model, content: ex.content });
            router.push("/create?step=design");
          }}
          className="group flex cursor-pointer snap-start flex-col gap-3.5 rounded-xl border border-border bg-surface p-3 text-left shadow-1 transition-[border-color,box-shadow] duration-(--motion-base) ease-out hover:border-border-hover hover:shadow-2"
        >
          <span className="grid aspect-square place-items-center overflow-hidden rounded-lg bg-stage bg-[radial-gradient(var(--color-stage-dot)_1px,transparent_1.3px)] bg-size-[14px_14px] p-5">
            <span className="block w-4/5 drop-shadow-[0_10px_22px_rgb(13_13_18/0.16)] transition-transform duration-(--motion-panel) ease-out group-hover:scale-[1.03] motion-reduce:group-hover:scale-100">
              <QrPreview layout={ex.layout} value={ex.value} label={t(`items.${ex.id}.title`)} className="w-full" />
            </span>
          </span>
          <span className="flex items-center justify-between gap-2 px-1 pb-1">
            <span className="flex min-w-0 flex-col gap-1">
              <span className="truncate text-h3">{t(`items.${ex.id}.title`)}</span>
              <Badge variant={ex.model === "dynamic" ? "accent" : "neutral"} className="self-start">
                {t(`items.${ex.id}.kind`)}
              </Badge>
            </span>
            <span className="inline-flex shrink-0 items-center gap-1.5 text-caption font-semibold text-accent-text">
              {t("useShort")}
              <ArrowRightIcon aria-hidden className="size-3.5" />
            </span>
          </span>
        </button>
      ))}
    </div>
  );
}
