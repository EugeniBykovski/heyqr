"use client";

import type { Layout } from "@heyqr/qr-core";
import { useCallback, useState } from "react";
import { composeShared } from "@/entities/qr";

/** Where the browser loads the ZXing reader from (the app's own route, never a CDN). */
export const READER_WASM_URL = "/api/scan/reader-wasm?v=3.1.7";

export type ScanDecode =
  { kind: "checking" } | { kind: "ok"; decoded: string } | { kind: "unreadable"; decoded: string | null } | { kind: "error" };

/** Decodes a layout's artwork; tests replace it to control timing. */
export type Decoder = (svg: string) => Promise<string | null>;

const browserDecoder: Decoder = async (svg) => {
  const { decodeSvgInBrowser } = await import("@heyqr/qr-core/verify-browser");
  return decodeSvgInBrowser(svg, { wasmUrl: READER_WASM_URL });
};

/** One decode per artwork: a second click on the same render shares the check already running. */
const running = new WeakMap<Layout, Map<string, Promise<string | null>>>();
function decodeOnce(layout: Layout, value: string, decoder: Decoder): Promise<string | null> {
  let byValue = running.get(layout);
  if (!byValue) {
    byValue = new Map();
    running.set(layout, byValue);
  }
  const hit = byValue.get(value);
  if (hit) return hit;
  const promise = decoder(composeShared(layout, value).svg);
  byValue.set(value, promise);
  // A failure can be retried; a finished result stays shared for this exact artwork.
  promise.catch(() => byValue?.delete(value));
  return promise;
}

/*
 * HEY-67: the user-triggered scan check. It decodes the active layout's latest artwork (the same composition the canvas
 * and export draw: colours, shapes, logo, quiet zone) and passes only when the decoded text equals the expected payload.
 * Each result belongs to the layout object and value it checked: any edit, Undo / Redo or layout switch makes a new
 * layout object, so an older result (even one that finishes later) is never shown for the new artwork.
 */
export function useScanCheck(layout: Layout, value: string, decoder: Decoder = browserDecoder) {
  const [result, setResult] = useState<{ layout: Layout; value: string; decode: ScanDecode } | null>(null);
  const check = useCallback(() => {
    const target = { layout, value };
    setResult({ ...target, decode: { kind: "checking" } });
    const settle = (decode: ScanDecode) =>
      // Only the result for the artwork it checked: a newer check or newer artwork wins.
      setResult((current) =>
        current && current.layout === target.layout && current.value === target.value ? { ...target, decode } : current,
      );
    decodeOnce(layout, value, decoder).then(
      (decoded) => settle(decoded === value ? { kind: "ok", decoded } : { kind: "unreadable", decoded }),
      () => settle({ kind: "error" }),
    );
  }, [layout, value, decoder]);
  const current = result && result.layout === layout && result.value === value ? result.decode : null;
  return { decode: current, check };
}
