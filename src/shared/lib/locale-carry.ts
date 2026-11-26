"use client";

import { useEffect, useRef, useState } from "react";

/*
 * HEY-192: a language change re-renders the page under the new /[locale] segment, so React remounts it and in-memory
 * state (an unsaved design, a half-typed form) would be lost. The language switch announces the change right before
 * it navigates; state kept with useCarriedState is handed to the remounted page. Nothing is stored: the hand-over
 * lives in memory (client navigation keeps this module) and expires quickly, so it never resurrects old edits later.
 */
export const LOCALE_CHANGE_EVENT = "heyqr:locale-change";
const TTL_MS = 10_000;
const carried = new Map<string, { value: unknown; at: number }>();

/** Tells the page a language change is about to happen, so it can hand its unsaved state over (and flush drafts). */
export function announceLocaleChange() {
  window.dispatchEvent(new Event(LOCALE_CHANGE_EVENT));
}

function fresh(key: string) {
  const entry = carried.get(key);
  if (!entry) return undefined;
  if (Date.now() - entry.at > TTL_MS) {
    carried.delete(key);
    return undefined;
  }
  return entry;
}

/**
 * useState whose current value survives a language change of the same page. `key` names what it holds (include the
 * record id, e.g. `layout:<id>`), so another page or record never picks it up.
 */
export function useCarriedState<T>(key: string, initial: T | (() => T)) {
  const [wasCarried] = useState(() => fresh(key) !== undefined);
  const [value, setValue] = useState<T>(() => {
    const entry = fresh(key);
    if (entry) return entry.value as T;
    return typeof initial === "function" ? (initial as () => T)() : initial;
  });
  const latest = useRef(value);
  useEffect(() => {
    latest.current = value;
  }, [value]);
  useEffect(() => {
    // Taken once mounted (not while rendering: Strict Mode renders twice).
    carried.delete(key);
    const hand = () => carried.set(key, { value: latest.current, at: Date.now() });
    window.addEventListener(LOCALE_CHANGE_EVENT, hand);
    return () => window.removeEventListener(LOCALE_CHANGE_EVENT, hand);
  }, [key]);
  /** `wasCarried`: this value came over from the same page in the previous language (skip restoring older state). */
  return [value, setValue, wasCarried] as const;
}
