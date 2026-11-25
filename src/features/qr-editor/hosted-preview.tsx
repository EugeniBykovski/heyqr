"use client";

import { LockIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { HostedPage } from "@/entities/hosted-page";
import type { HostedContent } from "@/entities/qr";
import { cn } from "@/shared/lib/utils";
import { Badge } from "@/shared/ui/badge";

/**
 * Design 10.4 / 11.x "After scan": the hosted page as visitors will see it, inside a phone. Nothing in it navigates
 * (the editor preview stays in the editor). The address bar shows the code's short link.
 */
export function HostedPreview({
  content,
  shortLabel,
  forceExpired,
  className,
}: {
  content: HostedContent;
  /** The short link as shown in the address bar ("heyqr.app/r/…"). */
  shortLabel: string;
  forceExpired?: boolean;
  className?: string;
}) {
  const t = useTranslations("editor");
  const tTypes = useTranslations("contentTypes");
  return (
    <figure aria-label={t("afterScanning.label")} className={cn("flex flex-col items-center gap-3", className)}>
      <figcaption className="flex w-full max-w-[23rem] items-center justify-between gap-2">
        <span className="text-[0.8125rem] font-semibold text-secondary-foreground">{t("afterScanning.label")}</span>
        <Badge>{tTypes(content.type)}</Badge>
      </figcaption>
      <div className="aspect-[9/17] w-full max-w-[18.75rem] rounded-[2.5rem] bg-inverse p-2 shadow-2">
        <div className="flex h-full flex-col overflow-hidden rounded-[2rem] bg-surface">
          <div className="mx-3 mt-3.5 mb-2 flex h-8.5 min-w-0 shrink-0 items-center gap-1.5 rounded-full bg-subtle px-3 text-caption font-semibold">
            <LockIcon aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
            <span className="truncate">{shortLabel}</span>
          </div>
          <div className="min-h-0 flex-1 [scrollbar-width:none] overflow-y-auto">
            <HostedPage content={content} mode="preview" forceExpired={forceExpired} />
          </div>
        </div>
      </div>
      <p className="max-w-[23rem] text-center text-caption text-muted-foreground">{t("hosted.previewNote", { short: shortLabel })}</p>
    </figure>
  );
}
