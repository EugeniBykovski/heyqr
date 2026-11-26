/*
 * HEY-184: a purchased Static QR, redesigned in one browser and downloaded again in another, in real browsers against a
 * running HeyQR in test configuration (local or a deployed Preview). One run per fresh account; each starts signed out.
 *
 *   node scripts/qa/cross-browser-download.mjs <engineA> <engineB> <390|834|1440> [tag]
 *
 *   Browser A (its own browser process and profile): guest creates a Static Website QR (Dots, Forest) → Export →
 *   Continue with Google → Stripe test Checkout (4242) → baseline PNG and SVG (a Single QR covers PNG and SVG of every
 *   layout). Then Edit design on the purchased code: a new foreground colour and a caption, saved; the content and so
 *   the payload stay the same.
 *   Browser B (another engine, a clean profile): signs in to the same account, opens the code from My QR codes, sees the
 *   saved design, downloads PNG and SVG again: no new Checkout Session, order or charge.
 *   Files: ZXing decodes every file to the original payload; each file is compared with the server's own renderer run
 *   on the layout as saved (scripts/qa/inspect-export.ts: SVG byte-identical, PNG pixel-identical), and the revised
 *   files carry the new colour and caption while the baseline files don't. Another account can't reach the paid files.
 *
 * Google: the real consent redirect is checked (client_id, redirect_uri, state, scopes) and stopped there; completing
 * Google sign-in needs a person, so the account Google would return is written as Better Auth writes it and the browser
 * continues to the app's callbackURL ("fixture"). Stripe is genuine test mode (Checkout, card, signed webhooks).
 *
 * Env: BASE, QA_DATABASE_URL (the target's database: fixture sign-in rows and counts), BETTER_AUTH_SECRET,
 * GOOGLE_CLIENT_ID, STRIPE_SECRET_KEY (sk_test_ only), M (output folder), PLAYWRIGHT_CORE. Refuses a target whose
 * /api/health reports production. With a local app, a Stripe CLI listener must forward webhooks. Report:
 * docs/qa/HEY-184-cross-browser-download.md.
 */
const { chromium, firefox, webkit } = await import(process.env.PLAYWRIGHT_CORE ?? "playwright-core");
import fs from "node:fs";
import { execFileSync } from "node:child_process";
import { createHmac, randomBytes } from "node:crypto";

const [engineA, engineB, vwArg, tagArg] = process.argv.slice(2);
const VW = Number(vwArg);
const VH = VW === 390 ? 844 : VW === 834 ? 1112 : 900;
const BASE = (process.env.BASE ?? "").replace(/\/$/, "");
const DBURL = process.env.QA_DATABASE_URL ?? "";
const SECRET = process.env.BETTER_AUTH_SECRET ?? "";
const STRIPE_KEY = process.env.STRIPE_SECRET_KEY ?? "";
if (!BASE || !DBURL || !SECRET) throw new Error("BASE, QA_DATABASE_URL and BETTER_AUTH_SECRET are required");
if (!STRIPE_KEY.startsWith("sk_test_")) throw new Error("STRIPE_SECRET_KEY must be a test-mode key");
if (!engineA || !engineB || engineA === engineB) throw new Error("two different engines: <engineA> <engineB>");
const health = await (await fetch(`${BASE}/api/health`)).json();
if (health.environment !== "dev" || health.database?.target === "production")
  throw new Error(`refusing to run against ${BASE}: it reports ${health.environment} / ${health.database?.target}`);
const host = new URL(BASE).hostname;
const COOKIE = `${BASE.startsWith("https://") ? "__Secure-" : ""}better-auth.session_token`;

const tag = tagArg ?? `xb-${engineA}-${engineB}-${VW}-${randomBytes(3).toString("hex")}`;
const OUT = `${process.env.M}/runs/${tag}`;
fs.mkdirSync(OUT, { recursive: true });
const sql = (q) => execFileSync("psql", [DBURL, "-Atc", q], { encoding: "utf8" }).trim();
const stripe = (...args) => JSON.parse(execFileSync("stripe", [...args, "--api-key", STRIPE_KEY], { encoding: "utf8" }));
const browsers = { A: await { chromium, firefox, webkit }[engineA].launch(), B: await { chromium, firefox, webkit }[engineB].launch() };
const rows = [];
const evidence = {
  tag,
  base: BASE,
  viewport: VW,
  browserA: `${engineA} ${browsers.A.version()}`,
  browserB: `${engineB} ${browsers.B.version()}`,
  health,
};
const startedAt = Math.floor(Date.now() / 1000) - 5;
let n = 0;
const shot = async (p, name) => {
  const f = `${OUT}/${String(++n).padStart(2, "0")}-${name}.png`;
  await p.screenshot({ path: f, fullPage: true }).catch(() => {});
  return f.slice(f.lastIndexOf("/") + 1);
};
async function check(name, kind, p, fn) {
  const t0 = Date.now();
  try {
    rows.push({ name, kind, result: "PASS", note: (await fn()) ?? "", ms: Date.now() - t0 });
  } catch (e) {
    const f = p ? await shot(p, "FAIL") : "";
    rows.push({
      name,
      kind,
      result: "FAIL",
      note: String(e?.message ?? e)
        .split("\n")[0]
        .slice(0, 400),
      evidence: f,
      ms: Date.now() - t0,
    });
    throw e;
  }
}
const ok = (v, msg) => {
  if (!v) throw new Error(msg);
};
const findKey = (o, key) => {
  if (!o || typeof o !== "object") return undefined;
  if (key in o) return o[key];
  for (const v of Object.values(o)) {
    const r = findKey(v, key);
    if (r !== undefined) return r;
  }
  return undefined;
};
const cookieFor = (token) => encodeURIComponent(`${token}.${createHmac("sha256", SECRET).update(token).digest("base64")}`);
function newSession(userId) {
  const token = `tok_${userId}_${randomBytes(6).toString("hex")}`;
  sql(
    `insert into session(id,expires_at,token,user_id,created_at,updated_at) values('s-${token}',now()+interval '1 day','${token}','${userId}',now(),now())`,
  );
  return cookieFor(token);
}
function googleAccount(label) {
  const id = `qa184-${label}-${tag}`;
  sql(
    `insert into "user"(id,name,email,email_verified,created_at,updated_at) values('${id}','QA ${label}','${id}@example.test',true,now(),now());` +
      `insert into account(id,account_id,provider_id,user_id,scope,created_at,updated_at) values('acc-${id}','google-sub-${id}','google','${id}','openid email profile',now(),now())`,
  );
  return { id, cookie: newSession(id) };
}
async function context(which, cookie) {
  const ctx = await browsers[which].newContext({ viewport: { width: VW, height: VH }, acceptDownloads: true });
  if (cookie) await ctx.addCookies([{ name: COOKIE, value: cookie, domain: host, path: "/", secure: BASE.startsWith("https://") }]);
  ctx.setDefaultTimeout(30000);
  return ctx;
}

const input = `qa184-${tag}.example/menu?src=print`;
const PAYLOAD = `https://${input}`;
const NAME = `HEY-184 ${tag}`;
const CAPTION = `Scan ${tag.slice(-6)}`;

/** Continue with Google: the real consent redirect is checked, then Google's return is a fixture (same account each time). */
async function googleSignIn(p, ctx, accountOf) {
  let body = null;
  p.on("request", (r) => {
    if (r.url().includes("/api/auth/sign-in/social")) body = JSON.parse(r.postData() ?? "{}");
  });
  await ctx.route("https://accounts.google.com/**", (r) =>
    r.fulfill({ status: 200, contentType: "text/html", body: "<title>QA stop</title>" }),
  );
  await p.getByRole("button", { name: "Continue with Google" }).first().click();
  await p.waitForURL(/accounts\.google\.com/, { timeout: 30000 });
  const q = Object.fromEntries(new URL(p.url()).searchParams);
  ok(q.client_id === process.env.GOOGLE_CLIENT_ID, "client_id is not the configured Google client");
  ok(q.redirect_uri === `${BASE}/api/auth/callback/google`, `redirect_uri ${q.redirect_uri}`);
  ok(q.response_type === "code" && (q.state ?? "").length >= 16, "no code flow / state");
  ok(
    ["openid", "email", "profile"].every((s) => (q.scope ?? "").split(" ").includes(s)),
    `scope ${q.scope}`,
  );
  ok(body?.provider === "google" && typeof body.callbackURL === "string", "sign-in request without callbackURL");
  await ctx.unroute("https://accounts.google.com/**");
  const user = accountOf();
  await ctx.addCookies([{ name: COOKIE, value: user.cookie, domain: host, path: "/", secure: BASE.startsWith("https://") }]);
  await p.goto(BASE + body.callbackURL, { waitUntil: "load" });
  return { user, google: { redirect_uri: q.redirect_uri, scope: q.scope, state_len: q.state.length, callbackURL: body.callbackURL } };
}

async function stripeFill(p) {
  await p.waitForURL(/checkout\.stripe\.com/, { timeout: 45000 });
  const f = p.frameLocator('iframe[src*="elements-inner"]').first();
  const num = f.locator("#payment-numberInput");
  await num.waitFor({ timeout: 45000 });
  await num.fill("4242 4242 4242 4242");
  await f.locator("#payment-expiryInput").fill("12 / 34");
  await f.locator("#payment-cvcInput").fill("123");
  await f.locator("#payment-nameInput").fill("QA HEY-184");
  const country = f.locator("#payment-countryInput");
  if (await country.count()) await country.selectOption("US").catch(() => {});
  const line1 = f.getByRole("combobox", { name: "Address line 1" });
  if (await line1.count()) {
    await line1.fill("21 Pier St");
    await line1.press("Escape").catch(() => {});
    await f.getByRole("textbox", { name: "City" }).fill("San Francisco");
    await f.getByRole("combobox", { name: "State" }).selectOption("CA");
  }
  const zip = f.getByRole("textbox", { name: /^(ZIP|Postal)/ });
  if (await zip.count()) await zip.fill("94110").catch(() => {});
  const pay = p.getByRole("button", { name: /^(Pay|Zapłać)/ }).last();
  if (await pay.count()) await pay.click();
  else await f.getByRole("button", { name: /^Pay/ }).last().click();
}

const purchases = (userId) =>
  JSON.parse(
    sql(
      `select coalesce(json_agg(json_build_object('id',id,'status',status,'session',stripe_checkout_session_id,'amount',amount_total) order by created_at),'[]') from purchase where user_id='${userId}'`,
    ),
  );
/** The entitlement the purchase granted: its ledger rows and allowance uses, which a re-download must not add to. */
const grants = (userId) =>
  JSON.parse(
    sql(
      `select json_build_object('ledger',(select count(*) from credit_ledger where user_id='${userId}'),'allowanceUses',(select count(*) from allowance_use where user_id='${userId}'),'paidForCode',(select count(*) from purchase where user_id='${userId}' and status='paid'))`,
    ),
  );
function stripeFor(userId) {
  const sessions = stripe("checkout", "sessions", "list", "--limit", "50", "-d", `created[gte]=${startedAt}`).data.filter(
    (s) => s.metadata?.userId === userId,
  );
  const intents = stripe("payment_intents", "list", "--limit", "50", "-d", `created[gte]=${startedAt}`).data.filter(
    (x) => x.metadata?.userId === userId,
  );
  return {
    sessions: sessions.map((s) => ({ id: s.id, status: s.status, livemode: s.livemode })),
    charges: intents.filter((x) => x.status === "succeeded").map((x) => ({ id: x.id, amount: x.amount_received, livemode: x.livemode })),
  };
}
const counts = (userId) => {
  const st = stripeFor(userId);
  return {
    orders: purchases(userId).length,
    paid: purchases(userId).filter((x) => x.status === "paid").length,
    sessions: st.sessions.length,
    charges: st.charges.length,
    ...grants(userId),
  };
};

function inspect(file, layout, extra = []) {
  const out = execFileSync(
    "pnpm",
    ["-s", "exec", "tsx", "--conditions=react-server", "scripts/qa/inspect-export.ts", file, layout, ...extra],
    {
      encoding: "utf8",
      env: { ...process.env, QA_DATABASE_URL: DBURL },
    },
  );
  return JSON.parse(out.trim().split("\n").pop());
}

/** On the export screen of a paid code: pick the format, prepare if needed, download, save. */
async function downloadAs(p, format, name) {
  await p
    .getByRole("button", { name: new RegExp(`^${format.toUpperCase()}\\b`) })
    .first()
    .click();
  const ctl = p
    .getByRole("link", { name: /^Download/ })
    .or(p.getByRole("button", { name: /^Download/ }))
    .first();
  await ctl.waitFor({ timeout: 60000 });
  if ((await ctl.evaluate((el) => el.tagName)) === "BUTTON") await ctl.click();
  const link = p.getByRole("link", { name: /^Download/ }).first();
  await link.waitFor({ timeout: 60000 });
  const [dl] = await Promise.all([p.waitForEvent("download", { timeout: 60000 }), link.click()]);
  const file = `${OUT}/${name}`;
  await dl.saveAs(file);
  const head = fs.readFileSync(file).subarray(0, 8).toString("hex");
  ok(
    format === "png" ? head === "89504e470d0a1a0a" : fs.readFileSync(file, "utf8").trimStart().startsWith("<svg"),
    `${name} is not a ${format}`,
  );
  return { file, suggested: dl.suggestedFilename(), bytes: fs.statSync(file).size };
}

let failed = false;
try {
  await run();
} catch {
  failed = true;
}
for (const b of Object.values(browsers)) await b.close();
fs.writeFileSync(`${OUT}/results.json`, JSON.stringify({ ...evidence, rows }, null, 2));
for (const r of rows) console.log(`${r.result.padEnd(4)} [${r.kind}] ${tag} ${r.name}${r.note ? ` — ${r.note}` : ""}`);
process.exitCode = failed ? 1 : 0;

async function run() {
  const ctxA = await context("A", null);
  const a = await ctxA.newPage();
  let user, qr, layout, oldFg, newFg;
  await check(`A (${evidence.browserA}): guest creates a Static Website QR (Dots, Forest) and opens Export`, "browser", a, async () => {
    ok(
      (await ctxA.cookies()).every((c) => !c.name.endsWith("better-auth.session_token")),
      "not signed out",
    );
    await a.goto(`${BASE}/create`, { waitUntil: "networkidle" });
    await a.getByRole("button", { name: "Continue", exact: true }).click();
    await a.getByRole("textbox", { name: "Website address" }).fill(input);
    await a.getByRole("textbox", { name: /Name in My QR codes/ }).fill(NAME);
    await a.getByRole("button", { name: "Continue to design" }).click();
    await a
      .getByRole("button", { name: /^Custom design/ })
      .first()
      .click();
    await a.getByRole("tab", { name: "Pattern" }).click();
    await a
      .getByRole("group", { name: /^Modules/ })
      .getByRole("button", { name: "Dots", exact: true })
      .click();
    await a.getByRole("tab", { name: "Colors" }).click();
    await a.getByRole("group", { name: "Swatches" }).first().getByRole("button", { name: "Forest" }).click();
    await a.getByRole("status").filter({ hasText: "Scan verified" }).first().waitFor({ timeout: 20000 });
    await a.getByRole("button", { name: "Export", exact: true }).first().click();
    await a.waitForURL(/\/create\/export/);
    await a.getByRole("button", { name: "Continue with Google" }).first().waitFor();
    ok(sql(`select count(*) from qr_code where name='${NAME}'`) === "0", "a code was saved before sign-in");
    await shot(a, "A-guest-export");
  });
  await check(
    "A: Continue with Google reaches Google's consent with the app's client, callback and state",
    "genuine-redirect",
    a,
    async () => {
      const r = await googleSignIn(a, ctxA, () => googleAccount("owner"));
      user = r.user;
      evidence.googleA = r.google;
      return `redirect_uri=${r.google.redirect_uri}`;
    },
  );
  await check("A: returning signed in (fixture) — the draft became this account's code with its design", "fixture", a, async () => {
    await a.waitForURL(/\/create\/export\?.*qr=/, { timeout: 30000 });
    const u = new URL(a.url());
    qr = u.searchParams.get("qr");
    layout = u.searchParams.get("layout");
    const design = JSON.parse(sql(`select design from qr_layout where id='${layout}' and qr_code_id='${qr}'`));
    oldFg = findKey(design.layout, "fg").toLowerCase();
    ok(findKey(design.layout, "pattern") === "dot", "pattern lost");
    ok(sql(`select count(*) from qr_code where user_id='${user.id}'`) === "1", "not exactly one code");
    evidence.code = { qr, layout, baselineFg: oldFg };
    return `qr=${qr}, fg ${oldFg}`;
  });
  await check("A: Stripe test Checkout 4242; the verified webhook unlocks the code (one paid order)", "stripe-test", a, async () => {
    await a.getByRole("button", { name: /^Pay \$4\.99/ }).click();
    await stripeFill(a);
    await a.waitForURL(/checkout=success/, { timeout: 90000 });
    await a
      .getByRole("link", { name: /^Download/ })
      .or(a.getByRole("button", { name: /^Download/ }))
      .first()
      .waitFor({ timeout: 90000 });
    const c = counts(user.id);
    ok(c.paid === 1 && c.sessions === 1 && c.charges === 1, `after payment ${JSON.stringify(c)}`);
    evidence.afterPayment = { ...c, stripe: stripeFor(user.id), grants: grants(user.id) };
    return JSON.stringify(c);
  });
  await check("A: baseline PNG and SVG downloaded; both decode to the payload and match the saved design", "stripe-test", a, async () => {
    const png = await downloadAs(a, "png", "A-baseline.png");
    const svg = await downloadAs(a, "svg", "A-baseline.svg");
    const scale = new URL(a.url()).searchParams.get("res") ?? "2";
    const ip = inspect(png.file, layout, [`--scale=${scale}`, `--colors=${oldFg}`]);
    const is = inspect(svg.file, layout);
    ok(ip.payload === PAYLOAD && is.payload === PAYLOAD, `decoded ${ip.payload} / ${is.payload}`);
    ok(is.reference.identical, "baseline SVG differs from the saved design's render");
    ok(ip.reference.sameSize && ip.reference.differingPixelShare === 0, `baseline PNG vs saved design ${JSON.stringify(ip.reference)}`);
    ok(is.fills.includes(oldFg) && ip.pixels[oldFg] > 0.05, `baseline colour ${oldFg} missing`);
    evidence.baseline = { png: { ...png, inspect: ip }, svg: { ...svg, inspect: { ...is, fills: is.fills } } };
    await shot(a, "A-baseline-downloaded");
    return `PNG ${ip.reference.width}×${ip.reference.height}, ${(ip.pixels[oldFg] * 100).toFixed(1)}% ${oldFg}; SVG identical to the saved render; both → ${PAYLOAD}`;
  });
  await check(
    "A: Edit design on the purchased code — new foreground colour and a caption, saved; content unchanged",
    "browser",
    a,
    async () => {
      const contentBefore = sql(`select content::text from qr_code where id='${qr}'`);
      const revBefore = sql(`select updated_at from qr_layout where id='${layout}'`);
      await a.goto(`${BASE}/edit/${qr}?layout=${layout}`, { waitUntil: "networkidle" });
      await a.getByRole("tab", { name: "Colors" }).click();
      await a.getByRole("group", { name: "Swatches" }).first().getByRole("button", { name: "Ocean" }).click();
      await a.getByRole("tab", { name: "Caption" }).click();
      // "QR only" has no caption: the Caption group offers "Use QR + caption" (design 1.16).
      const use = a.getByRole("button", { name: "Use QR + caption" });
      if (await use.count()) await use.click();
      const caption = a.getByRole("textbox", { name: "Caption text" });
      await caption.fill(CAPTION);
      await a.getByRole("status").filter({ hasText: "Scan verified" }).first().waitFor({ timeout: 20000 });
      await shot(a, "A-edit-before-save");
      await a.getByRole("button", { name: "Save changes" }).first().click();
      await a.getByText("Design saved").first().waitFor({ timeout: 20000 });
      const design = JSON.parse(sql(`select design from qr_layout where id='${layout}'`));
      newFg = findKey(design.layout, "fg").toLowerCase();
      ok(newFg !== oldFg, `foreground unchanged (${newFg})`);
      ok(design.layout.caption?.text === CAPTION, `caption not saved: ${JSON.stringify(design.layout.caption)}`);
      ok(sql(`select content::text from qr_code where id='${qr}'`) === contentBefore, "content changed");
      ok(sql(`select updated_at from qr_layout where id='${layout}'`) !== revBefore, "no new layout revision");
      evidence.saved = { fg: newFg, caption: CAPTION, preset: design.layout.preset, revisionBefore: revBefore };
      await shot(a, "A-edit-saved");
      return `fg ${oldFg} → ${newFg}, caption "${CAPTION}", preset ${design.layout.preset}`;
    },
  );
  await ctxA.close();

  const before = counts(user.id);
  const ctxB = await context("B", null);
  const b = await ctxB.newPage();
  await check(
    `B (${evidence.browserB}, clean profile): signs in to the same account through Continue with Google`,
    "fixture",
    b,
    async () => {
      ok((await ctxB.cookies()).length === 0, "profile not clean");
      await b.goto(`${BASE}/dashboard`, { waitUntil: "networkidle" });
      await b.waitForURL(/sign-in/);
      const r = await googleSignIn(b, ctxB, () => ({ id: user.id, cookie: newSession(user.id) }));
      evidence.googleB = r.google;
      await b.waitForURL(/\/dashboard/, { timeout: 30000 });
      return `redirect genuine (${r.google.redirect_uri}); return as the same account (fixture)`;
    },
  );
  await check("B: My QR codes → the code; the saved design (new colour, caption) is what it shows", "browser", b, async () => {
    await b
      .getByRole("link", { name: new RegExp(NAME) })
      .first()
      .click();
    await b.waitForURL(new RegExp(`/dashboard/qr/${qr}`));
    await b.getByRole("heading", { level: 1, name: NAME }).waitFor();
    await b.locator("svg").first().waitFor();
    const html = (await b.content()).toLowerCase();
    ok(html.includes(newFg), `the code page doesn't render ${newFg}`);
    ok(html.includes(CAPTION.toLowerCase()), "the code page doesn't show the caption");
    await shot(b, "B-code-page");
    return `page renders ${newFg} and "${CAPTION}"`;
  });
  await check(
    "B: downloads PNG and SVG again — the saved design, the same payload, no new Checkout, order or charge",
    "stripe-test",
    b,
    async () => {
      await b
        .getByRole("link", { name: /^Download PNG of / })
        .first()
        .click();
      await b.waitForURL(/\/create\/export\?/);
      ok((await b.getByRole("button", { name: /^Pay / }).count()) === 0, "Pay offered in browser B");
      const png = await downloadAs(b, "png", "B-revised.png");
      const svg = await downloadAs(b, "svg", "B-revised.svg");
      const scale = new URL(b.url()).searchParams.get("res") ?? "2";
      const ip = inspect(png.file, layout, [`--scale=${scale}`, `--colors=${newFg},${oldFg}`]);
      const is = inspect(svg.file, layout);
      ok(ip.payload === PAYLOAD && is.payload === PAYLOAD, `decoded ${ip.payload} / ${is.payload}`);
      ok(is.reference.identical, "revised SVG differs from the saved design's render (stale file?)");
      ok(ip.reference.sameSize && ip.reference.differingPixelShare === 0, `revised PNG vs saved design ${JSON.stringify(ip.reference)}`);
      ok(is.fills.includes(newFg) && !is.fills.includes(oldFg), `SVG fills ${is.fills.join(",")}`);
      ok(
        is.texts.some((t) => t.includes(CAPTION)),
        `SVG caption texts ${JSON.stringify(is.texts)}`,
      );
      ok(ip.pixels[newFg] > 0.05 && ip.pixels[oldFg] === 0, `PNG colours ${JSON.stringify(ip.pixels)}`);
      const base = evidence.baseline;
      ok(
        base.svg.inspect.texts.every((t) => !t.includes(CAPTION)),
        "the baseline already had the caption",
      );
      ok(
        ip.reference.height !== base.png.inspect.reference.height ||
          ip.reference.width !== base.png.inspect.reference.width ||
          ip.pixels[newFg] !== base.png.inspect.pixels[newFg],
        "revised PNG renders like the baseline",
      );
      const after = counts(user.id);
      ok(
        JSON.stringify(after) === JSON.stringify(before) && after.paid === 1 && after.charges === 1,
        `before ${JSON.stringify(before)} after ${JSON.stringify(after)}`,
      );
      evidence.revised = { png: { ...png, inspect: ip }, svg: { ...svg, inspect: is }, before, after, grants: grants(user.id) };
      await shot(b, "B-revised-downloaded");
      return `PNG ${ip.reference.width}×${ip.reference.height} (baseline ${base.png.inspect.reference.width}×${base.png.inspect.reference.height}), ${(ip.pixels[newFg] * 100).toFixed(1)}% ${newFg}, 0% ${oldFg}; SVG identical to the saved render, caption "${CAPTION}"; both → ${PAYLOAD}; orders/paid/sessions/charges ${after.orders}/${after.paid}/${after.sessions}/${after.charges}`;
    },
  );
  await check(
    "Another account can't reach the paid code or its files (export page, file API, prepare, all files, code page)",
    "browser",
    b,
    async () => {
      const other = googleAccount("other");
      const c2 = await context("B", other.cookie);
      const p2 = await c2.newPage();
      const st = async (path) => (await c2.request.get(BASE + path, { maxRedirects: 0 })).status();
      const statuses = {
        png: await st(`/api/export/${layout}?format=png&qr=${qr}`),
        svg: await st(`/api/export/${layout}?format=svg&qr=${qr}`),
        prepare: await st(`/api/export/${layout}?format=png&qr=${qr}&prepare=1`),
        all: await st(`/api/export/all/${qr}`),
      };
      await p2.goto(`${BASE}/create/export?qr=${qr}&layout=${layout}`, { waitUntil: "networkidle" });
      const exportLeak = (await p2.content()).includes(input);
      await p2.goto(`${BASE}/dashboard/qr/${qr}`, { waitUntil: "networkidle" });
      const pageLeak = (await p2.content()).includes(input);
      await c2.close();
      const anonCtx = await context("B", null);
      const anon = (await anonCtx.request.get(`${BASE}/api/export/${layout}?format=png&qr=${qr}`, { maxRedirects: 0 })).status();
      await anonCtx.close();
      evidence.crossAccount = { ...statuses, exportLeak, pageLeak, signedOut: anon };
      ok(
        Object.values(statuses).every((s) => s === 404),
        `file routes ${JSON.stringify(statuses)}`,
      );
      ok(!exportLeak && !pageLeak, "the other account sees the code's content");
      ok(anon === 401, `signed out ${anon}`);
      return JSON.stringify(evidence.crossAccount);
    },
  );
  await ctxB.close();
}
