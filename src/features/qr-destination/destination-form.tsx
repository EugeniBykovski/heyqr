"use client";

import { parseWebsiteUrl } from "@heyqr/qr-core";
import { CheckIcon, PencilIcon } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { updateDestination } from "@/server/actions/qr";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import { Field } from "@/shared/ui/field";
import { Input } from "@/shared/ui/input";

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
 */
export function DestinationForm({
  qrCodeId,
  destination,
  shortLink,
  previous: storedPrevious = null,
  changedAt: storedChangedAt = null,
}: {
  qrCodeId: string;
  destination: string;
  shortLink: string;
  /** HEY-123: the most recent change as stored (previous URL, ISO time). Older rows may have no time. */
  previous?: string | null;
  changedAt?: string | null;
}) {
  const t = useTranslations("qr.dest");
  const tErrors = useTranslations("errors");
  const tUrl = useTranslations("editor.errors");
  const locale = useLocale();
  const [current, setCurrent] = useState(destination);
  const [previous, setPrevious] = useState<string | null>(storedPrevious);
  const [changedAt, setChangedAt] = useState<string | null>(storedChangedAt);
  const [saved, setSaved] = useState(false);
  const [editing, setEditing] = useState(false);
  const [scheme, setScheme] = useState<Scheme>(splitScheme(destination).scheme ?? "https");
  const [value, setValue] = useState(splitScheme(destination).rest);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [pending, start] = useTransition();

  const open = () => {
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
      const result = await updateDestination(qrCodeId, next).catch(() => ({ ok: false, error: "failed" }) as const);
      if (result.ok) {
        // What the server stored: the same address keeps the earlier change as it was.
        setProblem(null);
        setCurrent(result.data.destination);
        setPrevious(result.data.previousDestination);
        setChangedAt(result.data.changedAt);
        setSaved(true);
        setEditing(false);
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
          <Field
            id="destination"
            label={t("new")}
            hint={t("hint", { short: shortLink })}
            error={problem ? tUrl(PROBLEM_KEY[problem]) : undefined}
          >
            <div className="flex items-stretch">
              <span
                data-slot="destination-scheme"
                className="border-border-control grid place-items-center rounded-l-md border border-r-0 bg-subtle px-2.5 text-caption text-secondary-foreground"
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
                className="min-w-0 rounded-l-none"
              />
            </div>
          </Field>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" variant="primary" disabled={pending || !value.trim()} aria-busy={pending || undefined}>
              {t("save")}
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
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
                    {t("changedAt")} {/* The viewer's own time zone: rendered in the browser, so the server's text may differ. */}
                    <time dateTime={changedAt} suppressHydrationWarning>
                      {new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(new Date(changedAt))}
                    </time>
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
