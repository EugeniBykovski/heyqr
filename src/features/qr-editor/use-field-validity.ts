"use client";

import { useEffect } from "react";

/**
 * Reports whether a typed field's current text is accepted, so Export and Save can stop at it (HEY-34, HEY-35, HEY-43,
 * HEY-45). The report follows what the field shows, not only typing: when a committed setting changes from outside
 * (unit switch, size preset, colour picker, Reset colors, restore) and the field resyncs to that valid value, an earlier
 * "invalid" is cleared too (HEY-57). A field that disappears (another step, another layout) is reported valid.
 */
export function useFieldValidity(id: string, valid: boolean, onValidity: ((id: string, valid: boolean) => void) | undefined) {
  useEffect(() => {
    onValidity?.(id, valid);
  }, [id, valid, onValidity]);
  useEffect(() => () => onValidity?.(id, true), [id, onValidity]);
}
