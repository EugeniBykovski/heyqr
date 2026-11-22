"use client";

import type { QrContentType } from "@heyqr/qr-core";
import { useEffect, useRef, useState } from "react";
import { DEFAULT_DESIGN, emptyContent, modeFor, readDraftDesign, serializeDraftDesign, type EditorDesign } from "@/entities/qr";

/** Browser slot for the guest draft. ":v1" names the slot; the JSON inside carries its own schemaVersion. */
const KEY = "heyqr:draft:v1";
/** Where an unreadable draft is kept, so starting fresh never destroys it. */
const UNREADABLE_KEY = "heyqr:draft:unreadable";
/**
 * HEY-77: a random key for this browser draft, sent with its first save to an account. The server records it on the
 * new code, so a refresh or retry after sign-in finds that code instead of saving a duplicate. Cleared with the draft
 * once the save succeeds; kept (with the draft) when it fails.
 */
const CLAIM_KEY = "heyqr:draft:claim";

/** This draft's claim key, created on first use; undefined when storage is unavailable (the save still works). */
export function draftClaimKey(): string | undefined {
  try {
    const existing = window.localStorage.getItem(CLAIM_KEY);
    if (existing && /^[A-Za-z0-9_-]{16,64}$/.test(existing)) return existing;
    const key = crypto.randomUUID().replaceAll("-", "");
    window.localStorage.setItem(CLAIM_KEY, key);
    return key;
  } catch {
    return undefined;
  }
}

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
 * including one that couldn't be read. Edits are debounced by 300 ms and flushed on pagehide, when the tab is hidden
 * and on unmount, so a quick reload or navigation never loses the last change.
 */
export function useDraft() {
  // The editor renders only in the browser (see QrEditorLoader), so storage can be read during the first render.
  const [read] = useState(loadDraft);
  const [design, setDesign] = useState<EditorDesign>(read.status === "restored" ? read.design : DEFAULT_DESIGN);
  const initial = useRef(design);
  /** The latest edit that the debounce hasn't written yet. */
  const pending = useRef<EditorDesign | null>(null);

  useEffect(() => {
    if (design === initial.current) return;
    pending.current = design;
    const id = window.setTimeout(() => {
      writeDraft(design);
      pending.current = null;
    }, 300);
    return () => window.clearTimeout(id);
  }, [design]);

  // Never drop the last edit: write it at once when the page is hidden or unloaded (reload, tab close, app switch)
  // and when the editor unmounts (client-side navigation to another page).
  useEffect(() => {
    const flush = () => {
      if (!pending.current) return;
      writeDraft(pending.current);
      pending.current = null;
    };
    const onHidden = () => document.visibilityState === "hidden" && flush();
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", onHidden);
    return () => {
      window.removeEventListener("pagehide", flush);
      document.removeEventListener("visibilitychange", onHidden);
      flush();
    };
  }, []);

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
    window.localStorage.removeItem(CLAIM_KEY);
  } catch {
    /* nothing to clear */
  }
}
