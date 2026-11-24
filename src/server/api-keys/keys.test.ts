import { describe, expect, it } from "vitest";
import { API_KEY_PREFIX, generateApiKey, parseApiKey } from "./keys";

/* HEY-153: the key format and its one-way verifier. */
describe("API key format (HEY-153)", () => {
  it("hqk_<12-char lookup id>_<43-char secret>; the verifier is a SHA-256 that doesn't contain the key", () => {
    const { key, lookupId, secretHash } = generateApiKey();
    expect(key).toMatch(/^hqk_[A-Za-z0-9]{12}_[A-Za-z0-9_-]{43}$/);
    expect(key.startsWith(`${API_KEY_PREFIX}${lookupId}_`)).toBe(true);
    const secret = key.slice(API_KEY_PREFIX.length + 13);
    expect(secretHash).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(secretHash.includes(secret) || secretHash.includes(key)).toBe(false);
    expect(parseApiKey(key)).toEqual({ lookupId, secret });
  });

  it("two keys never share a lookup id or secret", () => {
    const keys = Array.from({ length: 200 }, () => generateApiKey());
    expect(new Set(keys.map((k) => k.key)).size).toBe(200);
    expect(new Set(keys.map((k) => k.lookupId)).size).toBe(200);
  });

  it("anything that isn't a well-formed key parses to null", () => {
    const { key } = generateApiKey();
    for (const bad of [
      undefined,
      42,
      "",
      "hqk_",
      key.slice(0, -1),
      key.replace("hqk_", "hqx_"),
      `${key}x`,
      `${key.slice(0, 16)}-${key.slice(17)}`,
    ])
      expect(parseApiKey(bad)).toBeNull();
  });
});
