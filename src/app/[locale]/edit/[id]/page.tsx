import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { designFromSaved } from "@/entities/qr";
import { LayoutEditor } from "@/features/qr-editor";
import { redirect } from "@/i18n/navigation";
import { resolveLocale } from "@/i18n/server";
import { getSession } from "@/server/auth";
import { encodedValue } from "@/server/qr/export";
import { getLayoutForEdit } from "@/server/qr/repository";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("editor.edit");
  return { title: t("save"), robots: { index: false } };
}

/**
 * HEY-45 "Edit design": /edit/<code>?layout=<layout> opens the Design editor for that saved layout; without ?layout,
 * the code's first layout (the one My QR codes shows). Owner only, and never a deleted code: anything else is a 404, so
 * a direct URL reveals nothing about other accounts' codes. Direct navigation and refresh load the saved state.
 */
export default async function EditDesignPage({ params, searchParams }: PageProps<"/[locale]/edit/[id]">) {
  const locale = await resolveLocale(params);
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const layoutParam = typeof query.layout === "string" ? query.layout : undefined;
  const session = await getSession();
  if (!session) {
    const here = `/edit/${encodeURIComponent(id)}${layoutParam ? `?layout=${encodeURIComponent(layoutParam)}` : ""}`;
    return redirect({ href: `/sign-in?next=${encodeURIComponent(here)}`, locale });
  }
  const found = await getLayoutForEdit(session.user.id, id, layoutParam);
  if (!found) notFound();
  const { qr, layout } = found;
  return (
    <LayoutEditor
      key={`${qr.id}:${layout.id}`}
      qrCodeId={qr.id}
      layoutId={layout.id}
      layoutName={layout.name}
      initialDesign={designFromSaved(qr, layout.design)}
      value={encodedValue(qr)}
      detailsHref={`/dashboard/qr/${qr.id}`}
    />
  );
}
