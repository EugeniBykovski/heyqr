#!/usr/bin/env node
/*
 * HEY-167: bundles the `@heyqr/sdk/react` entry (src/react/index.tsx) into dist/react/index.js. HeyQR's renderer
 * (@heyqr/qr-core, a private workspace package) is inlined, so the tarball works without it; React stays external
 * (a peer dependency). The bundle must not contain the server client: checked below. Declarations come from tsc.
 */
import { build } from "esbuild";
import { readFileSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const pkgDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(pkgDir, "dist", "react", "index.js");
const result = await build({
  entryPoints: [join(pkgDir, "src", "react", "index.tsx")],
  outfile: out,
  bundle: true,
  format: "esm",
  platform: "neutral",
  target: "es2020",
  jsx: "automatic",
  external: ["react", "react/jsx-runtime"],
  mainFields: ["module", "main"],
  conditions: ["import", "default"],
  treeShaking: true,
  legalComments: "none",
  metafile: true,
  logLevel: "warning",
});
const bundle = readFileSync(out, "utf8");
const imports = [...bundle.matchAll(/(?:^|\n)\s*import\s[^;]*?from\s*"([^"]+)"/g)].map((m) => m[1]);
const outside = imports.filter((s) => s !== "react" && s !== "react/jsx-runtime");
if (outside.length) throw new Error(`dist/react imports more than React: ${outside.join(", ")}`);
for (const forbidden of ["HeyQrClient", "authorization", "Bearer ", "/api/v1"])
  if (bundle.includes(forbidden)) throw new Error(`dist/react contains the server client ("${forbidden}")`);
const inputs = Object.keys(result.metafile.inputs).map((f) => resolve(process.cwd(), f));
// Nothing from the SDK's own server modules: only src/react and the renderer.
const sdkSrc = join(pkgDir, "src") + sep;
const serverInputs = inputs.filter((f) => f.startsWith(sdkSrc) && !f.startsWith(join(sdkSrc, "react") + sep));
if (serverInputs.length) throw new Error(`dist/react bundled server modules: ${serverInputs.join(", ")}`);
console.log(
  `dist/react/index.js: ${(bundle.length / 1024).toFixed(1)} KB · imports ${[...new Set(imports)].join(", ")} · ${inputs.length} inputs (src/react + the renderer)`,
);
