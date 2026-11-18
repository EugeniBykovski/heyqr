import { getTranslations } from "next-intl/server";
import { PageSkeleton } from "@/widgets/page-skeletons";

export default async function Loading() {
  const t = await getTranslations("loading");
  return <PageSkeleton label={t("page")} />;
}
