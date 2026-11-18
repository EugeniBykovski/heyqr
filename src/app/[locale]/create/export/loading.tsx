import { getTranslations } from "next-intl/server";
import { ExportSkeleton } from "@/widgets/page-skeletons";

export default async function Loading() {
  const t = await getTranslations("loading");
  return <ExportSkeleton label={t("export")} />;
}
