import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import en from "../../messages/en.json";
import { LOCALE_CODES, LOCALES } from "./locales";

const dir = join(__dirname, "../../messages");
const keys = (obj: object, prefix = ""): string[] =>
  Object.entries(obj).flatMap(([k, v]) =>
    v && typeof v === "object" && !Array.isArray(v) ? keys(v, `${prefix}${k}.`) : [`${prefix}${k}`],
  );
const enKeys = new Set(keys(en));

describe("translations", () => {
  it("offers 21 languages with English first", () => {
    expect(LOCALES).toHaveLength(21);
    expect(LOCALE_CODES[0]).toBe("en");
    expect(new Set(LOCALE_CODES).size).toBe(21);
  });

  for (const file of readdirSync(dir).filter((f) => f !== "en.json")) {
    it(`${file} only contains keys that exist in English`, () => {
      expect(LOCALE_CODES).toContain(file.replace(".json", ""));
      const extra = keys(JSON.parse(readFileSync(join(dir, file), "utf8"))).filter((k) => !enKeys.has(k));
      expect(extra).toEqual([]);
    });
  }
});
