"use client";

import type { QrContentType } from "@heyqr/qr-core";
import { useEffect, useRef, useState } from "react";
import { DEFAULT_DESIGN, emptyContent, modeFor, readDraftDesign, serializeDraftDesign, type EditorDesign } from "@/entities/qr";

/** Browser slot for the guest draft. ":v1" names the slot; the JSON inside carries its own schemaVersion. */
const KEY = "heyqr:draft:v1";
/** Where an unreadable draft is kept, so starting fresh never destroys it. */
const UNREADABLE_KEY = "heyqr:draft:unreadable";

export type DraftRead =
  | { status: "none" }
  | { status: "restored"; design: EditorDesign; from: "current" | "legacy"; modeAdjusted: boolean }
  | { status: "unreadable"; reason: "malformed" | "unsupported" };

/**
 * Reads and validates the guest draft. Drafts saved before versioning are read as their known shape.
 * A malformed draft, or one from a newer schemaVersion, is copied to UNREADABLE_KEY and reported, never returned.
 */
export function loadDraft(): DraftRead {
  let raw: string | null;
  try {
    raw = window.localStorage.getItem(KEY);
  } catch {
    return { status: "none" };
  }
  if (raw === null) return { status: "none" };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    parsed = undefined;
  }
  const result = readDraftDesign(parsed, DEFAULT_DESIGN);
  if (result.ok) return { status: "restored", design: result.value, from: result.from, modeAdjusted: result.adjusted === "mode" };
  try {
    window.localStorage.setItem(UNREADABLE_KEY, raw);
  } catch {
    /* storage full or unavailable: the original stays under KEY until the user edits */
  }
  return { status: "unreadable", reason: result.reason };
}

/** The guest draft, or null when there is none or it can't be read (also on the server). */
export function readDraft(): EditorDesign | null {
  if (typeof window === "undefined") return null;
  const read = loadDraft();
  return read.status === "restored" ? read.design : null;
}

/**
 * Guest drafts live in this browser until the user signs in and the draft is saved to the account.
 * Storage can be unavailable (private mode); the editor then simply works without persistence.
 * Autosave starts only after the first change, so opening the editor never overwrites a stored draft with defaults,
 * including one that couldn't be read.
 */
export function useDraft() {
  // The editor renders only in the browser (see QrEditorLoader), so storage can be read during the first render.
  const [read] = useState(loadDraft);
  const [design, setDesign] = useState<EditorDesign>(read.status === "restored" ? read.design : DEFAULT_DESIGN);
  const initial = useRef(design);

  useEffect(() => {
    if (design === initial.current) return;
    const id = window.setTimeout(() => writeDraft(design), 300);
    return () => window.clearTimeout(id);
  }, [design]);

  return {
    design,
    setDesign,
    restored: read.status === "restored",
    unreadable: read.status === "unreadable",
    modeAdjusted: read.status === "restored" && read.modeAdjusted,
  };
}

/** Saves the guest draft immediately with the current schemaVersion, e.g. right before navigating to the editor. */
export function writeDraft(design: EditorDesign) {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(serializeDraftDesign(design)));
  } catch {
    /* storage unavailable: the editor starts from defaults */
  }
}

/** Keeps the current draft's look but starts new content of `type` (home type chips and footer links). */
export function draftForType(type: QrContentType): EditorDesign {
  const current = readDraft() ?? DEFAULT_DESIGN;
  return current.content.type === type ? current : { ...current, content: emptyContent(type), model: modeFor(type, current.model) };
}

export function clearDraft() {
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    /* nothing to clear */
  }
}
