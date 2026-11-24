import { describe, expect, it } from "vitest";
import { SHORT_CODE_ALPHABET } from "../db/ids";
import { PREVIEW_SLUG } from "../../shared/lib/short-link";
import { isCountableScan, TEST_TRAFFIC_HEADER } from "./scans";

const headers = (h: Record<string, string> = {}) => new Headers(h);

/* HEY-146: which requests to a short link count as a scan. */
describe("isCountableScan (HEY-146)", () => {
  it("a regular anonymous GET counts", () => {
    expect(isCountableScan("GET", headers({ "user-agent": "Mozilla/5.0 (iPhone)" }))).toBe(true);
    expect(isCountableScan("GET", headers({ [TEST_TRAFFIC_HEADER]: "0" }))).toBe(true);
  });

  it("HEAD and other methods, browser prefetch / prerender, and marked test traffic don't", () => {
    expect(isCountableScan("HEAD", headers())).toBe(false);
    expect(isCountableScan("POST", headers())).toBe(false);
    for (const [name, value] of [
      ["sec-purpose", "prefetch"],
      ["sec-purpose", "prefetch;prerender"],
      ["purpose", "prefetch"],
      ["x-purpose", "preview"],
      ["x-moz", "prefetch"],
      [TEST_TRAFFIC_HEADER, "1"],
    ])
      expect([name, value, isCountableScan("GET", headers({ [name]: value }))]).toEqual([name, value, false]);
  });

  it("the editor's preview link can never be a real code's slug", () => {
    // Dynamic previews encode /r/preview; it resolves to no code because its slug can't be issued.
    expect([...PREVIEW_SLUG].some((c) => !SHORT_CODE_ALPHABET.includes(c))).toBe(true);
  });
});
