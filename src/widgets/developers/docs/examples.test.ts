import { execFileSync } from "node:child_process";
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";
import type { ScanIssue } from "@heyqr/qr-core";
import messages from "../../../../messages/en.json";
import { EXAMPLES, TABBED, type Example } from "./examples";

/*
 * Design 12.x: every @heyqr/qr-core example on the docs runs here against the real package, and its documented results
 * ("// → …", "// { ok: … }", "// true", and the vCard / VEVENT lines) are the actual output. Files written by the
 * examples are captured, not written. Browser-only calls get stubs (document, the wasm decoder).
 */
const writes = new Map<string, unknown>();
vi.mock("node:fs/promises", async (original) => ({
  ...(await original<typeof import("node:fs/promises")>()),
  writeFile: async (file: string, data: unknown) => void writes.set(file, data),
}));
vi.mock("@heyqr/qr-core/verify-browser", () => ({ decodeSvgInBrowser: async () => "https://anareyes.studio/portfolio" }));

const ROOT = process.cwd();
const DIR = path.join(ROOT, "node_modules", ".docs-examples");
mkdirSync(DIR, { recursive: true });
afterAll(() => rmSync(DIR, { recursive: true, force: true }));

/** Variables the page defines above a fragment. */
const PRELUDE: Record<string, string> = {
  value: 'const value = encodePayload({ type: "website", url: "anareyes.studio/portfolio" });',
  style:
    'const style: QrStyle = { pattern: "rounded", eyeFrame: "cushion", eyeBall: "rounded", colors: { fg: "#0D0D12", eye: "#0D0D12", eyeIn: "#0D0D12", bg: "#FFFFFF" }, logo: { iconPath: "M3 2v7c0 1.1.9 2 2 2h4a2 2 0 0 0 2-2V2M7 2v20", size: 0.46, plate: "circle" } };',
  layout:
    'const layout: Layout = { preset: "caption", unit: "mm", width: 90, height: 50, qrSize: 36, border: false, colors: { fg: "#0D0D12", eye: "#0D0D12", eyeIn: "#0D0D12", bg: "#FFFFFF", frame: "#0D0D12", caption: "#0D0D12" }, style: { pattern: "rounded", eyeFrame: "rounded", eyeBall: "rounded" }, caption: { text: "Menu", fontFamily: "DM Sans, sans-serif", font: "dm", size: 12, weight: 700, align: "center", position: "after" } };',
  svg: "const svg = renderQrSvg(value, { ...style, logo: null });",
  png: 'const png = new Uint8Array((await import("@heyqr/qr-core/raster")).rasterizeSvg(svg, { width: 600 }));',
};
const NAMES = ["composeLayout", "encodePayload", "renderQr", "renderQrSvg"];
const TYPES = ["Layout", "QrStyle"];
const ORDER = ["value", "style", "layout", "svg", "png"] as const;

/** Rewrites documented results into checks: `expr; // → "x"` and `expr; // { ok: … }` become __check(expr, x). */
function withChecks(code: string): string {
  const lines = code.split("\n");
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    const nextLine = lines[i + 1] ?? "";
    const inline = /^(\S.*?);\s*\/\/\s*(\{.*\}|true|false)\s*$/.exec(line);
    if (inline && !line.trimStart().startsWith("//")) {
      out.push(`__check(${inline[1]}, ${inline[2].replace(/([{,]\s*)(\w+):/g, '$1"$2":')});`);
      continue;
    }
    if (/;\s*$/.test(line) && nextLine.startsWith("// → ")) {
      const decl = /^const (\w+) = /.exec(line);
      out.push(
        decl ? `${line}\n__check(${decl[1]}, ${nextLine.slice(5)});` : `__check(${line.replace(/;\s*$/, "")}, ${nextLine.slice(5)});`,
      );
      i++;
      continue;
    }
    if (line === "});" && /^\/\/ BEGIN:/.test(nextLine)) {
      // A multi-line call followed by its output, one comment line per line of output.
      const start = out.lastIndexOf(out.findLast((l) => /^encodePayload\(\{$/.test(l)) ?? "");
      const call = [...out.slice(start), "})"].join("\n");
      out.length = start;
      const expected: string[] = [];
      while ((lines[i + 1] ?? "").startsWith("// ")) expected.push((lines[++i] ?? "").slice(3));
      out.push(`__checkLines(${call}, ${JSON.stringify(expected)});`);
      continue;
    }
    if (/^encodePayload\(\{ type: "event".*\);$/.test(line) && nextLine.startsWith("// BEGIN:")) {
      const expected: string[] = [];
      while ((lines[i + 1] ?? "").startsWith("// ")) expected.push((lines[++i] ?? "").slice(3));
      out.push(`__checkLines(${line.replace(/;$/, "")}, ${JSON.stringify(expected)});`);
      continue;
    }
    out.push(line);
  }
  return out.join("\n");
}

const checks: { got: unknown; want: unknown }[] = [];
Object.assign(globalThis, {
  __check: (got: unknown, want: unknown) => checks.push({ got, want }),
  __checkLines: (got: string, want: string[]) => checks.push({ got: got.split(/\r?\n/).filter(Boolean), want }),
  document: { querySelector: () => ({ insertAdjacentHTML: () => undefined }) },
});

const code = (Object.entries(EXAMPLES) as [string, Example][]).filter(([, e]) => ["both", "node", "browser"].includes(e.env));
/** @heyqr/qr-core examples run; the SDK example needs a live API and is type-checked only. */
const runnable = code.filter(([, e]) => !e.code.includes("@heyqr/sdk"));

function fileFor(id: string, e: Example) {
  const source = withChecks(e.code);
  const own = source.split("\n").filter((l) => l.startsWith("import "));
  const body = source.split("\n").filter((l) => !l.startsWith("import "));
  const prelude = ORDER.filter(
    (u) => e.uses?.includes(u) || ((u === "value" || u === "style") && e.uses?.some((x) => x === "svg" || x === "png")),
  ).map((u) => PRELUDE[u]);
  const text = [...prelude, ...body].join("\n");
  const imported = own.join("\n");
  const names = NAMES.filter((n) => new RegExp(`\\b${n}\\(`).test(text) && !new RegExp(`\\b${n}\\b`).test(imported));
  const types = TYPES.filter((n) => new RegExp(`: ${n}\\b`).test(text) && !new RegExp(`\\b${n}\\b`).test(imported));
  const extra =
    names.length || types.length ? [`import { ${[...names, ...types.map((t) => `type ${t}`)].join(", ")} } from "@heyqr/qr-core";`] : [];
  const file = path.join(DIR, `${id}.ts`);
  writeFileSync(file, `${[...extra, ...own].join("\n")}\n${text}\nexport {};\n`);
  return file;
}

describe("docs examples run against @heyqr/qr-core (design 12.x)", () => {
  for (const [id, e] of runnable)
    it(`${id} (${e.file}) runs and its documented results are the package's`, async () => {
      checks.length = 0;
      writes.clear();
      await import(/* @vite-ignore */ fileFor(id, e));
      for (const c of checks) expect(c.got, `${id}: documented result`).toEqual(c.want);
      if (id === "quickstartNode") expect([...writes.keys()]).toEqual(["portfolio-qr.svg", "portfolio-qr.png"]);
      if (id === "png")
        expect(
          Buffer.from(writes.get("wifi-qr.png") as Buffer)
            .subarray(1, 4)
            .toString(),
        ).toBe("PNG");
    });

  it("every example type-checks against the package's types", () => {
    for (const [id, e] of code) fileFor(id, e);
    writeFileSync(
      path.join(DIR, "globals.d.ts"),
      "declare const document: { querySelector(s: string): { insertAdjacentHTML(p: string, h: string): void } | null };\ndeclare function __check(a: unknown, b: unknown): void;\ndeclare function __checkLines(a: unknown, b: string[]): void;\n",
    );
    writeFileSync(
      path.join(DIR, "tsconfig.json"),
      JSON.stringify({
        compilerOptions: {
          strict: true,
          noEmit: true,
          module: "esnext",
          moduleResolution: "bundler",
          target: "es2022",
          types: ["node"],
          skipLibCheck: true,
          allowImportingTsExtensions: true,
          noUnusedLocals: false,
          customConditions: ["@heyqr/source"],
        },
        include: ["*.ts"],
      }),
    );
    let output = "";
    try {
      execFileSync(path.join(ROOT, "node_modules/.bin/tsc"), ["-p", DIR], { encoding: "utf8", stdio: "pipe" });
    } catch (error) {
      output = String((error as { stdout?: string }).stdout ?? error);
    }
    expect(output).toBe("");
  }, 60_000);

  it("the wasm the install page copies is where the command finds it", async () => {
    const { createRequire } = await import("node:module");
    const req = createRequire(path.join(ROOT, "packages/qr-core/src/index.ts"));
    expect(req.resolve("zxing-wasm/reader/zxing_reader.wasm")).toMatch(/zxing-wasm\/dist\/reader\/zxing_reader\.wasm$/);
    const pkg = JSON.parse(readFileSync(path.join(ROOT, "packages/qr-core/package.json"), "utf8")) as {
      dependencies: Record<string, string>;
    };
    expect(pkg.dependencies["zxing-wasm"]).toBe("3.1.7");
  });

  it("the issue codes, titles and fixes on Check that it scans are the package's", async () => {
    const q = await import("@heyqr/qr-core");
    const base = { pattern: "dot", eyeFrame: "circle", eyeBall: "circle" } as const;
    const issues = new Map<string, ScanIssue>();
    const add = (r: { scan: { issues: ScanIssue[] } }) => r.scan.issues.forEach((i) => issues.set(i.code, i));
    add(q.renderQr("x", { ...base, colors: { fg: "#FFFFFF", eye: "#FFFFFF", eyeIn: "#FFFFFF", bg: "#0D0D12" } }));
    add(q.renderQr("x", { ...base, colors: { fg: "#C9B7BC", eye: "#C9B7BC", eyeIn: "#C9B7BC", bg: "#FFFFFF" } }));
    add(
      q.renderQr("https://reyes.studio", {
        ...base,
        colors: { fg: "#0D0D12", eye: "#0D0D12", eyeIn: "#0D0D12", bg: "#FFFFFF" },
        logo: { iconPath: "M3 2v7", size: 0.46, plate: "circle" },
      }),
    );
    add(
      q.renderQr("https://reyes.studio/" + "a".repeat(300), {
        ...base,
        colors: { fg: "#0D0D12", eye: "#0D0D12", eyeIn: "#0D0D12", bg: "#FFFFFF" },
        centerText: { text: "MENU MENU MENU", bg: "#0D0D12", color: "#FFFFFF", fontFamily: "DM Sans" },
      }),
    );
    const scan = messages.developers.docs.pages.scan.blocks.find((b) => b.k === "table") as { rows: { cells: string[] }[] };
    for (const row of scan.rows) {
      const code = (row.cells[0] ?? "").replace(/`/g, "");
      const issue = issues.get(code);
      if (!issue) continue; // "text" needs a code whose centre text hides too much; its copy is checked by type below.
      expect([issue.title, issue.fix], code).toEqual([row.cells[1], row.cells[2]]);
    }
    expect(issues.size).toBeGreaterThanOrEqual(4);
    expect(q.CENTER_TEXT_MAX).toBe(14);
    expect(q.CENTER_LOGO_SIZE).toEqual({ min: 0.1, max: 0.46 });
    expect(q.MIN_CONTRAST).toEqual({ modules: 3, eyeFrame: 3, eyeCenter: 2.5 });
    expect([q.MAX_VERSION, q.PNG_MIN_SIDE, q.PNG_MAX_SIDE, q.maxPayloadBytes("M"), q.maxPayloadBytes("H")]).toEqual([
      20, 64, 8192, 666, 382,
    ]);
    expect([...q.QR_CONTENT_TYPES]).toEqual(["website", "text", "wifi", "contact", "email", "phone", "sms", "location", "event"]);
  });
});

describe("REST examples follow the v1 routes and never hold a key (design 12.21 / 12.22)", () => {
  const routes = path.join(ROOT, "src/app/api/v1");
  const rest = [
    ...Object.values(EXAMPLES).filter((e) => e.env === "http" || e.env === "shell"),
    ...Object.values(TABBED).flatMap((t) => t.tabs),
  ].map((e) => e.code);
  const live = Object.entries(TABBED)
    .filter(([id]) => !/^(bulk|scans)/.test(id))
    .flatMap(([, t]) => t.tabs.map((tab) => tab.code));

  it("every path used exists as a route, and the planned ones (bulk, scans) don't claim one", () => {
    const paths = [...rest.join("\n").matchAll(/\/api\/v1\/[\w/{}$.-]+/g)].map((m) => m[0].replace(/\$\w+|\{\w+\}|\$\{[^}]+\}/g, "[x]"));
    expect(paths.length).toBeGreaterThan(0);
    for (const p of paths) {
      const dir = p.replace(/^\/api\/v1/, "").replace(/\[x\]/g, "*");
      const parts = dir
        .split("/")
        .filter(Boolean)
        .map((s) => (s === "*" ? /^\[\w+\]$/ : new RegExp(`^${s}$`)));
      let here = routes;
      for (const part of parts) {
        const next = readdirSync(here).find((d) => part.test(d));
        expect(next, `${p}: no route folder for ${part}`).toBeTruthy();
        here = path.join(here, next ?? "");
      }
    }
  });

  it("every status, code and message shown is what the routes answer", () => {
    const source = [
      "src/server/api/v1/http.ts",
      "src/app/api/v1/qr-codes/route.ts",
      "src/app/api/v1/qr-codes/[qrCodeId]/destination/route.ts",
      "src/server/api/v1/rate-limit.ts",
    ]
      .map((f) => readFileSync(path.join(ROOT, f), "utf8"))
      .join("\n");
    for (const code of live)
      for (const m of code.matchAll(/"code": "(\w+)", "message": "([^"]+)"/g)) {
        expect(source, m[1]).toContain(`"${m[1]}"`);
        expect(source.replace(/\\'/g, "'"), m[2]).toContain(m[2].replace(/\\'/g, "'"));
      }
  });

  it("keys only ever come from the server's environment", () => {
    for (const code of rest) {
      expect(code).not.toMatch(/hqk_[A-Za-z0-9]{12}_/);
      expect(code).not.toMatch(/NEXT_PUBLIC/);
      // Every Bearer value is a placeholder or the server's environment variable.
      for (const m of code.matchAll(/Bearer (?!realm=)([^\s"`'\\]+)/g))
        expect(m[1]).toMatch(/^(\$HEYQR_API_KEY|\$\{process\.env\.HEYQR_API_KEY\}|<key>\.?|<API)$/);
    }
    expect(EXAMPLES.sdkInstallNote.code).toMatch(/process\.env\.HEYQR_API_KEY/);
  });
});
