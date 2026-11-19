"use client";

import { useEffect, useState } from "react";

/**
 * True once `on` has stayed true for `delayMs` (HEY-41). Waits that finish sooner never show their indicator, so a
 * fast response doesn't flash a skeleton or a progress pill; turning `on` off hides it at once.
 */
export function useDelayedFlag(on: boolean, delayMs: number): boolean {
  const [elapsed, setElapsed] = useState(false);
  useEffect(() => {
    if (!on) return;
    const id = window.setTimeout(() => setElapsed(true), delayMs);
    return () => {
      window.clearTimeout(id);
      setElapsed(false);
    };
  }, [on, delayMs]);
  return on && elapsed;
}
