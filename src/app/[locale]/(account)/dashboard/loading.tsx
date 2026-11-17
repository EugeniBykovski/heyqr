import { getTranslations } from "next-intl/server";
import { Skeleton } from "@/shared/ui/skeleton";
import { QrLibrarySkeleton } from "@/widgets/qr-library";
import { LibraryHeader } from "./library-header";

/** Network wait for the library: same header and row boxes as the loaded page, plus one polite status message. */
export default async function DashboardLoading() {
  const t = await getTranslations("dashboard");
  return (
    <div>
      <LibraryHeader title={t("title")} createLabel={t("new")} sub={<Skeleton className="mt-1 h-3.5 w-48 rounded-full" />} />
      <p role="status" className="sr-only">
        {t("loading")}
      </p>
      <Skeleton className="mb-3.5 h-11 w-full max-w-[23.75rem] rounded-full" />
      <QrLibrarySkeleton label={t("loading")} />
    </div>
  );
}
