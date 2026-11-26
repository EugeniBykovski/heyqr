import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { resolveLocale } from "@/i18n/server";
import { DocsPage, docsMetadata, docsPageFor } from "@/widgets/developers";

export async function generateMetadata({ params }: PageProps<"/[locale]/developers/[...slug]">): Promise<Metadata> {
  await resolveLocale(params);
  const found = docsPageFor((await params).slug);
  return found ? docsMetadata(found.page) : {};
}

/** Design 12.2–12.22: one docs page by its path; release-gated pages 404 where previews aren't allowed. */
export default async function DeveloperDocsPage({ params }: PageProps<"/[locale]/developers/[...slug]">) {
  await resolveLocale(params);
  const found = docsPageFor((await params).slug);
  if (!found) notFound();
  return <DocsPage page={found.page} previews={found.previews} />;
}
