/*
 * HEY-180 / QR-24.06: the font and print matrix, against a running HeyQR (test configuration, its own database).
 *
 *   DATABASE_URL=… BETTER_AUTH_SECRET=… QA_BASE=http://localhost:3180 QA_OUT=/tmp/print-matrix \
 *     pnpm exec tsx scripts/qa/print-matrix.ts
 *
 * It creates one QA account (qa-print) with codes through the public API, marks them bought and their Print Pack
 * included (fixtures: payment itself is covered by the UI matrix), then downloads every file the app offers for them
 * through the same routes a user does and checks: PNG pixels and resolution metadata, SVG size and viewBox, PDF pages,
 * the quiet zone and the edges, and that the code decodes (Static: its payload; Dynamic: its short link, which must
 * redirect to the destination). Results: <QA_OUT>/print-matrix.json and one line per check on stdout.
 * Never point it at a database you care about: it writes rows.
 */
import { createHmac } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { inflateSync } from "node:zlib";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { encodePayload } from "@heyqr/qr-core";
import { decodeImage } from "@heyqr/qr-core/verify";
import { DEFAULT_DESIGN, designSettingsOf, designToLayout, type EditorDesign } from "../../src/entities/qr";
import { CAPTION_FONTS, CAPTION_FONT_IDS, supportedWeights } from "../../packages/qr-core/src/caption-fonts";
import { createApiKey } from "../../src/server/api-keys/keys";
import { activateDynamicCode } from "../../src/server/billing/allowances";
import { newShortCode } from "../../src/server/db/ids";
import * as schema from "../../src/server/db/schema";

const BASE = process.env.QA_BASE ?? "http://localhost:3180";
const OUT = process.env.QA_OUT ?? "/tmp/print-matrix";
mkdirSync(OUT, { recursive: true });
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const db = drizzle(pool, { schema, casing: "snake_case" });
const USER = "qa-print";

type Row = { group: string; check: string; preset: string; font?: string; format?: string; result: "PASS" | "FAIL"; detail: string };
const rows: Row[] = [];
const record = (r: Row) => {
  rows.push(r);
  console.log(
    `${r.result.padEnd(4)} [${r.group}] ${r.preset}${r.font ? ` · ${r.font}` : ""}${r.format ? ` · ${r.format}` : ""} · ${r.check} — ${r.detail}`,
  );
};
const ok = (cond: boolean, row: Omit<Row, "result">) => record({ ...row, result: cond ? "PASS" : "FAIL" });

/* ── PNG reading: size, pHYs, pixels (8-bit RGB/RGBA, non-interlaced, as resvg writes) ─────────────────────── */
function readPng(buf: Buffer) {
  let p = 8;
  let width = 0;
  let height = 0;
  let colorType = 0;
  let ppm: { x: number; y: number; unit: number } | null = null;
  const idat: Buffer[] = [];
  while (p < buf.length) {
    const len = buf.readUInt32BE(p);
    const type = buf.toString("ascii", p + 4, p + 8);
    const data = buf.subarray(p + 8, p + 8 + len);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      colorType = data[9] ?? 0;
    }
    if (type === "pHYs") ppm = { x: data.readUInt32BE(0), y: data.readUInt32BE(4), unit: data[8] ?? 0 };
    if (type === "IDAT") idat.push(data);
    p += 12 + len;
  }
  const bpp = colorType === 6 ? 4 : colorType === 2 ? 3 : colorType === 4 ? 2 : 1;
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * bpp;
  const px = Buffer.alloc(height * stride);
  for (let y = 0; y < height; y++) {
    const f = raw[y * (stride + 1)] ?? 0;
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? (px[y * stride + x - bpp] ?? 0) : 0;
      const b = y > 0 ? (px[(y - 1) * stride + x] ?? 0) : 0;
      const c = x >= bpp && y > 0 ? (px[(y - 1) * stride + x - bpp] ?? 0) : 0;
      const v = line[x] ?? 0;
      const pa = Math.abs(b - c);
      const pb = Math.abs(a - c);
      const pc = Math.abs(a + b - 2 * c);
      const pred = f === 1 ? a : f === 2 ? b : f === 3 ? (a + b) >> 1 : f === 4 ? (pa <= pb && pa <= pc ? a : pb <= pc ? b : c) : 0;
      px[y * stride + x] = (v + pred) & 0xff;
    }
  }
  const dark = (x: number, y: number) => {
    const i = y * stride + x * bpp;
    const alpha = bpp === 4 ? (px[i + 3] ?? 255) : 255;
    const lum = bpp >= 3 ? 0.299 * (px[i] ?? 0) + 0.587 * (px[i + 1] ?? 0) + 0.114 * (px[i + 2] ?? 0) : (px[i] ?? 0);
    return alpha > 128 && lum < 128;
  };
  return { width, height, ppm, dark };
}
/** Bounding box of dark pixels. */
function darkBox(img: ReturnType<typeof readPng>) {
  let x0 = img.width;
  let y0 = img.height;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < img.height; y++)
    for (let x = 0; x < img.width; x++)
      if (img.dark(x, y)) {
        if (x < x0) x0 = x;
        if (y < y0) y0 = y;
        if (x > x1) x1 = x;
        if (y > y1) y1 = y;
      }
  return { x0, y0, x1, y1 };
}

/* ── Session, key, codes ─────────────────────────────────────────────────────────────────────────────────────── */
async function setup() {
  await pool.query(
    `insert into "user"(id,name,email,email_verified) values($1,'QA print','qa-print@example.test',true) on conflict do nothing`,
    [USER],
  );
  await pool.query(
    `insert into session(id,expires_at,token,user_id) values('s-qa-print',now()+interval '1 day','tok_qa_print',$1) on conflict do nothing`,
    [USER],
  );
  // A plan for the Dynamic code (fixture), so the short link is live as for a subscriber.
  await pool.query(
    `insert into subscription(id,user_id,stripe_subscription_id,stripe_price_id,status,active_code_limit,current_period_start,current_period_end)
     values('qa-print-sub',$1,'sub_qa_print','price_qa','active',5,now(),now()+interval '30 days') on conflict do nothing`,
    [USER],
  );
  const sig = createHmac("sha256", process.env.BETTER_AUTH_SECRET ?? "")
    .update("tok_qa_print")
    .digest("base64");
  const cookie = `better-auth.session_token=${encodeURIComponent(`tok_qa_print.${sig}`)}`;
  const { key } = await createApiKey(db, USER);
  return { cookie, key };
}

type Case = { id: string; group: string; preset: string; font?: string; design: EditorDesign; dynamic?: string };
const LONG = "Scan for today’s seasonal menu, opening hours and the table booking page";
const SCRIPTS: Record<string, string> = {
  latin: "Zażółć gęślą jaźń · Ærø · Ğüşİ · Đường phố",
  cyrillic: "Ёлка Йод Іван ї ґ Ўсё Жук — Щука",
  han: "扫码查看今日菜单",
  devanagari: "आज का मेनू देखें",
  arabic: "امسح لرؤية القائمة",
  kana: "メニューを見る",
  hangul: "메뉴 보기",
  thai: "สแกนเพื่อดูเมนู",
};
const mm = (qr: number, width: number, height: number) => ({ unit: "mm" as const, qr, width, height });

function cases(): Case[] {
  const list: Case[] = [];
  // Every font and weight, long caption on the smallest print preset (wrapping and fitting are tightest there).
  for (const font of CAPTION_FONT_IDS)
    for (const w of supportedWeights(font))
      list.push({
        id: `font-${font}-${w}`,
        group: "fonts",
        preset: "sticker 50×62 mm",
        font: `${CAPTION_FONTS[font].label} ${w}`,
        design: { ...DEFAULT_DESIGN, preset: "caption", caption: LONG, captionFont: font, captionWeight: w, size: mm(36, 50, 62) },
      });
  // Representative characters of the supported locales, in the default font.
  for (const [script, text] of Object.entries(SCRIPTS))
    list.push({
      id: `script-${script}`,
      group: "scripts",
      preset: "card 90×50 mm",
      font: `Onest · ${script}`,
      design: { ...DEFAULT_DESIGN, preset: "caption", caption: text, size: mm(36, 90, 50) },
    });
  // Every print preset and card layout, branded: dots, colors, a logo icon, a caption in a non-default font.
  const brand = {
    ...DEFAULT_DESIGN,
    pattern: "dot" as const,
    eyeFrame: "rounded" as const,
    fg: "#1F4D3A",
    bg: "#F7F1E6",
    logo: { kind: "icon" as const, icon: "wifi" as const },
  };
  list.push(
    {
      id: "preset-card",
      group: "presets",
      preset: "QR + caption · card 90×50 mm",
      design: { ...brand, preset: "caption", caption: "Little Fern Café", captionFont: "fraunces", size: mm(36, 90, 50) },
    },
    {
      id: "preset-a6",
      group: "presets",
      preset: "QR + caption · A6 105×148 mm",
      design: { ...brand, preset: "caption", caption: "Menu · Speisekarte · Меню", captionFont: "grotesk", size: mm(76, 105, 148) },
    },
    {
      id: "preset-sticker",
      group: "presets",
      preset: "QR + caption · sticker 50×62 mm",
      design: { ...brand, preset: "caption", caption: "Scan me", captionFont: "caveat", size: mm(36, 50, 62) },
    },
    {
      id: "preset-vertical",
      group: "presets",
      preset: "Vertical card 55×85 mm (41 mm code)",
      design: { ...brand, preset: "vertical", caption: "Little Fern", captionFont: "instrument", size: mm(41, 41, 41) },
    },
    {
      id: "preset-horizontal",
      group: "presets",
      preset: "Horizontal card 90×50 mm (35 mm code)",
      design: { ...brand, preset: "horizontal", caption: "Little Fern Café", captionFont: "mono", size: mm(35, 35, 35) },
    },
    {
      id: "preset-frame",
      group: "presets",
      preset: "Frame · bar, 40 mm",
      design: { ...brand, logo: { kind: "none" }, preset: "frame", frameStyle: "bar", size: mm(40, 40, 40) },
    },
    {
      id: "preset-qr-min",
      group: "presets",
      preset: "QR only · smallest 10 mm",
      design: { ...DEFAULT_DESIGN, preset: "qr", size: mm(10, 10, 10) },
    },
    {
      id: "preset-qr-max",
      group: "presets",
      preset: "QR only · largest 200 mm",
      design: { ...DEFAULT_DESIGN, preset: "qr", size: mm(200, 200, 200) },
    },
  );
  list.push({
    id: "dynamic",
    group: "dynamic",
    preset: "QR + caption · card 90×50 mm, Dynamic",
    dynamic: "https://littlefern.example/menu?table=4",
    design: { ...brand, preset: "caption", caption: "Today’s menu", size: mm(36, 90, 50) },
  });
  return list;
}

async function createCode(c: Case, key: string): Promise<{ qrId: string; layoutId: string; value: string }> {
  const url = c.dynamic ?? `https://littlefern.example/${c.id}`;
  const layout = designToLayout({ ...c.design, model: c.dynamic ? "dynamic" : "static", content: { type: "website", url } });
  const res = await fetch(`${BASE}/api/v1/qr-codes`, {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify({
      name: `QA ${c.id}`,
      mode: c.dynamic ? "dynamic" : "static",
      content: { type: "website", url },
      ...(c.dynamic ? { destination: c.dynamic } : {}),
      layouts: [{ name: c.preset.slice(0, 60), layout, editor: designSettingsOf(c.design) }],
    }),
  });
  if (res.status === 429) {
    await new Promise((r) => setTimeout(r, (Number(res.headers.get("retry-after")) || 5) * 1000));
    return createCode(c, key);
  }
  const body = (await res.json()) as { id: string; layouts: { id: string }[] };
  if (res.status !== 201) throw new Error(`create ${c.id}: ${res.status} ${JSON.stringify(body)}`);
  const layoutId = body.layouts[0]?.id ?? "";
  if (c.dynamic) {
    const r = await activateDynamicCode(db as never, USER, body.id, newShortCode);
    if (!("ok" in r) || !r.ok) throw new Error(`activate: ${JSON.stringify(r)}`);
    const { rows: q } = await pool.query("select short_code from qr_code where id=$1", [body.id]);
    return { qrId: body.id, layoutId, value: `${BASE}/r/${q[0].short_code}` };
  }
  await pool.query("update qr_code set purchased_at=now(), status='active', print_pack_at=now() where id=$1", [body.id]);
  return { qrId: body.id, layoutId, value: encodePayload({ type: "website", url }) };
}

const MM_PER_IN = 25.4;
async function exportsOf(c: Case, code: { qrId: string; layoutId: string; value: string }, cookie: string) {
  const get = (q: string) => fetch(`${BASE}/api/export/${code.layoutId}?qr=${code.qrId}&${q}`, { headers: { cookie }, redirect: "manual" });
  const s = c.design.size ?? mm(36, 36, 36);
  // The finished layout size, as the SVG states it (cards derive their canvas from the code).
  const svgRes = await get("format=svg");
  const svg = await svgRes.text();
  writeFileSync(`${OUT}/${c.id}.svg`, svg);
  const w = Number(/<svg[^>]*\swidth="([\d.]+)mm"/.exec(svg)?.[1]);
  const h = Number(/<svg[^>]*\sheight="([\d.]+)mm"/.exec(svg)?.[1]);
  const vb = /viewBox="([\d.\s-]+)"/.exec(svg)?.[1]?.split(/\s+/).map(Number) ?? [];
  const base = { group: c.group, preset: c.preset, font: c.font };
  ok(svgRes.status === 200 && w > 0 && h > 0, {
    ...base,
    format: "SVG",
    check: "physical size in mm",
    detail: `${svgRes.status} · ${w} × ${h} mm`,
  });
  if (c.preset.includes("×") && /QR \+ caption/.test(c.preset))
    ok(Math.abs(w - s.width) < 0.01 && Math.abs(h - s.height) < 0.01, {
      ...base,
      format: "SVG",
      check: "size equals the preset",
      detail: `${w} × ${h} mm vs ${s.width} × ${s.height}`,
    });
  ok(vb.length === 4 && Math.abs(vb[2] / vb[3] - w / h) < 0.001, {
    ...base,
    format: "SVG",
    check: "viewBox keeps the aspect ratio",
    detail: `viewBox ${vb.join(" ")}`,
  });
  const fontFaces = (svg.match(/@font-face/g) ?? []).length;
  if (c.font) ok(fontFaces > 0, { ...base, format: "SVG", check: "caption font embedded", detail: `${fontFaces} @font-face` });

  for (const dpi of [300, 600, 1200]) {
    const r = await get(`format=png&dpi=${dpi}`);
    if (r.status !== 200) {
      // Over the PNG size limit is refused (422 too_large); the UI offers only the DPIs that fit.
      ok(r.status === 422 && (w / MM_PER_IN) * dpi > 8192 - 1, {
        ...base,
        format: `PNG ${dpi} dpi`,
        check: "offered or refused as too large",
        detail: `${r.status}`,
      });
      continue;
    }
    const buf = Buffer.from(await r.arrayBuffer());
    if (dpi === 300) writeFileSync(`${OUT}/${c.id}-300.png`, buf);
    const img = readPng(buf);
    const ew = Math.round((w / MM_PER_IN) * dpi);
    const eh = Math.round((h / MM_PER_IN) * dpi);
    ok(img.width === ew && img.height === eh, {
      ...base,
      format: `PNG ${dpi} dpi`,
      check: "pixels = mm × dpi",
      detail: `${img.width} × ${img.height} px, expected ${ew} × ${eh}`,
    });
    const ppm = Math.round(dpi / 0.0254);
    ok(img.ppm?.unit === 1 && Math.abs(img.ppm.x - ppm) <= 1 && Math.abs(img.ppm.y - ppm) <= 1, {
      ...base,
      format: `PNG ${dpi} dpi`,
      check: "resolution metadata (pHYs) says the dpi",
      detail: img.ppm
        ? `pHYs ${img.ppm.x}×${img.ppm.y} per ${img.ppm.unit ? "metre" : "unit"} (${Math.round(img.ppm.x * 0.0254)} dpi)`
        : "no pHYs chunk: opens as 72 dpi",
    });
    if (dpi === 300 || (c.id === "preset-qr-max" && dpi === 600)) {
      const decoded = await decodeImage(new Uint8Array(buf));
      ok(decoded === code.value, {
        ...base,
        format: `PNG ${dpi} dpi`,
        check: c.dynamic ? "decodes to the permanent short link" : "decodes to the payload",
        detail: `${JSON.stringify(decoded)}`,
      });
      // Edges: nothing dark touches the file's border; QR only: the 4-module quiet zone is inside the set size.
      const box = darkBox(img);
      const border = /<rect x="([\d.]+)" y="([\d.]+)" width="[\d.]+" height="[\d.]+"[^>]*stroke-width="([\d.]+)"/.exec(svg);
      if (c.design.preset === "vertical" || c.design.preset === "horizontal") {
        // Cards draw their border flush with the canvas: it must be inset by half its stroke, so none of it is cut.
        const [x, y, sw] = [Number(border?.[1]), Number(border?.[2]), Number(border?.[3])];
        ok(Boolean(border) && x >= sw / 2 - 1e-3 && y >= sw / 2 - 1e-3, {
          ...base,
          format: `PNG ${dpi} dpi`,
          check: "card border fully inside the canvas",
          detail: `border at ${x}, ${y} mm with a ${sw} mm stroke`,
        });
      } else if (c.design.preset === "frame") {
        // The frame's fill reaches the canvas edge by design; the code inside keeps its quiet zone.
        ok(box.x0 === 0 && box.y0 === 0, {
          ...base,
          format: `PNG ${dpi} dpi`,
          check: "frame fills its canvas (by design)",
          detail: `dark box ${box.x0},${box.y0}–${box.x1},${box.y1} in ${img.width}×${img.height}`,
        });
      } else
        ok(box.x0 > 0 && box.y0 > 0 && box.x1 < img.width - 1 && box.y1 < img.height - 1, {
          ...base,
          format: `PNG ${dpi} dpi`,
          check: "no clipping at the edges",
          detail: `dark box ${box.x0},${box.y0}–${box.x1},${box.y1} in ${img.width}×${img.height}`,
        });
      if (c.design.preset === "qr") {
        const side = box.x1 - box.x0 + 1;
        // Module count from the version: side of the dark symbol in modules = 17 + 4v; quiet zone = 4 modules each side.
        const total = img.width;
        let best = { v: 0, err: Infinity };
        for (let v = 1; v <= 20; v++) {
          const n = 17 + 4 * v;
          const err = Math.abs(side / n - total / (n + 8));
          if (err < best.err) best = { v, err };
        }
        const n = 17 + 4 * best.v;
        const moduleMm = w / (n + 8);
        const quietMm = (box.x0 / img.width) * w;
        ok(Math.abs(quietMm - 4 * moduleMm) < moduleMm * 0.6, {
          ...base,
          format: `PNG ${dpi} dpi`,
          check: "quiet zone is 4 modules",
          detail: `version ${best.v}, module ${moduleMm.toFixed(3)} mm, quiet zone ${quietMm.toFixed(2)} mm (${(quietMm / moduleMm).toFixed(1)} modules)`,
        });
      }
    }
  }
  const pdfRes = await get("format=pdf");
  const pdf = Buffer.from(await pdfRes.arrayBuffer());
  const box = /\/MediaBox\s*\[\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\]/.exec(pdf.toString("latin1"));
  const pw = Number(box?.[3]) - Number(box?.[1]);
  const ph = Number(box?.[4]) - Number(box?.[2]);
  ok(pdfRes.status === 200 && Math.abs((pw * MM_PER_IN) / 72 - w) < 0.1 && Math.abs((ph * MM_PER_IN) / 72 - h) < 0.1, {
    ...base,
    format: "PDF",
    check: "page = layout size",
    detail: `${pdfRes.status} · ${((pw * MM_PER_IN) / 72).toFixed(2)} × ${((ph * MM_PER_IN) / 72).toFixed(2)} mm`,
  });
  return { w, h };
}

async function printPack(c: Case, code: { qrId: string; layoutId: string }, cookie: string, size: { w: number; h: number }) {
  for (const settings of [
    { scale: 1, bleed: 3, cropMarks: true },
    { scale: 1.5, bleed: 0, cropMarks: false },
    { scale: 2, bleed: 5, cropMarks: true },
  ]) {
    const pre = await fetch(`${BASE}/api/print/preview`, {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ layoutId: code.layoutId, settings }),
    });
    const body = (await pre.json()) as { renderKey?: string; scanOk?: boolean };
    const label = `Print Pack · ×${settings.scale}, bleed ${settings.bleed} mm${settings.cropMarks ? ", crop marks" : ""}`;
    if (pre.status !== 200 || !body.renderKey) {
      ok(false, { group: c.group, preset: c.preset, format: label, check: "print preview", detail: `${pre.status}` });
      continue;
    }
    const q = new URLSearchParams({
      qr: code.qrId,
      key: body.renderKey,
      scale: String(settings.scale),
      bleed: String(settings.bleed),
      cropMarks: settings.cropMarks ? "1" : "0",
    });
    const fin = { w: size.w * settings.scale, h: size.h * settings.scale };
    const pdfRes = await fetch(`${BASE}/api/print/files/${code.layoutId}?file=pdf&${q}`, { headers: { cookie } });
    const pdf = Buffer.from(await pdfRes.arrayBuffer()).toString("latin1");
    const mb = /\/MediaBox\s*\[\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\]/.exec(pdf);
    const tb = /\/TrimBox\s*\[\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\]/.exec(pdf);
    const toMm = (pt: number) => (pt * MM_PER_IN) / 72;
    const pageW = toMm(Number(mb?.[3]) - Number(mb?.[1]));
    const pageH = toMm(Number(mb?.[4]) - Number(mb?.[2]));
    const marks = settings.cropMarks || settings.bleed ? null : 0;
    ok(
      pdfRes.status === 200 &&
        pageW >= fin.w + 2 * settings.bleed - 0.1 &&
        pageH >= fin.h + 2 * settings.bleed - 0.1 &&
        (marks === null || Math.abs(pageW - fin.w) < 0.1),
      {
        group: c.group,
        preset: c.preset,
        format: `${label} · PDF`,
        check: "page holds finished size + bleed",
        detail: `${pdfRes.status} · page ${pageW.toFixed(2)} × ${pageH.toFixed(2)} mm, finished ${fin.w} × ${fin.h} mm${tb ? `, TrimBox ${toMm(Number(tb[3]) - Number(tb[1])).toFixed(2)} × ${toMm(Number(tb[4]) - Number(tb[2])).toFixed(2)} mm` : ", no TrimBox"}`,
      },
    );
    const svgRes = await fetch(`${BASE}/api/print/files/${code.layoutId}?file=svg&${q}`, { headers: { cookie } });
    const svg = await svgRes.text();
    const sw = Number(/<svg[^>]*\swidth="([\d.]+)mm"/.exec(svg)?.[1]);
    ok(svgRes.status === 200 && Math.abs(sw - fin.w) < 0.05, {
      group: c.group,
      preset: c.preset,
      format: `${label} · SVG`,
      check: "editable SVG at finished size",
      detail: `${svgRes.status} · ${sw} mm wide, expected ${fin.w}`,
    });
    const specRes = await fetch(`${BASE}/api/print/files/${code.layoutId}?file=spec&${q}`, { headers: { cookie } });
    ok(specRes.status === 200 && (specRes.headers.get("content-type") ?? "").includes("pdf"), {
      group: c.group,
      preset: c.preset,
      format: `${label} · spec`,
      check: "specification sheet",
      detail: `${specRes.status} ${specRes.headers.get("content-type")}`,
    });
  }
}

const { cookie, key } = await setup();
const made: Record<string, { qrId: string; layoutId: string; value: string }> = {};
for (const c of cases()) {
  const code = await createCode(c, key);
  made[c.id] = code;
  const size = await exportsOf(c, code, cookie);
  if (c.group === "presets" && c.design.size?.unit === "mm" && c.id !== "preset-qr-max") await printPack(c, code, cookie, size);
  if (c.dynamic) {
    const r = await fetch(code.value, { redirect: "manual", headers: { "x-heyqr-test": "1" } });
    ok(r.status === 302 && r.headers.get("location") === c.dynamic && r.headers.get("cache-control") === "no-store", {
      group: c.group,
      preset: c.preset,
      check: "short link redirects to the destination",
      detail: `${r.status} → ${r.headers.get("location")} (${r.headers.get("cache-control")})`,
    });
  }
}
writeFileSync(`${OUT}/print-matrix.json`, JSON.stringify({ rows, codes: made }, null, 2));
const failed = rows.filter((r) => r.result === "FAIL").length;
console.log(`\n${rows.length} checks, ${rows.length - failed} PASS, ${failed} FAIL`);
await pool.end();
