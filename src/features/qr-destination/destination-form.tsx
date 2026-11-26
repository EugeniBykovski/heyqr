"use client";

import { parseWebsiteUrl } from "@heyqr/qr-core";
import { CheckIcon, PencilIcon, RefreshCwIcon, TriangleAlertIcon } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { updateDestination } from "@/server/actions/qr";
import type { DestinationState } from "@/server/qr/destination";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import { Field } from "@/shared/ui/field";
import { Input } from "@/shared/ui/input";
import { LocalTime } from "@/shared/ui/local-time";

type Scheme = "https" | "http";
type Problem = "empty" | "spaces" | "invalid";
const PROBLEM_KEY = { empty: "urlEmpty", spaces: "urlSpaces", invalid: "urlInvalid" } as const;

/** HEY-119: an address split into its scheme and the rest. Without a scheme it stays as typed (a bare domain). */
export function splitScheme(url: string): { scheme: Scheme | null; rest: string } {
  const m = /^\s*(https?):\/\//i.exec(url);
  return m ? { scheme: (m[1] ?? "https").toLowerCase() as Scheme, rest: url.slice(m[0].length) } : { scheme: null, rest: url };
}

/*
 * Design 4.4–4.6 Dynamic destination: where the permanent short link leads. View: the address and Change destination;
 * editing: scheme + address, the hint and Save destination / Cancel; saved: the Saved badge and the previous address.
 * HEY-119: the field opens with the current scheme (http:// stays http://). Typing or pasting a full http:// or https://
 * address sets the scheme; a bare domain keeps the one shown. The server checks it with the editor's parser and the
 * view shows the URL it stored; a refused address shows the field error and changes nothing.
 * HEY-128: the edit keeps the destination revision it was opened with and sends it on save. If the destination changed
 * elsewhere meanwhile (another tab or device), the server refuses with the latest state: the form says what is published
 * now, keeps the typed address and doesn't save until the owner loads the latest version and saves again.
 */
export function DestinationForm({
  qrCodeId,
  destination,
  shortLink,
  previous: storedPrevious = null,
  changedAt: storedChangedAt = null,
  revision: storedRevision,
}: {
  qrCodeId: string;
  destination: string;
  shortLink: string;
  /** HEY-123: the most recent change as stored (previous URL, ISO time). Older rows may have no time. */
  previous?: string | null;
  changedAt?: string | null;
  /** HEY-128: the stored destination revision this page was rendered with. */
  revision: number;
}) {
  const t = useTranslations("qr.dest");
  const tErrors = useTranslations("errors");
  const tUrl = useTranslations("editor.errors");
  const locale = useLocale();
  const [current, setCurrent] = useState(destination);
  const [previous, setPrevious] = useState<string | null>(storedPrevious);
  const [changedAt, setChangedAt] = useState<string | null>(storedChangedAt);
  // HEY-128: the latest revision this form knows, and the one the open edit started from.
  const [revision, setRevision] = useState(storedRevision);
  const [editRevision, setEditRevision] = useState(storedRevision);
  const [conflict, setConflict] = useState<DestinationState | null>(null);
  const [reviewing, setReviewing] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [editing, setEditing] = useState(false);
  const [scheme, setScheme] = useState<Scheme>(splitScheme(destination).scheme ?? "https");
  const [value, setValue] = useState(splitScheme(destination).rest);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [pending, start] = useTransition();

  const show = (state: DestinationState) => {
    setCurrent(state.destination);
    setPrevious(state.previousDestination);
    setChangedAt(state.changedAt);
    setRevision(state.revision);
  };
  const open = () => {
    setEditRevision(revision);
    setConflict(null);
    setReviewing(null);
    const parts = splitScheme(current);
    setScheme(parts.scheme ?? "https");
    setValue(parts.rest);
    setProblem(null);
    setEditing(true);
  };
  const type = (typed: string) => {
    const parts = splitScheme(typed);
    if (parts.scheme) setScheme(parts.scheme);
    setValue(parts.rest);
  };

  const save = () =>
    start(async () => {
      const next = `${scheme}://${value.trim()}`;
      // The same parser the server uses: an obvious mistake is shown without a round trip.
      const local = parseWebsiteUrl(value.trim() ? next : "");
      if (!local.ok) {
        setProblem(local.problem);
        return;
      }
      const result = await updateDestination(qrCodeId, next, editRevision).catch(() => ({ ok: false, error: "failed" }) as const);
      if (result.ok) {
        // What the server stored: the same address keeps the earlier change as it was.
        setProblem(null);
        show(result.data);
        setSaved(true);
        setEditing(false);
      } else if ("latest" in result) {
        // Changed elsewhere since this edit opened: nothing was saved; the typed address stays.
        setProblem(null);
        setReviewing(null);
        setConflict(result.latest);
      } else if (result.error === "invalid") setProblem("problem" in result && result.problem ? result.problem : "invalid");
      else toast.error(tErrors("generic"));
    });

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-h3">{t("title")}</h2>
        {saved && !editing ? (
          <Badge variant="success">
            <CheckIcon aria-hidden />
            {t("saved")}
          </Badge>
        ) : null}
      </div>
      {editing ? (
        <form
          className="flex flex-col gap-3"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
        >
          {conflict ? (
            <div role="alert" data-slot="destination-conflict" className="flex flex-col gap-2 rounded-lg bg-warning-soft px-3.5 py-3">
              <p className="flex items-start gap-2 text-label">
                <TriangleAlertIcon aria-hidden className="mt-0.5 size-4 shrink-0" />
                {t("conflict.title")}
              </p>
              <p className="text-caption break-all text-secondary-foreground">{t("conflict.text", { url: conflict.destination })}</p>
              <Button
                type="button"
                size="sm"
                className="self-start"
                onClick={() => {
                  // Explicit: the latest version becomes the base of this edit; the typed address is kept for review.
                  show(conflict);
                  setEditRevision(conflict.revision);
                  setReviewing(conflict.destination);
                  setConflict(null);
                }}
              >
                <RefreshCwIcon aria-hidden />
                {t("conflict.load")}
              </Button>
            </div>
          ) : reviewing !== null ? (
            <p role="status" data-slot="destination-reviewing" className="text-caption break-all text-secondary-foreground">
              {t("conflict.loaded", { url: reviewing })}
            </p>
          ) : null}
          <Field
            id="destination"
            label={t("new")}
            hint={t("hint", { short: shortLink })}
            error={problem ? tUrl(PROBLEM_KEY[problem]) : undefined}
          >
            {/* HEY-192: scheme + address is one web address, read left to right in every language. */}
            <div dir="ltr" className="flex items-stretch">
              <span
                data-slot="destination-scheme"
                className="border-border-control grid place-items-center rounded-s-md border border-e-0 bg-subtle px-2.5 text-caption text-secondary-foreground"
              >
                {scheme}://
              </span>
              <Input
                id="destination"
                inputMode="url"
                autoComplete="url"
                required
                autoFocus
                value={value}
                aria-invalid={problem !== null}
                aria-describedby={problem ? "destination-error" : "destination-hint"}
                onChange={(e) => type(e.target.value)}
                className="min-w-0 rounded-s-none"
              />
            </div>
          </Field>
          <div className="flex flex-wrap gap-2">
            <Button
              type="submit"
              variant="primary"
              disabled={pending || !value.trim() || conflict !== null}
              aria-busy={pending || undefined}
            >
              {t("save")}
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                // After a conflict the view shows what is published now.
                if (conflict) show(conflict);
                setConflict(null);
                setReviewing(null);
                setEditing(false);
                setProblem(null);
              }}
            >
              {t("cancel")}
            </Button>
          </div>
        </form>
      ) : (
        <>
          <div className="flex min-w-0 flex-col gap-0.5 rounded-lg bg-subtle px-3.5 py-3">
            <span className="text-caption text-muted-foreground">{t("goesTo", { short: shortLink })}</span>
            <span data-slot="destination-current" className="text-body font-semibold break-all">
              {current}
            </span>
            {previous !== null ? (
              <span data-slot="destination-previous" className="text-caption break-all text-muted-foreground">
                {t("previously", { url: previous })}
                {changedAt ? (
                  <>
                    {" · "}
                    {t("changedAt")} <LocalTime iso={changedAt} locale={locale} />
                  </>
                ) : null}
              </span>
            ) : null}
          </div>
          <Button type="button" className="self-start" onClick={open}>
            <PencilIcon aria-hidden />
            {t("change")}
          </Button>
        </>
      )}
    </div>
  );
}
