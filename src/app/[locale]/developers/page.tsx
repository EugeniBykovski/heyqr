import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { resolveLocale } from "@/i18n/server";
import { DocsPage, docsMetadata, docsPageFor } from "@/widgets/developers";

export async function generateMetadata({ params }: PageProps<"/[locale]/developers">): Promise<Metadata> {
  await resolveLocale(params);
  const found = docsPageFor([]);
  return found ? docsMetadata(found.page) : {};
}

/** Design 12.1: the developer docs overview. */
export default async function Developers({ params }: PageProps<"/[locale]/developers">) {
  await resolveLocale(params);
  const found = docsPageFor([]);
  if (!found) notFound();
  return <DocsPage page={found.page} previews={found.previews} />;
}
