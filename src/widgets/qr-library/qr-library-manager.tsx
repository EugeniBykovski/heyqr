"use client";

import type { Layout } from "@heyqr/qr-core";
import { CircleAlertIcon, ListChecksIcon, Trash2Icon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useMemo, useState, useTransition, type ReactNode } from "react";
import { toast } from "sonner";
import { QrPreview } from "@/entities/qr";
import { useRouter } from "@/i18n/navigation";
import { deleteQrs, restoreQrs } from "@/server/actions/qr";
import { cn } from "@/shared/lib/utils";
import { Button } from "@/shared/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/shared/ui/dialog";
import { libraryList } from "./layout";
import { LibraryHeader } from "./library-header";
import { QrCard, type QrCardStatus } from "./qr-card";

/** Everything a card needs, plus what the delete dialog explains (model, paid, short link). Serializable from the page. */
export type LibraryItem = {
  id: string;
  name: string;
  href: string;
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
  /** Dynamic codes: the printed short link, named in the delete warning. */
  shortLink?: string;
  labels: { open: string; edit: string; download: string; buy: string };
};

const UNDO_MS = 8000;

/**
 * Design "My QR codes" 4.2 + 4.10–4.12: the list, Select mode with a sticky bulk bar, a delete action per card,
 * a confirm dialog that says what deleting does to each kind of code, and an Undo toast.
 * Deleting is a server soft delete, so Undo restores the codes exactly.
 */
export function QrLibraryManager({
  title,
  sub,
  createLabel,
  filters,
  items,
  total,
}: {
  title: string;
  sub: ReactNode;
  createLabel: string;
  filters: ReactNode;
  items: LibraryItem[];
  /** Codes across all filters, for "2 of 5 selected". */
  total: number;
}) {
  const t = useTranslations("dashboard.manage");
  const router = useRouter();
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [confirmIds, setConfirmIds] = useState<string[] | null>(null);
  const [hidden, setHidden] = useState<string[]>([]);
  const [pending, startTransition] = useTransition();

  const visible = useMemo(() => items.filter((i) => !hidden.includes(i.id)), [items, hidden]);
  const visibleIds = visible.map((i) => i.id);
  const chosen = selected.filter((id) => visibleIds.includes(id));
  const allChosen = visibleIds.length > 0 && visibleIds.every((id) => chosen.includes(id));
  const toDelete = (confirmIds ?? []).map((id) => items.find((i) => i.id === id)).filter((i): i is LibraryItem => Boolean(i));

  const toggleMode = () => {
    setSelecting((s) => !s);
    setSelected([]);
  };
  const toggle = (id: string) => setSelected((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));
  const toggleAll = () => setSelected(allChosen ? [] : visibleIds);

  const restore = (ids: string[]) =>
    startTransition(async () => {
      const result = await restoreQrs(ids);
      if (!result.ok) {
        toast.error(t("restoreFailed"));
        return;
      }
      setHidden((h) => h.filter((id) => !ids.includes(id)));
      toast.success(ids.length === 1 ? t("restoredOne") : t("restoredMany", { count: ids.length }), { id: "qr-delete" });
      router.refresh();
    });

  const confirm = () => {
    const gone = toDelete;
    const ids = gone.map((i) => i.id);
    setConfirmIds(null);
    setSelecting(false);
    setSelected([]);
    setHidden((h) => [...h, ...ids]);
    startTransition(async () => {
      const result = await deleteQrs(ids);
      if (!result.ok) {
        setHidden((h) => h.filter((id) => !ids.includes(id)));
        toast.error(t("deleteFailed"));
        return;
      }
      const done = result.data.ids;
      toast(gone.length === 1 && gone[0] ? t("deletedOne", { name: gone[0].name }) : t("deletedMany", { count: done.length }), {
        id: "qr-delete",
        duration: UNDO_MS,
        action: { label: t("undo"), onClick: () => restore(done) },
      });
      router.refresh();
    });
  };

  const dynamicPaid = toDelete.filter((i) => i.model === "dynamic" && i.paid);
  const staticPaid = toDelete.filter((i) => i.model === "static" && i.paid);
  const drafts = toDelete.filter((i) => !i.paid);

  return (
    <div>
      <LibraryHeader
        title={title}
        sub={sub}
        createLabel={createLabel}
        actions={
          items.length ? (
            <Button aria-pressed={selecting} onClick={toggleMode}>
              <ListChecksIcon aria-hidden />
              {selecting ? t("done") : t("select")}
            </Button>
          ) : null
        }
      />
      {filters}

      {selecting ? (
        <div
          role="region"
          aria-label={t("select")}
          className="sticky top-[calc(var(--spacing-header)+0.5rem)] z-20 mb-3.5 flex animate-rise flex-wrap items-center gap-x-4 gap-y-2 rounded-lg bg-inverse py-2 pr-2 pl-4 text-inverse-foreground shadow-2"
        >
          <label className="flex min-h-9 cursor-pointer items-center gap-2.5 text-[0.875rem] font-semibold">
            <input type="checkbox" className="size-5 cursor-pointer accent-primary" checked={allChosen} onChange={toggleAll} />
            {t("selectAll")}
          </label>
          <span aria-live="polite" className="text-[0.875rem] text-inverse-muted tabular-nums">
            {chosen.length ? t("selected", { count: chosen.length, total }) : t("chooseToDelete")}
          </span>
          <div className="ml-auto flex gap-1.5">
            <Button size="sm" variant="ghost" className="text-inverse-foreground hover:bg-inverse-foreground/8" onClick={toggleMode}>
              {t("cancel")}
            </Button>
            <Button size="sm" variant="danger-solid" disabled={chosen.length === 0} onClick={() => setConfirmIds(chosen)}>
              <Trash2Icon aria-hidden />
              {t("deleteSelected", { count: chosen.length })}
            </Button>
          </div>
        </div>
      ) : null}

      <ul aria-label={title} aria-busy={pending || undefined} className={libraryList}>
        {visible.map((item) => (
          <QrCard
            key={item.id}
            {...item}
            labels={{ ...item.labels, delete: t("deleteOne", { name: item.name }), select: t("selectOne", { name: item.name }) }}
            select={selecting ? { selected: chosen.includes(item.id), onToggle: () => toggle(item.id) } : undefined}
            onDelete={() => setConfirmIds([item.id])}
          />
        ))}
      </ul>

      <Dialog open={toDelete.length > 0} onOpenChange={(open) => !open && setConfirmIds(null)}>
        <DialogContent role="alertdialog" closeLabel={t("dialog.close")}>
          <DialogTitle>
            {toDelete.length === 1 && toDelete[0]
              ? t("dialog.titleOne", { name: toDelete[0].name })
              : t("dialog.titleMany", { count: toDelete.length })}
          </DialogTitle>
          <DialogDescription>{toDelete.length === 1 ? t("dialog.leadOne") : t("dialog.leadMany")}</DialogDescription>
          <ul className="flex max-h-55 flex-col gap-2 overflow-auto">
            {toDelete.map((i) => (
              <li key={i.id} className="flex items-center gap-3 rounded-md bg-subtle p-2">
                <span className="grid size-10 shrink-0 place-items-center rounded-sm bg-surface p-1">
                  {i.layout ? <QrPreview layout={i.layout} value={i.value} label={i.name} className="size-full" /> : null}
                </span>
                <span className="flex min-w-0 flex-col gap-0.5">
                  <span className="truncate text-label">{i.name}</span>
                  <span className="text-caption text-muted-foreground">
                    {t(i.model === "dynamic" ? "dialog.metaDynamic" : "dialog.metaStatic")} ·{" "}
                    {t(i.paid ? (i.model === "dynamic" ? "dialog.metaActive" : "dialog.metaPurchased") : "dialog.metaDraft")}
                  </span>
                </span>
              </li>
            ))}
          </ul>
          <div className="flex flex-col gap-2.5">
            {dynamicPaid.length ? (
              <Consequence warn title={t("dialog.dynamicTitle", { count: dynamicPaid.length })}>
                {t("dialog.dynamicText", { count: dynamicPaid.length, links: dynamicPaid.map((i) => i.shortLink ?? i.name).join(", ") })}
              </Consequence>
            ) : null}
            {staticPaid.length ? (
              <Consequence title={t("dialog.staticTitle")}>{t("dialog.staticText", { count: staticPaid.length })}</Consequence>
            ) : null}
            {drafts.length ? (
              <Consequence title={t("dialog.draftTitle", { count: drafts.length })}>
                {t("dialog.draftText", { count: drafts.length })}
              </Consequence>
            ) : null}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="danger-solid" onClick={confirm}>
              <Trash2Icon aria-hidden />
              {toDelete.length === 1 ? t("dialog.confirmOne") : t("dialog.confirmMany", { count: toDelete.length })}
            </Button>
            <Button variant="ghost" onClick={() => setConfirmIds(null)}>
              {t("cancel")}
            </Button>
          </div>
          <p className="text-caption text-muted-foreground">{t("dialog.undoNote")}</p>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** Design "delpt": one consequence of deleting; the warning tone is for links that stop working. */
function Consequence({ title, children, warn }: { title: string; children: ReactNode; warn?: boolean }) {
  return (
    <div
      className={cn(
        "flex items-start gap-2.5 rounded-md px-3.5 py-3 text-[0.875rem] leading-[1.45] text-secondary-foreground",
        warn ? "bg-danger-soft" : "bg-subtle",
      )}
    >
      <CircleAlertIcon aria-hidden className={cn("mt-0.5 size-4 shrink-0", warn ? "text-danger" : "text-muted-foreground")} />
      <span className="flex flex-col gap-0.5">
        <b className={warn ? "text-danger" : "text-foreground"}>{title}</b>
        <span>{children}</span>
      </span>
    </div>
  );
}
