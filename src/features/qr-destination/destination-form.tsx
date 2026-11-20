"use client";

import { CheckIcon, PencilIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { updateDestination } from "@/server/actions/qr";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import { Field } from "@/shared/ui/field";
import { Input } from "@/shared/ui/input";

const bare = (url: string) => url.replace(/^https?:\/\//i, "");

/*
 * Design 4.4–4.6 Dynamic destination: where the permanent short link leads. View: the address and Change destination;
 * editing: https:// + address, the hint and Save destination / Cancel; saved: the Saved badge and the previous address.
 * The server validates and stores it; the view only changes once the server confirmed the save.
 */
export function DestinationForm({ qrCodeId, destination, shortLink }: { qrCodeId: string; destination: string; shortLink: string }) {
  const t = useTranslations("qr.dest");
  const tErrors = useTranslations("errors");
  const [current, setCurrent] = useState(destination);
  const [previous, setPrevious] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(bare(destination));
  const [invalid, setInvalid] = useState(false);
  const [pending, start] = useTransition();

  const save = () =>
    start(async () => {
      const next = /^https?:\/\//i.test(value.trim()) ? value.trim() : `https://${value.trim()}`;
      const result = await updateDestination(qrCodeId, next).catch(() => ({ ok: false, error: "failed" }) as const);
      setInvalid(!result.ok && result.error === "invalid");
      if (result.ok) {
        setPrevious(current);
        setCurrent(next);
        setEditing(false);
      } else if (result.error !== "invalid") toast.error(tErrors("generic"));
    });

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-h3">{t("title")}</h2>
        {previous !== null && !editing ? (
          <Badge variant="success">
            <CheckIcon aria-hidden />
            {t("saved")}
          </Badge>
        ) : null}
      </div>
      {editing ? (
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
        >
          <Field id="destination" label={t("new")} hint={t("hint", { short: shortLink })} error={invalid ? tErrors("invalid") : undefined}>
            <div className="flex items-stretch">
              <span className="border-border-control grid place-items-center rounded-l-md border border-r-0 bg-subtle px-2.5 text-caption text-secondary-foreground">
                https://
              </span>
              <Input
                id="destination"
                inputMode="url"
                autoComplete="url"
                required
                autoFocus
                value={value}
                aria-invalid={invalid}
                aria-describedby={invalid ? "destination-error" : "destination-hint"}
                onChange={(e) => setValue(e.target.value.replace(/^https?:\/\//i, ""))}
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
                setInvalid(false);
                setValue(bare(current));
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
            <span className="text-body font-semibold break-all">{bare(current)}</span>
            {previous !== null ? (
              <span className="text-caption break-all text-muted-foreground">{t("previously", { url: bare(previous) })}</span>
            ) : null}
          </div>
          <Button
            type="button"
            className="self-start"
            onClick={() => {
              setValue(bare(current));
              setEditing(true);
            }}
          >
            <PencilIcon aria-hidden />
            {t("change")}
          </Button>
        </>
      )}
    </div>
  );
}
