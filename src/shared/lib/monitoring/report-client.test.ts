import { describe, expect, it } from "vitest";
import { describeBrowserFailure, tagUnhandled } from "./report-client";

const err = (name: string, message = "x", fromServer = false) => ({ name, message, fromServer });
const at = (pathname: string, search = "", online = true) => ({ pathname, search, online });

describe("browser failures (HEY-175)", () => {
  it("a chunk that fails to load during a navigation on a critical page alerts as high", () => {
    for (const path of ["/create", "/de/dashboard", "/edit/Q1", "/create/export"])
      expect(describeBrowserFailure(err("ChunkLoadError"), at(path), "boundary")).toMatchObject({
        operation: "navigation.load",
        severity: "high",
      });
    expect(describeBrowserFailure(err("ChunkLoadError"), at("/pricing"), "boundary").severity).toBe("low");
  });

  it("a render failure on the checkout return names the area, without the query", () => {
    const d = describeBrowserFailure(err("TypeError"), at("/create/export", "?qr=Q1&checkout=success&session_id=cs_test_1"), "boundary");
    expect(d).toMatchObject({ operation: "page.render", area: "checkout_return", route: "/create/export", severity: "high" });
    expect(JSON.stringify(d)).not.toMatch(/cs_test|Q1/);
  });

  it("offline visitors, failures the server already alerted and stray uncaught errors don't alert", () => {
    expect(describeBrowserFailure(err("ChunkLoadError"), at("/create", "", false), "boundary").severity).toBe("low");
    expect(describeBrowserFailure(err("Error", "x", true), at("/dashboard"), "boundary").severity).toBe("low");
    expect(describeBrowserFailure(err("TypeError"), at("/dashboard"), "unhandled")).toMatchObject({
      operation: "browser.unhandled",
      severity: "low",
    });
  });

  it("uncaught errors get the same tags; already tagged events are left alone", () => {
    const event = { exception: { values: [{ type: "ChunkLoadError", value: "Failed to load chunk" }] } };
    expect(tagUnhandled(event, at("/dashboard/qr/Q1"))).toMatchObject({
      level: "error",
      tags: { operation: "navigation.load", alert: "high", route: "/dashboard/qr/[id]", area: "dashboard" },
    });
    const tagged = { tags: { operation: "page.render" } };
    expect(tagUnhandled(tagged, at("/"))).toBe(tagged);
  });
});
