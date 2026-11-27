import { describe, expect, it, vi } from "vitest";

vi.mock("next-intl/server", () => ({ getRequestConfig: (f: unknown) => f }));
const { withFallback } = await import("./request");

describe("translations over English (HEY-172)", () => {
  it("keeps arrays as arrays: a translated docs page's blocks stay a list", () => {
    const en = {
      page: {
        title: "Install",
        blocks: [
          { k: "p", t: "One" },
          { k: "p", t: "Two" },
        ],
      },
    };
    const de = {
      page: {
        title: "Installieren",
        blocks: [
          { k: "p", t: "Eins" },
          { k: "p", t: "Zwei" },
        ],
      },
    };
    const merged = withFallback(en, de) as typeof en;
    expect(Array.isArray(merged.page.blocks)).toBe(true);
    expect(merged.page).toEqual({
      title: "Installieren",
      blocks: [
        { k: "p", t: "Eins" },
        { k: "p", t: "Zwei" },
      ],
    });
  });

  it("still falls back to English for a missing key, at any depth", () => {
    const merged = withFallback({ a: { b: "B", c: "C" }, d: ["x"] }, { a: { b: "Б" } });
    expect(merged).toEqual({ a: { b: "Б", c: "C" }, d: ["x"] });
  });
});
