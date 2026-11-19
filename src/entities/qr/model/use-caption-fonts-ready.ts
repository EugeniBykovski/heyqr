"use client";

import { captionFaces, type Layout } from "@heyqr/qr-core";
import { useEffect, useState } from "react";

/** CSS font shorthands for the faces a layout's caption draws with (none without a caption). */
export function captionFontQueries(layout: Layout): string[] {
  if (!layout.caption.text || layout.preset === "qr") return [];
  const { font, weights } = captionFaces(layout.caption);
  return weights.map((w) => `${w} 16px '${font.family}'`);
}

/**
 * HEY-44: whether the caption's font faces have loaded. Until they have, the preview must not pass a stand-in font
 * off as the final look, so callers mark it as still updating. Faces already loaded report ready on the first render.
 */
export function useCaptionFontsReady(layout: Layout): boolean {
  const key = captionFontQueries(layout).join("|");
  const allLoaded = (k: string) =>
    typeof document === "undefined" || !document.fonts || k.split("|").every((q) => !q || document.fonts.check(q));
  const [loaded, setLoaded] = useState<string | null>(() => (allLoaded(key) ? key : null));
  useEffect(() => {
    if (loaded === key || allLoaded(key)) return;
    let live = true;
    Promise.all(key.split("|").map((q) => document.fonts.load(q)))
      .catch(() => [])
      .then(() => live && setLoaded(key));
    return () => {
      live = false;
    };
  }, [key, loaded]);
  return loaded === key || allLoaded(key);
}
