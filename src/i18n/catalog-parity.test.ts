import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import en from "../../messages/en.json";
import { LOCALE_CODES } from "./locales";

/*
 * HEY-192: every one of the 21 interface languages ships a complete catalog with the same shape as English.
 * - Same keys and array lengths (nothing missing, nothing stale): a missing key would silently show English.
 * - Per string: the same ICU arguments ({name}, {count, plural, …} heads), the same rich-text tags (<b>, <link>…),
 *   and the same `code spans` (identifiers, commands, package names are never translated).
 * - Docs block descriptors (k, id, example, kind, …) are structure, not copy, so they equal English exactly.
 * - No value is blank where English isn't, and none is a raw key path.
 */
type Json = string | number | boolean | null | Json[] | { [k: string]: Json };
const FIXED_IN_BLOCKS = new Set([
  "k",
  "id",
  "example",
  "kind",
  "page",
  "icon",
  "method",
  "url",
  "package",
  "keyCol",
  "reqCol",
  "required",
  "pages",
]);

/** ICU argument names with their type (`count:plural`), ignoring the translated branches inside. */
function icuArgs(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === "'" && s[i + 1] === "'") {
      i++;
      continue;
    }
    if (c === "{") {
      const m = /^\{\s*([A-Za-z_][\w]*)\s*(?:,\s*(plural|select|selectordinal|number|date|time))?/.exec(s.slice(i));
      if (m && (depth === 0 || isArgStart(s, i))) out.push(m[2] ? `${m[1]}:${m[2]}` : m[1]);
      depth++;
    } else if (c === "}") depth = Math.max(0, depth - 1);
  }
  return [...new Set(out)].sort();
}
/** Inside a plural/select branch, `{name}` is still an argument; `{` after `one ` / `=0 ` opens a branch, not one. */
function isArgStart(s: string, i: number) {
  return /^\{\s*[A-Za-z_]\w*\s*(,|\})/.test(s.slice(i)) && !/(?:=\d+|zero|one|two|few|many|other)\s*$/.test(s.slice(0, i));
}
const tags = (s: string) => [...s.matchAll(/<\/?([a-zA-Z]+)\s*\/?>/g)].map((m) => m[0].replace(/\s/g, "")).sort();
const codeSpans = (s: string) => [...s.matchAll(/`[^`]+`/g)].map((m) => m[0]).sort();

function compare(a: Json, b: Json, at: string, problems: string[], inBlock = false) {
  if (typeof a === "string") {
    if (typeof b !== "string") return void problems.push(`${at}: expected a string`);
    if (a.trim() && !b.trim()) problems.push(`${at}: blank`);
    if (/^[a-z]+(\.[a-zA-Z0-9]+){2,}$/.test(b) && b !== a) problems.push(`${at}: looks like a raw key "${b}"`);
    const [ia, ib] = [icuArgs(a), icuArgs(b)];
    if (ia.join() !== ib.join()) problems.push(`${at}: ICU arguments ${ib.join(",")} ≠ ${ia.join(",")}`);
    if (tags(a).join() !== tags(b).join()) problems.push(`${at}: tags ${tags(b).join(",")} ≠ ${tags(a).join(",")}`);
    if (codeSpans(a).join("\u0000") !== codeSpans(b).join("\u0000")) problems.push(`${at}: code spans changed`);
    return;
  }
  if (Array.isArray(a)) {
    if (!Array.isArray(b) || b.length !== a.length)
      return void problems.push(`${at}: array length ${Array.isArray(b) ? b.length : "-"} ≠ ${a.length}`);
    a.forEach((v, i) => compare(v, b[i] ?? null, `${at}[${i}]`, problems, inBlock));
    return;
  }
  if (a && typeof a === "object") {
    if (!b || typeof b !== "object" || Array.isArray(b)) return void problems.push(`${at}: expected an object`);
    const block = inBlock || "k" in a;
    for (const k of Object.keys(a)) {
      if (!(k in b)) problems.push(`${at}.${k}: missing`);
      else if (block && FIXED_IN_BLOCKS.has(k)) {
        if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) problems.push(`${at}.${k}: structure field changed`);
      } else compare(a[k] ?? null, b[k] ?? null, `${at}.${k}`, problems, block);
    }
    for (const k of Object.keys(b)) if (!(k in a)) problems.push(`${at}.${k}: not in English (stale)`);
    return;
  }
  if (a !== b) problems.push(`${at}: ${JSON.stringify(b)} ≠ ${JSON.stringify(a)}`);
}

describe("message catalogs (HEY-192)", () => {
  it("lists exactly the 21 approved interface languages", () => {
    expect([...LOCALE_CODES]).toEqual([
      "en",
      "es",
      "zh",
      "hi",
      "ar",
      "pt",
      "fr",
      "de",
      "ru",
      "ja",
      "ko",
      "it",
      "tr",
      "id",
      "vi",
      "pl",
      "uk",
      "be",
      "nl",
      "th",
      "sv",
    ]);
  });

  it("reads ICU arguments, tags and code spans the way the checks below rely on", () => {
    expect(icuArgs("Hi {name}, {count, plural, one {# code} other {# codes for {name}}}")).toEqual(["count:plural", "name"]);
    expect(tags("Read <link>the terms</link> and <b>this</b>")).toEqual(["</b>", "</link>", "<b>", "<link>"]);
    expect(codeSpans("Run `pnpm add @heyqr/qr-core` then `npm`")).toEqual(["`npm`", "`pnpm add @heyqr/qr-core`"]);
  });

  for (const code of LOCALE_CODES.filter((c) => c !== "en"))
    it(`${code}: complete, same shape, arguments, tags and code as English`, () => {
      const file = path.join(process.cwd(), "messages", `${code}.json`);
      let catalog: Json = null;
      try {
        catalog = JSON.parse(readFileSync(file, "utf8")) as Json;
      } catch {
        throw new Error(`messages/${code}.json is missing or not valid JSON`);
      }
      const problems: string[] = [];
      compare(en as unknown as Json, catalog, code, problems);
      expect(problems.slice(0, 25), `${problems.length} problem(s)`).toEqual([]);
    });
});
