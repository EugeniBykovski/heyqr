/*
 * HEY-182: decodes a downloaded QR file with ZXing (the same decoder the app's scan check uses) and prints the payload
 * as JSON, so a browser journey can compare it with what was typed. PNG through decodeImage, SVG through decodeSvg.
 *
 *   pnpm exec tsx scripts/qa/decode-file.ts <file.png|file.svg>
 */
import { readFileSync } from "node:fs";
import { decodeImage, decodeSvg } from "@heyqr/qr-core/verify";

const file = process.argv[2];
if (!file) throw new Error("usage: decode-file.ts <file>");
const bytes = readFileSync(file);
const payload = file.endsWith(".svg") ? await decodeSvg(bytes.toString("utf8")) : await decodeImage(new Uint8Array(bytes));
console.log(JSON.stringify({ file, payload }));
