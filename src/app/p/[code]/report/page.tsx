import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { applyVisitorLocale } from "../../locale";
import { HostedShell } from "../shell";
import { ReportForm } from "./report-form";

export async function generateMetadata(): Promise<Metadata> {
  await applyVisitorLocale();
  const t = await getTranslations("hosted.reportForm");
  return { title: t("title") };
}

/** "Report this page" (design 11.0 footer): a short form, stored for review. */
export default async function ReportPage({ params }: PageProps<"/p/[code]/report">) {
  await applyVisitorLocale();
  const { code } = await params;
  return (
    <HostedShell>
      <ReportForm code={code} />
    </HostedShell>
  );
}
