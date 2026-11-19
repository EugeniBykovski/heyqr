import { getTranslations } from "next-intl/server";
import { Skeleton, SkeletonText, skeletonReveal } from "@/shared/ui/skeleton";
import { LibraryHeader, QrLibrarySkeleton } from "@/widgets/qr-library";

/** Network wait for the library: same header and row boxes as the loaded page, plus one polite status message. */
export default async function DashboardLoading() {
  const t = await getTranslations("dashboard");
  return (
    <div className={skeletonReveal}>
      <LibraryHeader title={t("title")} createLabel={t("new")} sub={<SkeletonText barClassName="w-48" />} />
      <p role="status" className="sr-only">
        {t("loading")}
      </p>
      <Skeleton className="mb-3.5 h-11 w-full max-w-[23.75rem] rounded-full" />
      <QrLibrarySkeleton label={t("loading")} />
    </div>
  );
}
