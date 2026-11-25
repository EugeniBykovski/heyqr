#!/usr/bin/env node
/*
 * HEY-168: after a build, checks every entry point the package exports.
 *   - Each export condition points at a built file in dist/, and every JavaScript entry has its declarations.
 *   - The browser entry (`browser` condition of ".") and the React entry ("./react") load no API client, no
 *     authentication code and no Node-only module: their whole import graph is walked and checked.
 *   - The server entry still exposes the same runtime exports as the browser entry, plus the real client.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, normalize } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const pkgDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(join(pkgDir, "package.json"), "utf8"));
const published = pkg.publishConfig?.exports ?? pkg.exports;
const fail = (message) => {
  throw new Error(`check-entries: ${message}`);
};

// 1. Every published condition resolves to a built file; JS entries have matching .d.ts files.
for (const [subpath, conditions] of Object.entries(published)) {
  for (const [condition, target] of Object.entries(conditions)) {
    if (!target.startsWith("./dist/")) fail(`${subpath} → ${condition} points outside dist: ${target}`);
    if (!existsSync(join(pkgDir, target))) fail(`${subpath} → ${condition}: ${target} doesn't exist`);
    if (target.endsWith(".js") && !existsSync(join(pkgDir, target.replace(/\.js$/, ".d.ts"))))
      fail(`${subpath} → ${condition}: ${target} has no declarations next to it`);
  }
  if (!conditions.types) fail(`${subpath} has no types condition`);
}

// 2. The browser-safe graphs.
const FORBIDDEN = [/\bBearer\b/, /\bauthorization\b/i, /#apiKey/, /\/api\/v1/, /from\s+"node:/, /\brequire\(/];
function graph(entry) {
  const seen = new Set();
  const stack = [normalize(join(pkgDir, entry))];
  while (stack.length) {
    const file = stack.pop();
    if (seen.has(file)) continue;
    seen.add(file);
    const code = readFileSync(file, "utf8");
    const specs = [
      ...code.matchAll(/^\s*(?:import|export)\s+(?:type\s+)?[\w*{}\s,$]+?\s+from\s+"([^"]+)"/gm),
      ...code.matchAll(/^\s*import\s+"([^"]+)"/gm),
    ];
    for (const [, spec] of specs) {
      if (spec.startsWith(".")) stack.push(normalize(join(dirname(file), spec)));
      else if (spec !== "react" && spec !== "react/jsx-runtime") fail(`${entry} imports "${spec}"`);
    }
  }
  return [...seen];
}
for (const entry of [published["."].browser, published["./react"].import]) {
  const files = graph(entry);
  for (const file of files) {
    if (/[\\/]client\.js$/.test(file)) fail(`${entry} loads the API client (${file})`);
    const code = readFileSync(file, "utf8");
    for (const pattern of FORBIDDEN) if (pattern.test(code)) fail(`${entry} contains server code (${pattern}) in ${file}`);
  }
  console.log(`${entry}: ${files.length} module(s), browser-safe (no client, auth or Node modules)`);
}

// Positive control: the same walk does find the client from the server entry.
if (!graph(published["."].import).some((f) => /[\\/]client\.js$/.test(f)))
  fail("the import walk didn't find client.js from the server entry");

// 3. The same runtime names on both sides of ".", and the real client only on the server.
const server = await import(pathToFileURL(join(pkgDir, published["."].import)).href);
const browser = await import(pathToFileURL(join(pkgDir, published["."].browser)).href);
const names = (m) => Object.keys(m).sort();
if (JSON.stringify(names(server)) !== JSON.stringify(names(browser)))
  fail(`server and browser entries differ: ${names(server)} vs ${names(browser)}`);
let browserThrew = "";
try {
  new browser.HeyQrClient({ apiKey: "hqk_x", baseUrl: "https://heyqr.example" });
} catch (error) {
  browserThrew = `${error?.name}/${error?.kind}`;
}
if (browserThrew !== "HeyQrError/server_only")
  fail(`the browser HeyQrClient must throw HeyQrError server_only (got ${browserThrew || "nothing"})`);
console.log(
  `"." exports the same ${names(server).length} runtime names in Node and in browsers; the browser HeyQrClient throws ${browserThrew}`,
);
