"use client";

import type { Layout } from "@heyqr/qr-core";
import { useCallback, useEffect, useRef, useState } from "react";
import type { EditorDesign } from "@/entities/qr";
import type { ChangeOptions } from "./use-design-history";
import { causePatch, findScanningLogoSize, type ScanCause } from "./scan-guidance";
import { browserDecoder, useScanCheck, type Decoder } from "./use-scan-check";

/** "Reduce logo size" while it tries smaller sizes, or after none of them scanned. */
export type LogoSearch = { kind: "searching" } | { kind: "none"; tried: number };

/*
 * HEY-68: the scan check plus its fixes. A fix is one undoable edit that changes only its own setting; the freshly
 * rendered artwork is then checked again, so "Scan verified" always describes what the canvas shows. "Reduce logo size"
 * applies a size only after a render at that size decoded to the payload. Everything is tied to the artwork it started
 * from: an edit, Undo / Redo or layout switch meanwhile drops the work (nothing is applied to another layout).
 */
export function useScanGuidance({
  latest,
  design,
  change,
  decoder = browserDecoder,
  onLogoApplied,
  onFixApplied,
}: {
  latest: { layout: Layout; value: string };
  design: EditorDesign;
  change: (patch: Partial<EditorDesign>, opts?: ChangeOptions) => void;
  decoder?: Decoder;
  /** A decoder-confirmed logo size was applied (percentages). */
  onLogoApplied?: (from: number, to: number) => void;
  /** Any fix was applied (its button goes away with the failure it fixed). */
  onFixApplied?: () => void;
}) {
  const scan = useScanCheck(latest.layout, latest.value, decoder, design);
  const { check } = scan;
  // The artwork that is current right now, read by async work to tell whether it is still about the same artwork.
  const current = useRef(latest.layout);
  const changeRef = useRef(change);
  useEffect(() => {
    current.current = latest.layout;
    changeRef.current = change;
  });

  const [search, setSearch] = useState<{ layout: Layout; state: LogoSearch } | null>(null);
  // Set when a fix was applied from this artwork: the next artwork (the fix) is checked as soon as it is rendered.
  const verifyAfter = useRef<Layout | null>(null);
  useEffect(() => {
    if (!verifyAfter.current || verifyAfter.current === latest.layout) return;
    verifyAfter.current = null;
    check();
  }, [latest.layout, check]);

  const applyFix = useCallback(
    (patch: Partial<EditorDesign>) => {
      verifyAfter.current = latest.layout;
      changeRef.current(patch, { step: true });
      onFixApplied?.();
    },
    [latest.layout, onFixApplied],
  );

  const reduceLogo = useCallback(async () => {
    const start = latest.layout;
    setSearch({ layout: start, state: { kind: "searching" } });
    const settle = (state: LogoSearch | null) =>
      setSearch((s) => (s && s.layout === start ? (state ? { layout: start, state } : null) : s));
    try {
      const found = await findScanningLogoSize(design, latest.value, decoder, () => current.current === start);
      if (found.kind === "stale") return settle(null);
      if (found.kind === "none") return settle({ kind: "none", tried: found.tried });
      settle(null);
      applyFix({ logoSize: found.size });
      onLogoApplied?.(Math.round(design.logoSize * 100), Math.round(found.size * 100));
    } catch {
      settle({ kind: "none", tried: 0 });
    }
  }, [latest.layout, latest.value, design, decoder, applyFix, onLogoApplied]);

  /** The one-setting fix for a cause (logo: the decoder-confirmed size search). */
  const fixCause = useCallback(
    (cause: ScanCause) => {
      if (cause === "logo") return void reduceLogo();
      const patch = causePatch(cause, design);
      if (patch) applyFix(patch);
    },
    [design, reduceLogo, applyFix],
  );

  return {
    decode: scan.decode,
    check,
    fixCause,
    reduceLogo,
    /** Only for the artwork it ran on. */
    logoSearch: search && search.layout === latest.layout ? search.state : null,
  };
}
