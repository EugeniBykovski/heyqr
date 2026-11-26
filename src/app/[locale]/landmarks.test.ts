import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/*
 * HEY-180: one main landmark per page. The locale layout renders <main id="main"> (the skip link's target) around every
 * localized page, so the pages, features and widgets rendered inside it must not open a second <main>: nested or
 * duplicate main landmarks break landmark navigation in screen readers (WCAG 1.3.1 / ARIA landmark rules).
 */
const SRC = fileURLToPath(new URL("../..", import.meta.url));
const inside = ["app/[locale]", "features", "widgets", "entities", "shared"];

describe("landmarks (HEY-180)", () => {
  it("only the locale layout opens <main> for localized pages", () => {
    const offenders = inside.flatMap((dir) =>
      readdirSync(`${SRC}/${dir}`, { recursive: true, encoding: "utf8" })
        .filter((f) => f.endsWith(".tsx") && !f.endsWith(".test.tsx"))
        .map((f) => `${dir}/${f}`)
        .filter((f) => f !== "app/[locale]/layout.tsx" && /<main[\s>]/.test(readFileSync(`${SRC}/${f}`, "utf8"))),
    );
    expect(offenders).toEqual([]);
    expect(readFileSync(`${SRC}/app/[locale]/layout.tsx`, "utf8")).toMatch(/<main id="main"/);
  });
});
