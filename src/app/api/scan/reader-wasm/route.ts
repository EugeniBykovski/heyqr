import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";

/*
 * HEY-67: the ZXing reader for the editor's scan check, served from the app (the installed, pinned zxing-wasm) so the
 * browser never loads code from a third-party CDN. Resolved at runtime from qr-core, which depends on zxing-wasm: a
 * literal import would make the bundler try to compile the binary. Static content, cached for a year (versioned URL).
 */
const FILE = ["zxing-wasm", "reader", "zxing_reader.wasm"].join("/");

export async function GET() {
  const require = createRequire(path.join(process.cwd(), "packages", "qr-core", "package.json"));
  const wasm = await readFile(require.resolve(FILE));
  return new Response(new Uint8Array(wasm), {
    headers: { "Content-Type": "application/wasm", "Cache-Control": "public, max-age=31536000, immutable" },
  });
}
