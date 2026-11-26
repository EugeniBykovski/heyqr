"use client";

import { useEffect } from "react";
import { useRouter } from "@/i18n/navigation";
import { LEGACY_ANCHORS } from "./registry";

/**
 * Section deep links (/developers/scan#node). The page streams in after the app's loading skeleton, so the browser's
 * own jump to the hash finds nothing; this repeats it once the section exists. On the overview, links to the old
 * single-page /developers (e.g. #dv-install) are forwarded to the page that holds that section now, replacing the
 * history entry (the hash never reaches the server).
 */
export function HashTarget({ legacy }: { legacy: boolean }) {
  const router = useRouter();
  useEffect(() => {
    const hash = decodeURIComponent(window.location.hash.slice(1));
    if (!hash) return;
    const target = legacy ? LEGACY_ANCHORS[hash] : undefined;
    if (target && target !== "/developers") {
      router.replace(target);
      return;
    }
    document.getElementById(hash)?.scrollIntoView();
  }, [legacy, router]);
  return null;
}
