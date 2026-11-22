"use client";

import { readDraftDesign, serializeDraftDesign, type EditorDesign } from "@/entities/qr";

/*
 * HEY-78: unsaved edits of one saved layout, kept in this browser while a save is in flight. If the session has ended,
 * the save fails and the app sends the user to sign in again; when the same layout opens afterwards, the editor offers
 * these edits back. They are dropped as soon as a save succeeds (or the user discards them). Ownership is still
 * checked by the server on save: this copy only ever goes back into the editor of the same code and layout.
 */
const PREFIX = "heyqr:edit-recovery:";
/** Older copies are ignored: a day covers signing in again, not a forgotten tab. */
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

type Stored = { v: 1; qrCodeId: string; layoutId: string; name: string; design: unknown; at: number };

export function holdEdits(input: { qrCodeId: string; layoutId: string; name: string; design: EditorDesign }) {
  try {
    const stored: Stored = { v: 1, ...input, design: serializeDraftDesign(input.design), at: Date.now() };
    window.localStorage.setItem(PREFIX + input.layoutId, JSON.stringify(stored));
  } catch {
    /* storage full or unavailable: the edits stay in the open editor */
  }
}

export function dropEdits(layoutId: string) {
  try {
    window.localStorage.removeItem(PREFIX + layoutId);
  } catch {
    /* nothing to drop */
  }
}

/**
 * The held edits for this code and layout, validated like a browser draft. The code's content and mode always come
 * from the saved layout (they can't change in Edit design).
 */
export function heldEdits(qrCodeId: string, layoutId: string, saved: EditorDesign): { design: EditorDesign; name: string } | null {
  let parsed: Partial<Stored> | null;
  try {
    parsed = JSON.parse(window.localStorage.getItem(PREFIX + layoutId) ?? "null") as Partial<Stored> | null;
  } catch {
    return null;
  }
  if (!parsed || parsed.v !== 1 || parsed.qrCodeId !== qrCodeId || parsed.layoutId !== layoutId) return null;
  if (typeof parsed.at !== "number" || Date.now() - parsed.at > MAX_AGE_MS) {
    dropEdits(layoutId);
    return null;
  }
  const read = readDraftDesign(parsed.design, saved);
  if (!read.ok) return null;
  return {
    design: { ...read.value, content: saved.content, model: saved.model },
    name: typeof parsed.name === "string" ? parsed.name : "",
  };
}
