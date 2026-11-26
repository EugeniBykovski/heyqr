import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/*
 * HEY-191: the design's token export (docs/design/tokens.json and tokens.css, copied verbatim from the Claude Design
 * "Tokens · table, JSON, CSS" board) and globals.css must resolve to the same values, tier by tier. Values are compared
 * after resolving var() chains and normalising units and spelling (44px = 2.75rem, #0D0D12 = #0d0d12, .2 = 0.2).
 */
const ROOT = process.cwd();
const read = (p: string) => readFileSync(path.join(ROOT, p), "utf8");

/**
 * Every `--name: value;` the browser sees as a custom property, outside @media blocks; later declarations win.
 * `@theme inline` is skipped: Tailwind inlines those into utilities instead of declaring them (see `themeInline`).
 */
function declarations(css: string): Map<string, string> {
  const out = new Map<string, string>();
  const noComments = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const flat = stripBlocks(noComments, /@(media|keyframes)\b|@theme inline\b/);
  for (const m of flat.matchAll(/(--[\w-]+)\s*:\s*([^;{}]+);/g)) out.set(m[1] ?? "", (m[2] ?? "").trim());
  return out;
}

function stripBlocks(css: string, opener: RegExp): string {
  let out = "";
  let i = 0;
  while (i < css.length) {
    const rest = css.slice(i);
    const m = opener.exec(rest);
    if (!m) return out + rest;
    out += rest.slice(0, m.index);
    let j = i + m.index + rest.slice(m.index).indexOf("{");
    let depth = 0;
    for (; j < css.length; j++) {
      if (css[j] === "{") depth++;
      else if (css[j] === "}" && --depth === 0) break;
    }
    i = j + 1;
  }
  return out;
}

function resolve(vars: Map<string, string>, value: string, seen = new Set<string>()): string {
  return value.replace(/var\((--[\w-]+)\)/g, (_, name: string) => {
    const v = vars.get(name);
    if (v === undefined || seen.has(name)) return `<missing ${name}>`;
    return resolve(vars, v, new Set([...seen, name]));
  });
}

const norm = (v: string) =>
  v
    .toLowerCase()
    .replace(/"/g, "'")
    .replace(/(\d*\.?\d+)rem\b/g, (_, n: string) => `${Number(n) * 16}px`)
    .replace(/(^|[^\d.])\.(\d)/g, "$10.$2")
    .replace(/\s*,\s*/g, ",")
    .replace(/\s+/g, " ")
    .trim();

const exportJson = JSON.parse(read("docs/design/tokens.json")) as Record<string, unknown>;
const exportCss = declarations(read("docs/design/tokens.css"));
// tokens.css reads the radius scale it doesn't declare (it lives in tokens.json): add it from the JSON.
for (const [k, v] of Object.entries((exportJson.radius ?? {}) as Record<string, { $value: string }>))
  if (!exportCss.has(`--radius-${k}`)) exportCss.set(`--radius-${k}`, v.$value);
const repoCss = declarations(read("src/app/globals.css"));
/** The `@theme inline` declarations (utility names → semantic tokens). */
const themeInline = new Map(
  [...(/@theme inline \{([\s\S]*?)\n\}/.exec(read("src/app/globals.css"))?.[1] ?? "").matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map(
    (m) => [m[1] ?? "", (m[2] ?? "").trim()] as const,
  ),
);

/** Export tokens whose repo value is equivalent but not spelled the same, with the reason. */
const EQUIVALENT: Record<string, string> = {
  // The design's table notes the three panel widths in one cell; the editor sets them per breakpoint
  // (features/qr-editor/editor-layout.ts: 25rem, xl 27.5rem, 2xl 30rem) and globals.css holds the base 400 px.
  "--panel-width": "400px",
};

describe("design tokens: docs/design/tokens.css ≡ src/app/globals.css (HEY-191)", () => {
  const tiers = [...read("docs/design/tokens.css").matchAll(/\/\* (primitive|semantic|component) \*\/([\s\S]*?)(?=\/\*|\})/g)];

  it("the export has all three tiers", () => {
    expect(tiers.map((t) => t[1])).toEqual(["primitive", "semantic", "component"]);
  });

  for (const [, tier, body] of tiers)
    it(`every ${tier} token resolves to the export's value`, () => {
      const names = [...(body ?? "").matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1] ?? "");
      expect(names.length).toBeGreaterThan(0);
      const mismatches = names.flatMap((name) => {
        const want = norm(EQUIVALENT[name] ?? resolve(exportCss, exportCss.get(name) ?? ""));
        const got = repoCss.has(name) ? norm(resolve(repoCss, repoCss.get(name) ?? "")) : "<not declared>";
        return want === got ? [] : [`${name}: export ${want} · repo ${got}`];
      });
      expect(mismatches).toEqual([]);
    });

  it("reduced motion zeroes the same durations", () => {
    const block = (css: string) => /prefers-reduced-motion: reduce\)\s*\{\s*:root\s*\{([^}]*)\}/.exec(css)?.[1] ?? "";
    const pairs = (css: string) => [...block(css).matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map((m) => `${m[1]}=${m[2]?.trim()}`).sort();
    expect(pairs(read("src/app/globals.css"))).toEqual(pairs(read("docs/design/tokens.css")));
  });
});

describe("design tokens: tokens.json ≡ tokens.css, and the JSON-only scales match the theme (HEY-191)", () => {
  type Leaf = { $value: string };
  const leaves = (node: unknown, at: string[] = []): [string, string][] =>
    node && typeof node === "object" && "$value" in node
      ? [[at.join("."), (node as Leaf).$value]]
      : Object.entries(node as Record<string, unknown>).flatMap(([k, v]) => leaves(v, [...at, k]));
  const json = new Map(leaves(exportJson));
  const ref = (v: string): string => {
    const m = /^\{(.+)\}$/.exec(v);
    return m ? ref(json.get(m[1] ?? "") ?? `<missing ${m[1]}>`) : v;
  };

  it("every color and component reference in the JSON resolves to the CSS export's value", () => {
    const mismatches = [...exportCss.keys()].flatMap((name) => {
      const key = [...json.keys()].find((k) => `--${k.replace(/\./g, "-")}` === name);
      if (!key) return [];
      const a = norm(ref(json.get(key) ?? ""));
      const b = norm(resolve(exportCss, exportCss.get(name) ?? ""));
      return a === b ? [] : [`${key}: json ${a} · css ${b}`];
    });
    expect(mismatches).toEqual([]);
  });

  it("radius, space, motion and font in the JSON match globals.css", () => {
    const checks: [string, string][] = [
      ...["xs", "sm", "md", "lg", "xl", "2xl", "full"].map((k): [string, string] => [`radius.${k}`, `--radius-${k}`]),
      ...["1", "2", "3", "4", "5", "6", "8", "10", "12", "16", "20"].map((k): [string, string] => [`space.${k}`, `--space-${k}`]),
      ["motion.fast", "--motion-fast"],
      ["motion.base", "--motion-base"],
      ["motion.panel", "--motion-panel"],
      ["motion.shimmer", "--motion-shimmer"],
      ["motion.ease", "--motion-ease"],
      ["font.family.sans", "--font-family-sans"],
    ];
    const mismatches = checks.flatMap(([key, name]) => {
      const a = norm(ref(json.get(key) ?? `<missing ${key}>`));
      const b = norm(resolve(repoCss, repoCss.get(name) ?? `<missing ${name}>`));
      return a === b ? [] : [`${key}: json ${a} · repo ${b}`];
    });
    expect(mismatches).toEqual([]);
  });

  it("every design breakpoint exists in the theme (the app names 768 md, so the design's md/lg/xl are its lg/xl/2xl)", () => {
    const design = ["sm", "md", "lg", "xl"].map((k) => norm(json.get(`breakpoint.${k}`) ?? ""));
    const theme = ["sm", "md", "lg", "xl", "2xl"].map((k) => norm(repoCss.get(`--breakpoint-${k}`) ?? ""));
    expect(design).toEqual(["600px", "1024px", "1440px", "1920px"]);
    expect(theme).toEqual(["600px", "768px", "1024px", "1440px", "1920px"]);
    for (const bp of design) expect(theme).toContain(bp);
  });

  it("the design's Tailwind names that don't collide resolve to the same semantic tokens", () => {
    const tw = read("src/app/globals.css");
    for (const [name, target] of [
      ["--color-ink", "--color-text-primary"],
      ["--color-ink-2", "--color-text-secondary"],
      ["--color-ink-3", "--color-text-muted"],
      ["--color-action-primary", "--color-action-primary-bg"],
      ["--color-on-primary", "--color-action-primary-fg"],
      ["--color-on-accent", "--color-accent-fg"],
      ["--color-skeleton", "--skeleton-base"],
      ["--spacing-control", "--button-height"],
    ])
      expect(norm(resolve(repoCss, themeInline.get(name) ?? repoCss.get(name) ?? "<none>")), name).toBe(
        norm(resolve(repoCss, repoCss.get(target) ?? "")),
      );
    expect(tw).toMatch(/@theme inline \{[\s\S]*--color-on-primary: var\(--color-action-primary-fg\)/);
  });
});
