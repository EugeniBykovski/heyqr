/*
 * HEY-181 / QR-24.07: scanning and access journeys against a running HeyQR in test configuration, with its own
 * database (it writes rows: QA accounts, codes, fixtures for a plan and a purchase).
 *
 *   DATABASE_URL=… BETTER_AUTH_SECRET=… QA_BASE=http://localhost:3181 QA_OUT=/tmp/journeys pnpm exec tsx scripts/qa/critical-journeys.ts
 *
 * Scanning: a Static export decodes to its payload; a Dynamic export decodes to its permanent short link, which
 * redirects to the destination, follows a destination change with the same file, and stops for a paused or deleted code
 * (and comes back on resume / undo). Access: signed out, the owner and a second account against every entry point that
 * serves a code, a layout or a paid file. Writes <QA_OUT>/journeys.json; one line per check.
 */
import { createHmac } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { encodePayload } from "@heyqr/qr-core";
import { decodeImage } from "@heyqr/qr-core/verify";
import { DEFAULT_DESIGN, designSettingsOf, designToLayout } from "../../src/entities/qr";
import { createApiKey } from "../../src/server/api-keys/keys";
import { activateDynamicCode } from "../../src/server/billing/allowances";
import { pauseDynamicCode, resumeDynamicCode } from "../../src/server/billing/pause";
import { restoreQrCodes, softDeleteQrCodes } from "../../src/server/qr/delete-qr";
import { newShortCode } from "../../src/server/db/ids";
import * as schema from "../../src/server/db/schema";

const BASE = process.env.QA_BASE ?? "http://localhost:3181";
const OUT = process.env.QA_OUT ?? "/tmp/journeys";
mkdirSync(OUT, { recursive: true });
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const db = drizzle(pool, { schema, casing: "snake_case" });
type Row = { area: string; check: string; result: "PASS" | "FAIL"; detail: string };
const rows: Row[] = [];
const ok = (area: string, check: string, pass: boolean, detail: string) => {
  rows.push({ area, check, result: pass ? "PASS" : "FAIL", detail });
  console.log(`${pass ? "PASS" : "FAIL"} [${area}] ${check} — ${detail}`);
};

async function account(id: string) {
  await pool.query(`insert into "user"(id,name,email,email_verified) values($1,$1,$1||'@example.test',true) on conflict do nothing`, [id]);
  await pool.query(
    `insert into session(id,expires_at,token,user_id) values('s-'||$1,now()+interval '1 day','tok_'||$1,$1) on conflict do nothing`,
    [id],
  );
  const sig = createHmac("sha256", process.env.BETTER_AUTH_SECRET ?? "")
    .update(`tok_${id}`)
    .digest("base64");
  return `better-auth.session_token=${encodeURIComponent(`tok_${id}.${sig}`)}`;
}

const run = Date.now().toString(36);
const OWNER = `qa181-owner-${run}`;
const OTHER = `qa181-other-${run}`;
const owner = await account(OWNER);
const other = await account(OTHER);
await pool.query(
  `insert into subscription(id,user_id,stripe_subscription_id,stripe_price_id,status,active_code_limit,current_period_start,current_period_end)
   values('sub-'||$1,$1,'sub_'||$1,'price_qa','active',5,now(),now()+interval '30 days')`,
  [OWNER],
);
const { key } = await createApiKey(db, OWNER);
const api = (path: string, init: RequestInit = {}) =>
  fetch(`${BASE}/api/v1${path}`, {
    ...init,
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json", ...(init.headers ?? {}) },
  });

const design = {
  ...DEFAULT_DESIGN,
  preset: "caption" as const,
  caption: "Scan me",
  size: { unit: "mm" as const, qr: 36, width: 50, height: 62 },
};
async function create(mode: "static" | "dynamic", url: string) {
  const layout = designToLayout({ ...design, model: mode, content: { type: "website", url } });
  const res = await api("/qr-codes", {
    method: "POST",
    body: JSON.stringify({
      name: `QA ${mode}`,
      mode,
      content: { type: "website", url },
      ...(mode === "dynamic" ? { destination: url } : {}),
      layouts: [{ name: "Sticker", layout, editor: designSettingsOf(design) }],
    }),
  });
  const body = (await res.json()) as { id: string; layouts: { id: string }[] };
  if (res.status !== 201) throw new Error(`create ${mode}: ${res.status} ${JSON.stringify(body)}`);
  return { qr: body.id, layout: body.layouts[0]?.id ?? "" };
}
const file = async (layout: string, cookie: string | null, q = "format=png&dpi=300") =>
  fetch(`${BASE}/api/export/${layout}?${q}`, { headers: cookie ? { cookie } : {}, redirect: "manual" });
const scan = async (link: string) => {
  const r = await fetch(link, { redirect: "manual", headers: { "x-heyqr-test": "1" } });
  return { status: r.status, location: r.headers.get("location"), cache: r.headers.get("cache-control") };
};

/* ── Scanning ─────────────────────────────────────────────────────────────────────────────────────────────── */
const st = await create("static", "https://littlefern.example/menu?table=4");
await pool.query("update qr_code set purchased_at=now(), status='active' where id=$1", [st.qr]); // purchase fixture
const stPng = Buffer.from(await (await file(st.layout, owner)).arrayBuffer());
writeFileSync(`${OUT}/static.png`, stPng);
const expected = encodePayload({ type: "website", url: "https://littlefern.example/menu?table=4" });
const stDecoded = await decodeImage(new Uint8Array(stPng));
ok("scan", "Static export decodes to its payload", stDecoded === expected, JSON.stringify(stDecoded));

const dy = await create("dynamic", "https://littlefern.example/today");
const act = await activateDynamicCode(db as never, OWNER, dy.qr, newShortCode);
ok("scan", "Dynamic code activates under the plan", "ok" in act && act.ok, JSON.stringify(act));
const slug = "shortCode" in act ? act.shortCode : "";
const link = `${BASE}/r/${slug}`;
const dyPng = Buffer.from(await (await file(dy.layout, owner)).arrayBuffer());
writeFileSync(`${OUT}/dynamic.png`, dyPng);
const dyDecoded = await decodeImage(new Uint8Array(dyPng));
ok("scan", "Dynamic export decodes to the permanent short link", dyDecoded === link, `${dyDecoded}`);
let s = await scan(dyDecoded ?? link);
ok(
  "scan",
  "short link → destination (302, no-store)",
  s.status === 302 && s.location === "https://littlefern.example/today" && s.cache === "no-store",
  JSON.stringify(s),
);
const cur = (await (await api(`/qr-codes/${dy.qr}/destination`)).json()) as { revision: number };
const patch = await api(`/qr-codes/${dy.qr}/destination`, {
  method: "PATCH",
  body: JSON.stringify({ destination: "https://littlefern.example/tomorrow", revision: cur.revision }),
});
ok("scan", "destination change accepted", patch.status === 200, `${patch.status}`);
s = await scan(dyDecoded ?? link);
ok("scan", "the same exported file reaches the new destination", s.location === "https://littlefern.example/tomorrow", JSON.stringify(s));
const after = await decodeImage(new Uint8Array(Buffer.from(await (await file(dy.layout, owner)).arrayBuffer())));
ok("scan", "a new export still encodes the same short link", after === dyDecoded, `${after}`);
const paused = await pauseDynamicCode(db as never, OWNER, dy.qr);
s = await scan(link);
ok(
  "scan",
  "paused → unavailable page, not the destination",
  JSON.stringify(paused).includes("true") && s.status === 302 && (s.location ?? "").includes("/link-unavailable"),
  `${JSON.stringify(paused)} ${JSON.stringify(s)}`,
);
await resumeDynamicCode(db as never, OWNER, dy.qr);
s = await scan(link);
ok("scan", "resumed → destination again", s.location === "https://littlefern.example/tomorrow", JSON.stringify(s));
await softDeleteQrCodes(db, OWNER, [dy.qr]);
s = await scan(link);
ok("scan", "deleted → unavailable page", (s.location ?? "").includes("/link-unavailable"), JSON.stringify(s));
await restoreQrCodes(db, OWNER, [dy.qr]);
s = await scan(link);
ok("scan", "undo → same link, destination again", s.location === "https://littlefern.example/tomorrow", JSON.stringify(s));
await pool.query("update subscription set status='canceled' where user_id=$1", [OWNER]);
s = await scan(link);
ok("scan", "plan ended → 'not active' page (reason=inactive)", (s.location ?? "").includes("reason=inactive"), JSON.stringify(s));
await pool.query("update subscription set status='active' where user_id=$1", [OWNER]);

/* ── Access ───────────────────────────────────────────────────────────────────────────────────────────────── */
const { rows: dl } = await pool.query("select id from qr_layout where qr_code_id=$1", [st.qr]);
const routes: [string, string][] = [
  ["export PNG", `/api/export/${st.layout}?format=png`],
  ["export SVG", `/api/export/${st.layout}?format=svg`],
  ["export PDF", `/api/export/${st.layout}?format=pdf`],
  ["Download all", `/api/export/all/${st.qr}`],
  ["print files", `/api/print/files/${st.layout}?file=pdf&key=00000000`],
  ["receipt", `/api/billing/receipt/does-not-matter`],
];
for (const [name, path] of routes) {
  const anon = await fetch(BASE + path, { redirect: "manual" });
  const x = await fetch(BASE + path, { headers: { cookie: other }, redirect: "manual" });
  const own = await fetch(BASE + path, { headers: { cookie: owner }, redirect: "manual" });
  ok(
    "access",
    `${name}: signed out 401, second account 404, owner allowed`,
    anon.status === 401 && x.status === 404 && (own.status < 400 || name === "print files" || name === "receipt"),
    `anon ${anon.status} · other ${x.status} · owner ${own.status}`,
  );
}
for (const [name, path] of [
  ["details page", `/dashboard/qr/${st.qr}`],
  ["edit page", `/edit/${st.qr}?layout=${dl[0]?.id}`],
  ["export page", `/create/export?qr=${st.qr}&layout=${st.layout}`],
] as const) {
  // These pages stream (loading.tsx): a redirect or not-found arrives in the stream as NEXT_REDIRECT / the 404 fallback,
  // with HTTP 200. The ids in the URL are echoed back; the code's content and name must not be.
  const anonBody = await (await fetch(BASE + path)).text();
  const target = /NEXT_REDIRECT;[a-z]+;([^;"]+)/.exec(anonBody)?.[1] ?? "";
  const x = await fetch(BASE + path, { headers: { cookie: other } });
  const body = await x.text();
  const own = await (await fetch(BASE + path, { headers: { cookie: owner } })).text();
  const leaked = body.includes("littlefern.example") || body.includes("QA static");
  const notFound = body.includes("NEXT_HTTP_ERROR_FALLBACK;404");
  const keeps = target.startsWith("/sign-in?next=") && decodeURIComponent(target).includes(path.split("?")[0] ?? "");
  ok(
    "access",
    `${name}: signed out → sign-in keeping the target; second account gets not-found with nothing of the code; owner sees it`,
    keeps && notFound && !leaked && own.includes("QA static"),
    `anon → ${target.slice(0, 90)} · other not-found=${notFound} leaked=${leaked} · owner ${own.includes("QA static")}`,
  );
}
// Public API: another account's key gets 404 for the owner's code; no key 401.
const { key: otherKey } = await createApiKey(db, OTHER);
for (const path of [
  `/qr-codes/${st.qr}/layouts/${st.layout}`,
  `/qr-codes/${dy.qr}/destination`,
  `/qr-codes/${st.qr}/layouts/${st.layout}/export?format=png`,
]) {
  const x = await fetch(`${BASE}/api/v1${path}`, { headers: { authorization: `Bearer ${otherKey}` } });
  const anon = await fetch(`${BASE}/api/v1${path}`);
  ok(
    "access",
    `API ${path.replace(/[A-Za-z0-9_-]{15,}/g, "<id>")}: other key 404, no key 401`,
    x.status === 404 && anon.status === 401,
    `other ${x.status} · anon ${anon.status}`,
  );
}
const xPatch = await fetch(`${BASE}/api/v1/qr-codes/${dy.qr}/destination`, {
  method: "PATCH",
  headers: { authorization: `Bearer ${otherKey}`, "content-type": "application/json" },
  body: JSON.stringify({ destination: "https://evil.example", revision: 1 }),
});
s = await scan(link);
ok(
  "access",
  "another account can't change the destination",
  xPatch.status === 404 && s.location === "https://littlefern.example/tomorrow",
  `${xPatch.status} · ${s.location}`,
);

writeFileSync(`${OUT}/journeys.json`, JSON.stringify(rows, null, 2));
const failed = rows.filter((r) => r.result === "FAIL").length;
console.log(`\n${rows.length} checks, ${rows.length - failed} PASS, ${failed} FAIL`);
await pool.end();
