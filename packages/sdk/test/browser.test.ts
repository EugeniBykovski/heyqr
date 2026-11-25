import { describe, expect, it } from "vitest";
import * as browser from "../src/browser";
import * as server from "@heyqr/sdk";

/* HEY-168: what a browser bundle gets for "@heyqr/sdk": the same runtime exports, but no API client. */
describe("@heyqr/sdk in a browser build (HEY-168)", () => {
  it("has the same runtime exports as the server entry", () => {
    expect(Object.keys(browser).sort()).toEqual(Object.keys(server).sort());
  });

  it("HeyQrClient throws a clear, typed error instead of sending a key from the browser", () => {
    let error: unknown;
    try {
      new browser.HeyQrClient({ apiKey: "hqk_AbCdEfGhIjKl_0123456789abcdefghijklmnopqrstuvwxyzABCDEFG", baseUrl: "https://heyqr.example" });
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(server.HeyQrError);
    expect(error).toMatchObject({ name: "HeyQrError", kind: "server_only" });
    expect(String(error)).toMatch(/server only.*@heyqr\/sdk\/react/);
    expect(String(error)).not.toContain("hqk_");
  });

  it("error classes and guards are the same objects on both sides, so instanceof works across them", () => {
    expect(browser.HeyQrApiError).toBe(server.HeyQrApiError);
    expect(browser.isPaymentRequired).toBe(server.isPaymentRequired);
    expect(browser.DEFAULT_TIMEOUT_MS).toBe(30_000);
    expect(browser.retryAfter("7")).toBe(7);
  });
});
