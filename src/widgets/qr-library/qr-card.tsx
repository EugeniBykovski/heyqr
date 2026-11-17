import type { Layout } from "@heyqr/qr-core";
import { DownloadIcon } from "lucide-react";
import { QrPreview } from "@/entities/qr";
import { Link } from "@/i18n/navigation";
import { cn } from "@/shared/lib/utils";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import { libraryActions, libraryRow, libraryThumb } from "./layout";

export type QrCardStatus = "purchased" | "active" | "draft" | "paused" | "archived";

const STATUS_VARIANT = { purchased: "success", active: "success", draft: "warning", paused: "warning", archived: "neutral" } as const;

/** One saved code: thumbnail, name, type / model / status badges, and the action that fits (download or buy). */
export function QrCard({
  name,
  href,
  exportHref,
  layout,
  value,
  typeLabel,
  model,
  modelLabel,
  status,
  statusLabel,
  meta,
  paid,
  labels,
}: {
  name: string;
  href: string;
  exportHref?: string;
  layout?: Layout;
  value: string;
  typeLabel: string;
  model: "static" | "dynamic";
  modelLabel: string;
  status: QrCardStatus;
  statusLabel: string;
  meta: string;
  paid: boolean;
  labels: { open: string; edit: string; download: string; buy: string };
}) {
  return (
    <li className={cn(libraryRow, "animate-rise")}>
      <Link href={href} aria-label={labels.open} className={libraryThumb}>
        {layout ? <QrPreview layout={layout} value={value} label={name} className="size-full" /> : null}
      </Link>
      <div className="flex min-w-0 flex-col gap-1.5">
        <Link href={href} title={name} className="truncate text-[1rem] font-bold underline-offset-3 hover:underline">
          {name}
        </Link>
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge>{typeLabel}</Badge>
          <Badge variant={model === "dynamic" ? "accent" : "neutral"}>{modelLabel}</Badge>
          <Badge variant={STATUS_VARIANT[status]}>{statusLabel}</Badge>
          <span className="text-caption text-muted-foreground">{meta}</span>
        </div>
      </div>
      <div className={libraryActions}>
        <Button asChild size="sm">
          <Link href={href}>{labels.edit}</Link>
        </Button>
        {exportHref ? (
          <Button asChild size="sm" variant={paid ? "secondary" : "primary"} className={cn(!paid && "ml-auto lg:ml-0")}>
            <Link href={exportHref}>
              <DownloadIcon aria-hidden />
              {paid ? labels.download : labels.buy}
            </Link>
          </Button>
        ) : null}
      </div>
    </li>
  );
}
