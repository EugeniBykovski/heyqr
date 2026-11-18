import { getTranslations } from "next-intl/server";
import { BillingSkeleton } from "@/widgets/page-skeletons";

export default async function Loading() {
  const t = await getTranslations("loading");
  return <BillingSkeleton label={t("billing")} />;
}
