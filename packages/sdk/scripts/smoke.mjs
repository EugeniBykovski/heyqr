#!/usr/bin/env node
/*
 * HEY-166: build and pack @heyqr/sdk, install the .tgz with npm into a clean project outside the monorepo, typecheck
 * and compile a consumer that imports only "@heyqr/sdk", and run the compiled JavaScript with plain Node.js (no
 * workspace aliases, no source imports, no TypeScript loader).
 *
 *   pnpm --filter @heyqr/sdk smoke                                  # install, typecheck, run (offline part)
 *   HEYQR_API_KEY=hqk_… HEYQR_BASE_URL=http://localhost:3000 \
 *     pnpm --filter @heyqr/sdk smoke                                # …plus the live create/read/update/read-back
 *
 * Options: SMOKE_KEEP=1 keeps the clean project; SMOKE_TSC=/path/to/tsc uses another TypeScript compiler (default:
 * the monorepo's, used only as a compiler; the consumer resolves @heyqr/sdk from its own node_modules).
 */
import { execFileSync } from "node:child_process";
import { cpSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const pkgDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const run = (cmd, args, opts = {}) => execFileSync(cmd, args, { stdio: ["ignore", "pipe", "pipe"], encoding: "utf8", ...opts });
const step = (s) => console.log(`\n▸ ${s}`);

console.log(`Node.js ${process.version} · npm ${run("npm", ["--version"]).trim()}`);

step("Build and pack");
const packDir = mkdtempSync(join(tmpdir(), "heyqr-sdk-pack-"));
run("pnpm", ["pack", "--pack-destination", packDir], { cwd: pkgDir });
const tgz = join(packDir, readdirSync(packDir).find((f) => f.endsWith(".tgz")) ?? "");
const files = run("tar", ["-tzf", tgz]).trim().split("\n").sort();
console.log(`${tgz}\n${files.map((f) => `  ${f}`).join("\n")}`);
const unexpected = files.filter((f) => !/^package\/(package\.json|README\.md|dist\/[a-z-]+\.(js|d\.ts))$/.test(f));
if (unexpected.length) throw new Error(`Unexpected files in the archive: ${unexpected.join(", ")}`);

step("Clean project outside the monorepo; npm install the .tgz");
const project = mkdtempSync(join(tmpdir(), "heyqr-sdk-consumer-"));
writeFileSync(join(project, "package.json"), JSON.stringify({ name: "heyqr-sdk-smoke", private: true, type: "module" }, null, 2));
run("npm", ["install", "--no-audit", "--no-fund", "--offline", tgz], { cwd: project });
const installed = join(project, "node_modules", "@heyqr", "sdk");
if (lstatSync(installed).isSymbolicLink()) throw new Error("@heyqr/sdk is a link, not an installed package");
const manifest = JSON.parse(readFileSync(join(installed, "package.json"), "utf8"));
console.log(`${project}\n  node_modules/@heyqr/sdk: ${manifest.name}@${manifest.version} · exports ${JSON.stringify(manifest.exports)}`);
if (manifest.dependencies || manifest.peerDependencies) throw new Error("The SDK must have no dependencies");
if (JSON.stringify(manifest.exports).includes("src")) throw new Error("exports point at source files");

step("Consumer: typecheck and compile");
const layout = JSON.parse(readFileSync(join(pkgDir, "examples", "sticker-layout.json"), "utf8"));
mkdirSync(join(project, "src"));
writeFileSync(
  join(project, "tsconfig.json"),
  JSON.stringify(
    {
      compilerOptions: {
        target: "ES2022",
        lib: ["ES2022"],
        types: [],
        module: "NodeNext",
        moduleResolution: "NodeNext",
        strict: true,
        exactOptionalPropertyTypes: true,
        noUncheckedIndexedAccess: true,
        skipLibCheck: false,
        outDir: "dist",
        rootDir: "src",
      },
      include: ["src"],
    },
    null,
    2,
  ),
);
// The consumer declares the two runtime globals it uses, so it needs neither DOM nor @types/node.
writeFileSync(
  join(project, "src", "globals.d.ts"),
  "declare const process: { env: Record<string, string | undefined>; exitCode?: number };\ndeclare const console: { log(...a: unknown[]): void; error(...a: unknown[]): void };\n",
);
cpSync(join(pkgDir, "scripts", "smoke-consumer.ts"), join(project, "src", "smoke.ts"));
writeFileSync(join(project, "src", "layout.ts"), `export const sticker = ${JSON.stringify(layout)} as const;\n`);
const tsc = process.env.SMOKE_TSC ?? createRequire(join(pkgDir, "package.json")).resolve("typescript/bin/tsc");
run(process.execPath, [tsc, "-p", "."], { cwd: project });
const resolved = run(process.execPath, [tsc, "-p", ".", "--noEmit", "--traceResolution"], { cwd: project })
  .split("\n")
  .find((l) => l.includes("'@heyqr/sdk' was successfully resolved"));
console.log(`  typecheck: ok\n  ${resolved?.trim().replace(project, "<project>")}`);
if (!resolved?.includes("node_modules/@heyqr/sdk/dist/index.d.ts"))
  throw new Error("@heyqr/sdk didn't resolve to the installed declarations");

step("Run the compiled consumer with plain Node.js");
const output = run(process.execPath, [join(project, "dist", "smoke.js")], { cwd: project, env: process.env });
console.log(output.trimEnd());

if (!process.env.SMOKE_KEEP) {
  rmSync(project, { recursive: true, force: true });
  rmSync(packDir, { recursive: true, force: true });
} else console.log(`\nKept: ${project}`);
console.log("\n✓ smoke test passed");
