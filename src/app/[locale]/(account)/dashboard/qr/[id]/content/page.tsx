import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { env } from "@/env";
import { readHostedContent } from "@/entities/qr";
import { HostedPageEditor } from "@/features/qr-editor";
import { resolveLocale } from "@/i18n/server";
import { getQrCode } from "@/server/qr/repository";
import { previewShortLink, shortLinkUrl } from "@/shared/lib/short-link";
import { requireAccount } from "../../../../require-account";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("qr.hostedEditor");
  return { title: t("title"), robots: { index: false } };
}

/** QR details → Edit page (hosted codes only): the owner's draft in the page editor. */
export default async function HostedContentPage({ params, searchParams }: PageProps<"/[locale]/dashboard/qr/[id]/content">) {
  const locale = await resolveLocale(params);
  const { id } = await params;
  const user = await requireAccount(locale, `/dashboard/qr/${encodeURIComponent(id)}/content`, await searchParams);
  const qr = await getQrCode(user.id, id);
  const content = qr ? readHostedContent(qr.content) : null;
  if (!qr || !content) notFound();
  const short = (
    qr.shortCode ? shortLinkUrl(env.NEXT_PUBLIC_SHORT_LINK_BASE, qr.shortCode) : previewShortLink(env.NEXT_PUBLIC_SHORT_LINK_BASE)
  ).replace(/^https?:\/\//, "");
  return <HostedPageEditor qrCodeId={qr.id} initial={content} shortLabel={short} />;
}
