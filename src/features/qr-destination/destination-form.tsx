"use client";

import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { updateDestination } from "@/server/actions/qr";
import { Button } from "@/shared/ui/button";
import { Field } from "@/shared/ui/field";
import { Input } from "@/shared/ui/input";

/** Dynamic codes: edit where the printed code leads. */
export function DestinationForm({ qrCodeId, destination }: { qrCodeId: string; destination: string }) {
  const t = useTranslations("qr");
  const tErrors = useTranslations("errors");
  const [value, setValue] = useState(destination);
  const [invalid, setInvalid] = useState(false);
  const [pending, start] = useTransition();

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const result = await updateDestination(qrCodeId, value);
          setInvalid(!result.ok && result.error === "invalid");
          if (result.ok) toast.success(t("saved"));
          else if (result.error !== "invalid") toast.error(tErrors("generic"));
        });
      }}
    >
      <Field id="destination" label={t("destination")} hint={t("destinationHint")} error={invalid ? tErrors("invalid") : undefined}>
        <Input
          id="destination"
          type="url"
          inputMode="url"
          required
          value={value}
          aria-invalid={invalid}
          aria-describedby={invalid ? "destination-error" : "destination-hint"}
          onChange={(e) => setValue(e.target.value)}
        />
      </Field>
      <Button type="submit" variant="primary" className="self-start" disabled={pending || value === destination}>
        {t("save")}
      </Button>
    </form>
  );
}
