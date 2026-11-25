import { CircleSlashIcon } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { applyVisitorLocale } from "../locale";
import { HostedShell } from "./shell";

/** Design 11.0 "Unavailable": the same neutral answer for unknown, paused, unpublished or deleted pages. */
export async function Unavailable() {
  await applyVisitorLocale();
  const t = await getTranslations("hosted");
  return (
    <HostedShell>
      <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 py-16 text-center">
        <span className="grid size-16 place-items-center rounded-full bg-subtle text-muted-foreground">
          <CircleSlashIcon aria-hidden className="size-7" />
        </span>
        <h1 className="text-h3">{t("unavailableTitle")}</h1>
        <p className="max-w-[22rem] text-caption text-secondary-foreground">{t("unavailableText")}</p>
      </div>
    </HostedShell>
  );
}
