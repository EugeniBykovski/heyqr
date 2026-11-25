import { getTranslations } from "next-intl/server";
import { applyVisitorLocale } from "../locale";
import { Skeleton } from "@/shared/ui/skeleton";
import { HostedShell } from "./shell";

/** Design 11.0 "Loading": neutral shapes in the page's layout, no owner content and no branding. */
export default async function Loading() {
  await applyVisitorLocale();
  const t = await getTranslations("hosted");
  return (
    <HostedShell>
      <div aria-busy className="flex flex-col gap-3 px-3 py-1">
        <Skeleton className="h-30 rounded-[1.125rem]" />
        <Skeleton className="h-5 w-3/5 rounded-full" />
        <Skeleton className="h-3 w-4/5 rounded-full" />
        <Skeleton className="h-3 w-2/3 rounded-full" />
        <Skeleton className="mt-2 h-11 rounded-full" />
        <p role="status" className="sr-only">
          {t("loading")}
        </p>
      </div>
    </HostedShell>
  );
}
