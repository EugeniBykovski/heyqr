import { describe, expect, it } from "vitest";
import { parseDestination } from "./destination";

/* HEY-119 / QR-16.04: one destination check for create and Change destination, the editor's own parser. */
describe("parseDestination", () => {
  it("keeps an explicit https:// or http:// with path, query and fragment", () => {
    expect(parseDestination("https://menu.example.test/a/b?table=4&lang=en#drinks")).toEqual({
      ok: true,
      url: "https://menu.example.test/a/b?table=4&lang=en#drinks",
    });
    expect(parseDestination("http://legacy.example.test/menu?x=1#top")).toEqual({
      ok: true,
      url: "http://legacy.example.test/menu?x=1#top",
    });
    expect(parseDestination("HTTP://legacy.example.test/")).toEqual({ ok: true, url: "HTTP://legacy.example.test/" });
  });

  it("defaults a bare domain to https://, as the editor does", () => {
    expect(parseDestination("  menu.example.test/today?x=1  ")).toEqual({ ok: true, url: "https://menu.example.test/today?x=1" });
  });

  it("refuses malformed addresses and other schemes with a destination field error", () => {
    const refused = (problem: string) => ({ ok: false, error: "invalid", field: "destination", problem });
    expect(parseDestination("")).toEqual(refused("empty"));
    expect(parseDestination("menu example.test")).toEqual(refused("spaces"));
    for (const bad of [
      "ftp://files.example.test",
      "javascript:alert(1)",
      "mailto:ana@example.test",
      "https://",
      "localhost",
      "user:pass@example.test",
      "https://https://example",
    ])
      expect(parseDestination(bad)).toEqual(refused("invalid"));
    expect(parseDestination(undefined)).toEqual(refused("invalid"));
    expect(parseDestination(`https://example.test/${"a".repeat(2100)}`)).toEqual(refused("invalid"));
  });
});
