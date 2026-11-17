"use client";

import { useEffect, useState } from "react";
import { DEFAULT_DESIGN, type EditorDesign } from "@/entities/qr";

const KEY = "heyqr:draft:v1";

function read(): EditorDesign | null {
  try {
    const raw = window.localStorage.getItem(KEY);
    return raw ? { ...DEFAULT_DESIGN, ...(JSON.parse(raw) as Partial<EditorDesign>) } : null;
  } catch {
    return null;
  }
}

/**
 * Guest drafts live in this browser until the user signs in and the draft is saved to the account.
 * Storage can be unavailable (private mode); the editor then simply works without persistence.
 */
export function useDraft() {
  // The editor renders only in the browser (see QrEditorLoader), so storage can be read during the first render.
  const [initial] = useState(read);
  const [design, setDesign] = useState<EditorDesign>(initial ?? DEFAULT_DESIGN);
  const restored = initial !== null;

  useEffect(() => {
    const id = window.setTimeout(() => {
      try {
        window.localStorage.setItem(KEY, JSON.stringify(design));
      } catch {
        /* storage unavailable: keep editing in memory */
      }
    }, 300);
    return () => window.clearTimeout(id);
  }, [design]);

  return { design, setDesign, restored };
}

export function clearDraft() {
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    /* nothing to clear */
  }
}
