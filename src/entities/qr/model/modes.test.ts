import { QR_CONTENT_TYPES } from "@heyqr/qr-core";
import { describe, expect, it } from "vitest";
import { MODES_BY_TYPE, modeFor, supportsMode } from "./modes";

describe("QR modes by content type", () => {
  it("lets only website codes be dynamic; every type can be static", () => {
    expect(MODES_BY_TYPE.website).toEqual(["static", "dynamic"]);
    for (const type of QR_CONTENT_TYPES.filter((t) => t !== "website")) {
      expect(MODES_BY_TYPE[type]).toEqual(["static"]);
      expect(supportsMode(type, "dynamic")).toBe(false);
    }
    for (const type of QR_CONTENT_TYPES) expect(supportsMode(type, "static")).toBe(true);
  });

  it("keeps a supported mode and falls back to static otherwise", () => {
    expect(modeFor("website", "dynamic")).toBe("dynamic");
    expect(modeFor("wifi", "dynamic")).toBe("static");
    expect(modeFor("event", "static")).toBe("static");
  });
});
