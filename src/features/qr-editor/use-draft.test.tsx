// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_DESIGN } from "@/entities/qr";
import { draftForType, useDraft, writeDraft } from "./use-draft";

const KEY = "heyqr:draft:v1";

beforeEach(() => {
  localStorage.clear();
  vi.useFakeTimers();
});
afterEach(() => vi.useRealTimers());

describe("useDraft", () => {
  it("restores a current draft and saves edits with schemaVersion 1", () => {
    writeDraft({ ...DEFAULT_DESIGN, content: { type: "website", url: "https://littlefern.cafe/menu" }, fg: "#1F5C45" });
    const { result } = renderHook(() => useDraft());
    expect(result.current).toMatchObject({ restored: true, unreadable: false, design: { fg: "#1F5C45" } });

    act(() => result.current.setDesign((d) => ({ ...d, pattern: "dot" })));
    act(() => vi.advanceTimersByTime(400));
    expect(JSON.parse(localStorage.getItem(KEY) ?? "{}")).toMatchObject({ schemaVersion: 1, fg: "#1F5C45", pattern: "dot" });
  });

  it("restores a legacy draft and upgrades it on the next save", () => {
    localStorage.setItem(KEY, JSON.stringify({ ...DEFAULT_DESIGN, caption: "See the menu", fg: "#8C2F4B" }));
    const { result } = renderHook(() => useDraft());
    expect(result.current.design).toMatchObject({ caption: "See the menu", fg: "#8C2F4B" });
    act(() => result.current.setDesign((d) => ({ ...d, name: "Menu" })));
    act(() => vi.advanceTimersByTime(400));
    expect(JSON.parse(localStorage.getItem(KEY) ?? "{}")).toMatchObject({ schemaVersion: 1, caption: "See the menu", name: "Menu" });
  });

  it.each([
    ["malformed JSON", "{not json"],
    ["an unsupported version", JSON.stringify({ ...DEFAULT_DESIGN, schemaVersion: 9, caption: "from the future" })],
  ])("never overwrites %s with defaults, and keeps a copy", (_, stored) => {
    localStorage.setItem(KEY, stored);
    const { result } = renderHook(() => useDraft());
    expect(result.current).toMatchObject({ restored: false, unreadable: true, design: DEFAULT_DESIGN });
    act(() => vi.advanceTimersByTime(1000));
    expect(localStorage.getItem(KEY)).toBe(stored);
    expect(localStorage.getItem("heyqr:draft:unreadable")).toBe(stored);
  });

  it("does not autosave the defaults when there is no draft", () => {
    renderHook(() => useDraft());
    act(() => vi.advanceTimersByTime(1000));
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it("restores the selected mode, and flags a draft whose mode had to become static", () => {
    writeDraft({ ...DEFAULT_DESIGN, model: "dynamic", content: { type: "website", url: "https://littlefern.cafe/menu" } });
    expect(renderHook(() => useDraft()).result.current).toMatchObject({ modeAdjusted: false, design: { model: "dynamic" } });

    localStorage.setItem(KEY, JSON.stringify({ ...DEFAULT_DESIGN, model: "dynamic", content: { type: "sms", number: "+14155550142" } }));
    expect(renderHook(() => useDraft()).result.current).toMatchObject({
      modeAdjusted: true,
      design: { model: "static", content: { type: "sms" } },
    });
  });

  it("switches to static when a type chip starts a type that can't be dynamic", () => {
    writeDraft({ ...DEFAULT_DESIGN, model: "dynamic", fg: "#8C2F4B", content: { type: "website", url: "https://littlefern.cafe/menu" } });
    expect(draftForType("wifi")).toMatchObject({ model: "static", fg: "#8C2F4B", content: { type: "wifi" } });
    expect(draftForType("website")).toMatchObject({ model: "dynamic" });
  });

  it("writes the last edit at once when the editor unmounts before the debounce (client navigation)", () => {
    const { result, unmount } = renderHook(() => useDraft());
    act(() => result.current.setDesign((d) => ({ ...d, name: "Quick edit" })));
    act(() => vi.advanceTimersByTime(50));
    expect(localStorage.getItem(KEY)).toBeNull();
    unmount();
    expect(JSON.parse(localStorage.getItem(KEY) ?? "{}")).toMatchObject({ schemaVersion: 1, name: "Quick edit" });
  });

  it("writes the last edit at once on pagehide (reload or tab close)", () => {
    const { result } = renderHook(() => useDraft());
    act(() => result.current.setDesign((d) => ({ ...d, fg: "#1F5C45" })));
    act(() => {
      window.dispatchEvent(new Event("pagehide"));
    });
    expect(JSON.parse(localStorage.getItem(KEY) ?? "{}")).toMatchObject({ fg: "#1F5C45" });
  });

  it("does not flush anything for an unreadable draft the user never edited", () => {
    localStorage.setItem(KEY, "{broken");
    const { unmount } = renderHook(() => useDraft());
    act(() => {
      window.dispatchEvent(new Event("pagehide"));
    });
    unmount();
    expect(localStorage.getItem(KEY)).toBe("{broken");
  });
});
