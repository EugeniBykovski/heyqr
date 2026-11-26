// @vitest-environment jsdom
import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useAutoResume } from "./use-auto-resume";

describe("continuing to Export after sign-in (HEY-193)", () => {
  it("waits for a scan check that finishes after the draft is restored, then continues once", () => {
    const go = vi.fn();
    const { rerender } = renderHook(
      (p: { ready: boolean }) => useAutoResume({ resume: true, signedIn: true, restored: true, ready: p.ready }, go),
      {
        initialProps: { ready: false },
      },
    );
    expect(go).not.toHaveBeenCalled();
    rerender({ ready: true });
    expect(go).toHaveBeenCalledTimes(1);
    rerender({ ready: false });
    rerender({ ready: true });
    expect(go).toHaveBeenCalledTimes(1);
  });

  it("does nothing outside a resume, signed out, or before the draft is restored", () => {
    const go = vi.fn();
    for (const w of [
      { resume: false, signedIn: true, restored: true, ready: true },
      { resume: true, signedIn: false, restored: true, ready: true },
      { resume: true, signedIn: true, restored: false, ready: true },
    ])
      renderHook(() => useAutoResume(w, go));
    expect(go).not.toHaveBeenCalled();
  });
});
