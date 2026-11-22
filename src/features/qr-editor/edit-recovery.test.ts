// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_DESIGN, type EditorDesign } from "@/entities/qr";
import { dropEdits, heldEdits, holdEdits } from "./edit-recovery";

/* HEY-78: edits of a saved layout survive a save that failed because the session ended, until they are saved. */
const saved: EditorDesign = { ...DEFAULT_DESIGN, content: { type: "website", url: "https://anareyes.studio" }, fg: "#8C2F4B" };
const edited: EditorDesign = { ...saved, preset: "vertical", caption: "New caption" };

beforeEach(() => window.localStorage.clear());
afterEach(() => vi.useRealTimers());

describe("held edits of a saved layout", () => {
  it("come back for the same code and layout, with the saved content", () => {
    holdEdits({ qrCodeId: "q1", layoutId: "l1", name: "Poster", design: { ...edited, content: { type: "text", text: "tampered" } } });
    expect(heldEdits("q1", "l1", saved)).toEqual({ design: { ...edited, content: saved.content }, name: "Poster" });
  });

  it("never come back for another code or layout", () => {
    holdEdits({ qrCodeId: "q1", layoutId: "l1", name: "Poster", design: edited });
    expect(heldEdits("q2", "l1", saved)).toBeNull();
    expect(heldEdits("q1", "l2", saved)).toBeNull();
  });

  it("are gone once saved (dropped), and expire after a day", () => {
    holdEdits({ qrCodeId: "q1", layoutId: "l1", name: "Poster", design: edited });
    dropEdits("l1");
    expect(heldEdits("q1", "l1", saved)).toBeNull();
    vi.useFakeTimers();
    holdEdits({ qrCodeId: "q1", layoutId: "l1", name: "Poster", design: edited });
    vi.advanceTimersByTime(25 * 60 * 60 * 1000);
    expect(heldEdits("q1", "l1", saved)).toBeNull();
    expect(window.localStorage.length).toBe(0);
  });

  it("ignore an unreadable copy", () => {
    window.localStorage.setItem(
      "heyqr:edit-recovery:l1",
      JSON.stringify({ v: 1, qrCodeId: "q1", layoutId: "l1", at: Date.now(), design: { fg: 3 } }),
    );
    expect(heldEdits("q1", "l1", saved)).toBeNull();
  });
});
