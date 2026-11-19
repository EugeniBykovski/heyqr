"use client";

import { useCallback, useRef, useState } from "react";
import type { EditorDesign } from "@/entities/qr";

/** Keys that are the code's content and identity, not its design: Undo never touches them. */
const NOT_DESIGN = new Set<string>(["name", "model", "content"]);
/** Changes to the same settings within this window are one step (typing a colour, dragging a slider). */
export const HISTORY_MERGE_MS = 600;
const LIMIT = 100;

type Snapshot = Partial<EditorDesign>;

const designPart = (d: EditorDesign): Snapshot => {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(d)) if (!NOT_DESIGN.has(k)) out[k] = v;
  return out as Snapshot;
};

/** The patch that turns `from` into `to`: every design key of either, so a setting `to` doesn't have is cleared. */
export function patchBetween(from: Snapshot, to: Snapshot): Partial<EditorDesign> {
  const patch: Record<string, unknown> = {};
  for (const k of new Set([...Object.keys(from), ...Object.keys(to)])) patch[k] = (to as Record<string, unknown>)[k];
  return patch as Partial<EditorDesign>;
}

/*
 * Design 1.12 Undo / Redo for the Design step. Every settings change is one step; a quick-style preset is one step
 * however many settings it sets; repeated changes to the same settings within HISTORY_MERGE_MS merge (typing, sliders).
 * Only design settings are recorded: content, mode and name stay as they are. Viewing preferences (stage background,
 * zoom) never enter the history. The editor state stays owned by its editor (draft or saved layout): Undo and Redo
 * apply patches through the same update path as every control.
 */
export function useDesignHistory(design: EditorDesign, apply: (patch: Partial<EditorDesign>) => void) {
  const [stacks, setStacks] = useState<{ past: Snapshot[]; future: Snapshot[] }>({ past: [], future: [] });
  const last = useRef<{ keys: string; at: number } | null>(null);

  const change = useCallback(
    (patch: Partial<EditorDesign>) => {
      const keys = Object.keys(patch)
        .filter((k) => !NOT_DESIGN.has(k))
        .sort()
        .join(",");
      if (keys) {
        const now = Date.now();
        const merge = last.current !== null && last.current.keys === keys && now - last.current.at < HISTORY_MERGE_MS;
        if (!merge) setStacks((s) => ({ past: [...s.past, designPart(design)].slice(-LIMIT), future: [] }));
        last.current = { keys, at: now };
      }
      apply(patch);
    },
    [apply, design],
  );

  const undo = useCallback(() => {
    const prev = stacks.past.at(-1);
    if (!prev) return;
    const current = designPart(design);
    setStacks((s) => ({ past: s.past.slice(0, -1), future: [...s.future, current] }));
    last.current = null;
    apply(patchBetween(current, prev));
  }, [apply, design, stacks.past]);

  const redo = useCallback(() => {
    const next = stacks.future.at(-1);
    if (!next) return;
    const current = designPart(design);
    setStacks((s) => ({ past: [...s.past, current], future: s.future.slice(0, -1) }));
    last.current = null;
    apply(patchBetween(current, next));
  }, [apply, design, stacks.future]);

  return { change, undo, redo, canUndo: stacks.past.length > 0, canRedo: stacks.future.length > 0 };
}
