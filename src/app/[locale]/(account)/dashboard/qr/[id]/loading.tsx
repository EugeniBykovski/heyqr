import { getTranslations } from "next-intl/server";
import { QrDetailsSkeleton } from "@/widgets/page-skeletons";

export default async function Loading() {
  const t = await getTranslations("loading");
  return <QrDetailsSkeleton label={t("details")} />;
}
