import { getTranslations } from "next-intl/server";
import { applyVisitorLocale } from "../locale";
import { HostedPageSkeleton } from "@/entities/hosted-page";
import { HostedShell } from "./shell";

/** Design 11.0 "Loading": neutral shapes in the page's layout, no owner content and no branding. */
export default async function Loading() {
  await applyVisitorLocale();
  const t = await getTranslations("hosted");
  return (
    <HostedShell>
      <div aria-busy>
        <HostedPageSkeleton />
        <p role="status" className="sr-only">
          {t("loading")}
        </p>
      </div>
    </HostedShell>
  );
}
