"use client";

import type { Layout } from "@heyqr/qr-core";
import { DownloadIcon, PencilIcon, Trash2Icon } from "lucide-react";
import { useRef, useState, type KeyboardEvent } from "react";
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
  printPackLabel,
  meta,
  paid,
  labels,
  select,
  onDelete,
  onRename,
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
  printPackLabel?: string;
  meta: string;
  paid: boolean;
  labels: {
    open: string;
    edit: string;
    download: string;
    buy: string;
    delete?: string;
    select?: string;
    rename?: { action: string; actionOne: string; label: string; save: string; cancel: string; empty: string };
  };
  /** Design 4.2 inline rename: saves through the server action; resolves false when it failed (the text stays). */
  onRename?: (name: string) => Promise<boolean>;
  /** Select mode (My QR codes · select): a checkbox replaces the actions. */
  select?: { selected: boolean; onToggle: () => void };
  /** Shows the quiet delete action (design 4.11 entry point). */
  onDelete?: () => void;
}) {
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState(name);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const renameButton = useRef<HTMLButtonElement>(null);
  const r = labels.rename;
  const startRename = () => {
    setDraft(name);
    setError(null);
    setRenaming(true);
  };
  const stopRename = () => {
    setRenaming(false);
    setError(null);
    // Focus goes back to Rename once the button is rendered again.
    requestAnimationFrame(() => renameButton.current?.focus());
  };
  const save = async () => {
    const next = draft.trim();
    if (!next) {
      setError(r?.empty ?? "");
      return;
    }
    if (next === name) return stopRename();
    if (!onRename) return;
    setSaving(true);
    const ok = await onRename(next);
    setSaving(false);
    if (ok) stopRename();
  };
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      void save();
    } else if (e.key === "Escape") {
      e.preventDefault();
      stopRename();
    }
  };
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
        {renaming && r ? (
          <div className="flex flex-col gap-1">
            <div className="flex flex-wrap items-center gap-1.5">
              <input
                autoFocus
                aria-label={r.label}
                aria-invalid={error ? true : undefined}
                aria-describedby={error ? `${href}-rename-error` : undefined}
                value={draft}
                maxLength={80}
                disabled={saving}
                onChange={(e) => {
                  setDraft(e.target.value);
                  setError(null);
                }}
                onKeyDown={onKey}
                className="border-border-control focus-visible:outline-focus-ring min-h-9.5 min-w-0 flex-1 rounded-md border bg-surface px-2.5 text-[0.9375rem] focus-visible:outline-2 aria-invalid:border-danger"
              />
              <Button
                type="button"
                size="sm"
                variant="primary"
                aria-busy={saving || undefined}
                disabled={saving}
                onClick={() => void save()}
              >
                {r.save}
              </Button>
              <Button type="button" size="sm" variant="ghost" disabled={saving} onClick={stopRename}>
                {r.cancel}
              </Button>
            </div>
            {error ? (
              <p id={`${href}-rename-error`} role="alert" className="text-caption font-medium text-danger">
                {error}
              </p>
            ) : null}
          </div>
        ) : (
          <Link href={href} title={name} className="truncate text-[1rem] font-bold underline-offset-3 hover:underline">
            {name}
          </Link>
        )}
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge>{typeLabel}</Badge>
          <Badge variant={model === "dynamic" ? "accent" : "neutral"}>{modelLabel}</Badge>
          <Badge variant={STATUS_VARIANT[status]}>{statusLabel}</Badge>
          {printPackLabel ? <Badge>{printPackLabel}</Badge> : null}
          <span className="text-caption text-muted-foreground">{meta}</span>
        </div>
      </div>
      {select ? null : (
        <div className={libraryActions}>
          {onRename && r && !renaming ? (
            <Button ref={renameButton} size="sm" variant="ghost" aria-label={r.actionOne} title={r.actionOne} onClick={startRename}>
              <PencilIcon aria-hidden />
              <span className="max-sm:sr-only">{r.action}</span>
            </Button>
          ) : null}
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
