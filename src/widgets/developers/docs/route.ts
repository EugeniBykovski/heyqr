import "server-only";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { appEnv } from "@/server/config";
import { pageCopy, plain } from "./blocks";
import { isVisible, pageByPath, type DocsPage } from "./registry";

/** Release-gated pages render where previews are allowed (dev and preview builds), never in production. */
export const previewsAllowed = () => appEnv !== "production";

/** The page for a /developers path, or null when it doesn't exist or isn't shown here (the route answers 404). */
export function docsPageFor(segments: readonly string[] = []): { page: DocsPage; previews: boolean } | null {
  const page = pageByPath(segments.join("/"));
  const previews = previewsAllowed();
  return page && isVisible(page, previews) ? { page, previews } : null;
}

export async function docsMetadata(page: DocsPage): Promise<Metadata> {
  const t = await getTranslations("developers.docs");
  const copy = pageCopy(t.raw(`pages.${page.id}` as never));
  return {
    title: page.id === "overview" ? copy.title : `${copy.title} · ${t("breadcrumbRoot")}`,
    description: plain(copy.lead),
    // Gated pages never get indexed, even where they render.
    ...(page.visibility === "public" ? {} : { robots: { index: false, follow: false } }),
  };
}
