import type { Layout } from "@heyqr/qr-core";
import { DownloadIcon, Trash2Icon } from "lucide-react";
import { QrPreview } from "@/entities/qr";
import { Link } from "@/i18n/navigation";
import { cn } from "@/shared/lib/utils";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import { libraryActions, libraryRow, libraryRowSelected, libraryRowSelecting, libraryThumb } from "./layout";

export type QrCardStatus = "purchased" | "active" | "draft" | "paused" | "archived";

const STATUS_VARIANT = { purchased: "success", active: "success", draft: "warning", paused: "warning", archived: "neutral" } as const;

/** One saved code: thumbnail, name, type / model / status badges, and the action that fits (download or buy). */
export function QrCard({
  name,
  href,
  editHref,
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
  select,
  onDelete,
}: {
  name: string;
  href: string;
  /** Edit design (HEY-45): the Design editor for this code's first layout. */
  editHref: string;
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
  labels: { open: string; edit: string; download: string; buy: string; delete?: string; select?: string };
  /** Select mode (My QR codes · select): a checkbox replaces the actions. */
  select?: { selected: boolean; onToggle: () => void };
  /** Shows the quiet delete action (design 4.11 entry point). */
  onDelete?: () => void;
}) {
  return (
    <li className={cn(libraryRow, "animate-rise", select && libraryRowSelecting, select?.selected && libraryRowSelected)}>
      {select ? (
        <label className="grid h-11 w-7 cursor-pointer place-items-center">
          <input type="checkbox" className="size-5 cursor-pointer accent-primary" checked={select.selected} onChange={select.onToggle} />
          <span className="sr-only">{labels.select}</span>
        </label>
      ) : null}
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
      {select ? null : (
        <div className={libraryActions}>
          {onDelete ? (
            <Button size="icon-sm" variant="ghost-danger" aria-label={labels.delete} title={labels.delete} onClick={onDelete}>
              <Trash2Icon aria-hidden />
            </Button>
          ) : null}
          <Button asChild size="sm">
            <Link href={editHref}>{labels.edit}</Link>
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
      )}
    </li>
  );
}
