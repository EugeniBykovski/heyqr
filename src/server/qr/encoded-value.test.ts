import { encodePayload } from "@heyqr/qr-core";
import { describe, expect, it, vi } from "vitest";
import { PREVIEW_SLUG, previewShortLink } from "@/shared/lib/short-link";

vi.mock("server-only", () => ({}));
vi.mock("@/env", () => ({ env: { NEXT_PUBLIC_SHORT_LINK_BASE: "http://localhost:3000/r/" } }));
const { encodedValue, isShortLinkPreview } = await import("./export");
const { newShortCode } = await import("../db/ids");

const content = { type: "website" as const, url: "https://menu.example.test/first" };

/* HEY-118 / QR-16.03: a Dynamic code never encodes its destination; before activation it shows Create's preview link. */
describe("encodedValue", () => {
  it("a Dynamic draft encodes the same preview link as Create, not the destination", () => {
    const draft = { model: "dynamic" as const, content, shortCode: null };
    expect(encodedValue(draft)).toBe("http://localhost:3000/r/preview");
    expect(encodedValue(draft)).toBe(previewShortLink("http://localhost:3000/r/"));
    expect(isShortLinkPreview(draft)).toBe(true);
  });

  it("an activated Dynamic code encodes its issued short link; Static encodes its content", () => {
    expect(encodedValue({ model: "dynamic", content, shortCode: "NpuL2yb" })).toBe("http://localhost:3000/r/NpuL2yb");
    expect(isShortLinkPreview({ model: "dynamic", shortCode: "NpuL2yb" })).toBe(false);
    expect(encodedValue({ model: "static", content, shortCode: null })).toBe(encodePayload(content));
    expect(isShortLinkPreview({ model: "static", shortCode: null })).toBe(false);
  });

  it("the preview slug has the issued length and can never be issued", () => {
    const issued = Array.from({ length: 2000 }, () => newShortCode());
    expect(issued.every((s) => s.length === PREVIEW_SLUG.length)).toBe(true);
    expect(issued.some((s) => s.includes("i"))).toBe(false);
    expect(PREVIEW_SLUG).toContain("i");
  });
});
