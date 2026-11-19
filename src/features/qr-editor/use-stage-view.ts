"use client";

import { useEffect, useState } from "react";
import type { StageTone } from "@/shared/ui/stage";

export type StageFit = "fit" | "actual";
const KEY = "heyqr:stage-view";

/**
 * Design 1.12 viewing preferences: canvas background (Light / Dark / Clear) and Fit / Actual size. They are this
 * browser's preference, never part of the design, its history or its files. Storage may be unavailable; the defaults
 * then apply.
 */
export function useStageView() {
  const [tone, setTone] = useState<StageTone>("light");
  const [fit, setFit] = useState<StageFit>("fit");
  useEffect(() => {
    try {
      const saved = JSON.parse(window.localStorage.getItem(KEY) ?? "null") as { tone?: unknown; fit?: unknown } | null;
      // Restored after mount: the first render matches the server's and the loading skeleton.
      /* eslint-disable react-hooks/set-state-in-effect -- reading a browser-only preference after hydration */
      if (saved?.tone === "dark" || saved?.tone === "checker") setTone(saved.tone);
      if (saved?.fit === "actual") setFit("actual");
      /* eslint-enable react-hooks/set-state-in-effect */
    } catch {
      /* no stored preference */
    }
  }, []);
  const save = (next: { tone: StageTone; fit: StageFit }) => {
    try {
      window.localStorage.setItem(KEY, JSON.stringify(next));
    } catch {
      /* storage unavailable: the preference lasts for this page only */
    }
  };
  return {
    tone,
    fit,
    setTone: (t: StageTone) => {
      setTone(t);
      save({ tone: t, fit });
    },
    setFit: (f: StageFit) => {
      setFit(f);
      save({ tone, fit: f });
    },
  };
}
