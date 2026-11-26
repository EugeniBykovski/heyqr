import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { LOCALE_CODES, textDirection } from "./locales";

/*
 * HEY-192: Arabic is the one right-to-left interface language. The layout mirrors through logical classes (ps/pe,
 * ms/me, start/end, text-start/end, rounded-s/e, border-s/e), which are identical in left-to-right languages.
 * Physical left/right stays only where it describes physical geometry: the Print Preview sheet and the design canvas
 * (paper and the code itself never mirror), the product gallery's arrows, and centring with translate-x (translate
 * doesn't mirror).
 */
const PHYSICAL =
  /(?<=[\s"'`:])(-?(pl|pr|ml|mr)-(\d|\[|auto)|-?(left|right)-(\d|\[)|text-(left|right)(?![\w-])|rounded-(l|r)-|border-(l|r)(?=[\s"'`-]))/;
const EXEMPT = new Set(["print-preview.tsx", "design-canvas.tsx", "product-gallery.tsx"]);

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return files(full);
    return /\.tsx?$/.test(name) && !/\.test\./.test(name) && !EXEMPT.has(name) ? [full] : [];
  });
}

describe("text direction (HEY-192)", () => {
  it("only Arabic reads right to left", () => {
    expect(LOCALE_CODES.filter((l) => textDirection(l) === "rtl")).toEqual(["ar"]);
    expect(textDirection("unknown")).toBe("ltr");
  });

  it("UI classes are logical, so Arabic mirrors the layout", () => {
    const offenders: string[] = [];
    for (const file of files(path.join(process.cwd(), "src")))
      readFileSync(file, "utf8")
        .split("\n")
        .forEach((line, i) => {
          if (!line.includes("translate-x") && PHYSICAL.test(line)) offenders.push(`${path.relative(process.cwd(), file)}:${i + 1}`);
        });
    expect(offenders).toEqual([]);
  });
});
