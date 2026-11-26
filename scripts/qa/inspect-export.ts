/*
 * HEY-184 QA only: inspects a downloaded paid file against the layout as it is saved now, so a journey can prove the
 * file reflects the saved design (not just that its name, hash or timestamp changed).
 *
 *   QA_DATABASE_URL=… pnpm exec tsx --conditions=react-server scripts/qa/inspect-export.ts <file.png|file.svg> <layoutId> \
 *     [--scale=4] [--colors=#1f5c45,#0d0d12]
 *
 * Prints one JSON line:
 * - payload: what ZXing decodes from the file;
 * - reference: the server's own renderer (renderExport, the function /api/export uses) run on the saved layout and the
 *   code's encoded value from the database. SVG: `identical` (byte equality). PNG: same size and the share of pixels
 *   that differ by more than 8 per channel;
 * - fills (SVG) or pixel counts per --colors hex (PNG, ±12 per channel), and the caption texts in the SVG.
 * `--conditions=react-server` lets the server modules load outside Next (server-only resolves to its empty build).
 */
import { readFileSync } from "node:fs";
import { inflateSync } from "node:zlib";
import pg from "pg";
import { decodeImage, decodeSvg } from "@heyqr/qr-core/verify";
import { encodedValue, renderExport } from "../../src/server/qr/export";

const [file, layoutId, ...flags] = process.argv.slice(2);
if (!file || !layoutId) throw new Error("usage: inspect-export.ts <file> <layoutId> [--scale=N] [--colors=#hex,…]");
const flag = (name: string) => flags.find((f) => f.startsWith(`--${name}=`))?.split("=")[1];
const scale = Number(flag("scale") ?? 2);
const colors = (flag("colors") ?? "").split(",").filter(Boolean);

/** RGBA pixels of an 8-bit, non-interlaced PNG (what resvg writes): IHDR, IDAT inflate, per-row unfilter. */
function pngPixels(buf: Buffer) {
  let pos = 8;
  let width = 0;
  let height = 0;
  let type = 0;
  const idat: Buffer[] = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const kind = buf.toString("latin1", pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (kind === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      if (data[8] !== 8 || data[12] !== 0) throw new Error("only 8-bit non-interlaced PNGs");
      type = data[9] ?? 0;
    } else if (kind === "IDAT") idat.push(data);
    pos += 12 + len;
  }
  const channels = type === 6 ? 4 : type === 2 ? 3 : type === 4 ? 2 : 1;
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const out = Buffer.alloc(width * height * 4);
  const prev = Buffer.alloc(stride);
  const line = Buffer.alloc(stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    raw.copy(line, 0, y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? (line[x - channels] ?? 0) : 0;
      const b = prev[x] ?? 0;
      const c = x >= channels ? (prev[x - channels] ?? 0) : 0;
      const v = line[x] ?? 0;
      let r = v;
      if (filter === 1) r = v + a;
      else if (filter === 2) r = v + b;
      else if (filter === 3) r = v + ((a + b) >> 1);
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        r = v + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
      }
      line[x] = r & 0xff;
    }
    line.copy(prev);
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const s = x * channels;
      if (channels >= 3) {
        out[i] = line[s] ?? 0;
        out[i + 1] = line[s + 1] ?? 0;
        out[i + 2] = line[s + 2] ?? 0;
        out[i + 3] = channels === 4 ? (line[s + 3] ?? 255) : 255;
      } else {
        out[i] = out[i + 1] = out[i + 2] = line[s] ?? 0;
        out[i + 3] = channels === 2 ? (line[s + 1] ?? 255) : 255;
      }
    }
  }
  return { width, height, data: out };
}

const hex = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));

const client = new pg.Client({ connectionString: process.env.QA_DATABASE_URL ?? process.env.DATABASE_URL });
await client.connect();
const { rows } = await client.query(
  `select l.design, q.model, q.content, q.short_code from qr_layout l join qr_code q on q.id = l.qr_code_id where l.id = $1`,
  [layoutId],
);
await client.end();
const row = rows[0];
if (!row) throw new Error(`layout ${layoutId} not found`);
const layout = row.design.layout;
const value = encodedValue({ model: row.model, content: row.content, shortCode: row.short_code });
const bytes = readFileSync(file);
const isSvg = file.endsWith(".svg");
const payload = isSvg ? await decodeSvg(bytes.toString("utf8")) : await decodeImage(new Uint8Array(bytes));
const ref = await renderExport(layout, value, isSvg ? "svg" : "png", isSvg ? {} : { scale });
const result: Record<string, unknown> = { file, payload, value, savedFg: layout.colors?.fg, savedCaption: layout.caption?.text ?? "" };
if (isSvg) {
  const svg = bytes.toString("utf8");
  result.reference = { identical: svg === ref.body.toString("utf8") };
  result.fills = [...new Set([...svg.matchAll(/fill="(#[0-9A-Fa-f]{6})"/g)].map((m) => (m[1] ?? "").toLowerCase()))];
  result.texts = [...svg.matchAll(/<text[^>]*>([\s\S]*?)<\/text>/g)].map((m) => (m[1] ?? "").replace(/<[^>]+>/g, "").trim());
} else {
  const got = pngPixels(bytes);
  const want = pngPixels(Buffer.from(ref.body));
  let differing = 0;
  if (got.width === want.width && got.height === want.height)
    for (let i = 0; i < got.data.length; i += 4)
      if ([0, 1, 2, 3].some((k) => Math.abs((got.data[i + k] ?? 0) - (want.data[i + k] ?? 0)) > 8)) differing++;
  result.reference = {
    sameSize: got.width === want.width && got.height === want.height,
    width: got.width,
    height: got.height,
    differingPixelShare: differing / (got.width * got.height),
  };
  result.pixels = Object.fromEntries(
    colors.map((c) => {
      const [r = 0, g = 0, b = 0] = hex(c);
      let count = 0;
      for (let i = 0; i < got.data.length; i += 4)
        if (
          Math.abs((got.data[i] ?? 0) - r) <= 12 &&
          Math.abs((got.data[i + 1] ?? 0) - g) <= 12 &&
          Math.abs((got.data[i + 2] ?? 0) - b) <= 12
        )
          count++;
      return [c.toLowerCase(), count / (got.width * got.height)];
    }),
  );
}
console.log(JSON.stringify(result));
