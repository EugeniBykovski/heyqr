// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_DESIGN } from "@/entities/qr";
import { useDraft, writeDraft } from "./use-draft";

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
});
