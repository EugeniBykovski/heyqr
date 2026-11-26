/*
 * HEY-183: a Dynamic Website QR from the homepage to a destination change, in a real browser against a running HeyQR in
 * test configuration (local or a deployed Preview). One run per fresh account; each starts signed out.
 *
 *   node scripts/qa/dynamic-journey.mjs <chromium|firefox|webkit> <390|834|1440> <starter|trial> [tag]
 *
 *   starter  homepage → Website · Dynamic with destination A → Design → Export → Continue with Google (draft, design and
 *            export intent kept) → Subscribe (Stripe test Checkout, 4242) → the subscription webhook activates the code
 *   trial    the same up to Export, then the 7-day trial (no card) from Trial & usage → "Use your free trial"
 *   then both: download the file and decode it (ZXing) → the permanent short link; a signed-out visitor is sent to A;
 *   Change destination to B on QR details, reload; the ORIGINAL file decodes to the same short link, which now sends
 *   people to B (no new code, short code, order or Checkout; repeated requests never serve A; Cache-Control no-store);
 *   an invalid destination (form and API) keeps B; another account can't read or change it (page, API v1).
 *
 * Google: the real consent redirect is checked (client_id, redirect_uri = BASE's callback, state, scopes) and stopped
 * there; completing Google sign-in needs a person, so the account Google would create is written as Better Auth writes
 * it (user + account(google) + session) and the browser continues to the same callbackURL ("fixture" in the results).
 * Stripe is genuine test mode. API keys for the API checks are written the way keys.ts stores them (fixture).
 *
 * Needs: BASE (the app; refused when /api/health reports production), QA_DATABASE_URL (that deployment's own database:
 * the local one, or the Preview's Neon branch), BETTER_AUTH_SECRET (the deployment's), GOOGLE_CLIENT_ID,
 * STRIPE_SECRET_KEY (sk_test_ only), M (output folder), PLAYWRIGHT_CORE (optional). Locally, STRIPE_LISTEN_CMD (the
 * Stripe CLI forwarding to BASE) lets the starter run hold the webhook back to see "Confirming your payment…"; a
 * deployed Preview gets Stripe's own webhook. Report: docs/qa/HEY-183-dynamic-journey.md.
 */
const { chromium, firefox, webkit } = await import(process.env.PLAYWRIGHT_CORE ?? "playwright-core");
import fs from "node:fs";
import { execFileSync, spawn } from "node:child_process";
import { createHash, createHmac, randomBytes } from "node:crypto";

const [engineName, vwArg, scenario, tagArg] = process.argv.slice(2);
const VW = Number(vwArg);
const VH = VW === 390 ? 844 : VW === 834 ? 1112 : 900;
const BASE = (process.env.BASE ?? "").replace(/\/$/, "");
const DBURL = process.env.QA_DATABASE_URL ?? "";
const SECRET = process.env.BETTER_AUTH_SECRET ?? "";
const STRIPE_KEY = process.env.STRIPE_SECRET_KEY ?? "";
if (!BASE || !DBURL || !SECRET) throw new Error("BASE, QA_DATABASE_URL and BETTER_AUTH_SECRET are required");
if (!STRIPE_KEY.startsWith("sk_test_")) throw new Error("STRIPE_SECRET_KEY must be a test-mode key");
if (!["starter", "trial"].includes(scenario)) throw new Error(`unknown scenario ${scenario}`);
const health = await (await fetch(`${BASE}/api/health`)).json();
if (health.environment !== "dev" || health.database?.target === "production")
  throw new Error(`refusing to run against ${BASE}: it reports ${health.environment} / ${health.database?.target}`);
const host = new URL(BASE).hostname;
const secure = BASE.startsWith("https://");
// Better Auth prefixes its cookies with __Secure- on https origins.
const COOKIE = `${secure ? "__Secure-" : ""}better-auth.session_token`;

const tag = tagArg ?? `${scenario}-${engineName}-${VW}-${randomBytes(3).toString("hex")}`;
const OUT = `${process.env.M}/runs/${tag}`;
fs.mkdirSync(OUT, { recursive: true });
const sql = (q) => execFileSync("psql", [DBURL, "-Atc", q], { encoding: "utf8" }).trim();
const stripe = (...args) => JSON.parse(execFileSync("stripe", [...args, "--api-key", STRIPE_KEY], { encoding: "utf8" }));
const browser = await { chromium, firefox, webkit }[engineName].launch();
const rows = [];
const evidence = { tag, base: BASE, engine: engineName, version: browser.version(), viewport: VW, scenario, health };
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
        .slice(0, 300),
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

/*
 * Destinations A and B: IANA's example.com (reachable from any test machine and any Preview), told apart by a query
 * unique to this run. Browsers don't let a test intercept a redirect's target, so the visit must reach a real site.
 */
const destA = `https://example.com/?heyqr=${tag}-A`;
const destB = `https://example.com/?heyqr=${tag}-B`;
const name = `HEY-183 ${tag}`;

const cookieFor = (token) => encodeURIComponent(`${token}.${createHmac("sha256", SECRET).update(token).digest("base64")}`);
function googleAccount(label) {
  const id = `qa183-${label}-${tag}`;
  const token = `tok_${id}_${randomBytes(6).toString("hex")}`;
  sql(
    `insert into "user"(id,name,email,email_verified,created_at,updated_at) values('${id}','QA ${label}','${id}@example.test',true,now(),now());` +
      `insert into account(id,account_id,provider_id,user_id,scope,created_at,updated_at) values('acc-${id}','google-sub-${id}','google','${id}','openid email profile',now(),now());` +
      `insert into session(id,expires_at,token,user_id,created_at,updated_at) values('s-${token}',now()+interval '1 day','${token}','${id}',now(),now())`,
  );
  return { id, cookie: cookieFor(token) };
}
/** An API key for `userId`, stored as keys.ts stores one (sha256 of the secret); the key itself stays in memory. */
function apiKeyFor(userId) {
  let lookupId = "";
  while (lookupId.length < 12)
    lookupId = randomBytes(12)
      .toString("base64")
      .replace(/[^A-Za-z0-9]/g, "")
      .slice(0, 12);
  const secretPart = randomBytes(32).toString("base64url");
  const hash = `sha256:${createHash("sha256").update(secretPart, "utf8").digest("hex")}`;
  sql(`insert into api_key(id,user_id,lookup_id,secret_hash) values('k-${lookupId}','${userId}','${lookupId}','${hash}')`);
  return `hqk_${lookupId}_${secretPart}`;
}
async function context(cookie) {
  const ctx = await browser.newContext({ viewport: { width: VW, height: VH }, acceptDownloads: true });
  if (cookie) await ctx.addCookies([{ name: COOKIE, value: cookie, domain: host, path: "/", secure }]);
  ctx.setDefaultTimeout(30000);
  return ctx;
}

/** Guest, from the homepage: Website A and Forest in the hero, More + → Type: Dynamic → Content → Design → Export 600 dpi. */
async function guestDesign(p) {
  await p.goto(`${BASE}/`, { waitUntil: "networkidle" });
  await p.getByRole("textbox", { name: "Website address" }).fill(destA.replace(/^https:\/\//, ""));
  await p.getByRole("group", { name: "Code color" }).getByRole("button", { name: "Forest" }).click();
  await shot(p, "home-quick-create");
  await p.getByRole("button", { name: "More +" }).click();
  await p.waitForURL(/\/create\?step=type/);
  await p.getByRole("button", { name: /^Yes, I may change it/ }).click();
  await p.getByText("Website · Dynamic").first().waitFor();
  await shot(p, "type-dynamic");
  await p.getByRole("button", { name: "Continue", exact: true }).click();
  await p.waitForURL(/step=content/);
  const typed = await p.getByRole("textbox", { name: "Website address" }).inputValue();
  ok(typed === destA, `homepage address not carried: ${typed}`);
  await p.getByRole("textbox", { name: /Name in My QR codes/ }).fill(name);
  await p.getByRole("button", { name: "Continue to design" }).click();
  await p.waitForURL(/step=design/);
  await p.getByRole("status").filter({ hasText: "Scan verified" }).first().waitFor({ timeout: 20000 });
  await shot(p, "guest-design");
  await p.getByRole("button", { name: "Export", exact: true }).first().click();
  await p.waitForURL(/\/create\/export/);
  await p.getByRole("group", { name: "PNG size" }).getByRole("button", { name: "600 dpi" }).click();
  await p.getByRole("button", { name: "Continue with Google" }).waitFor();
  await shot(p, "guest-export");
  return JSON.parse(await p.evaluate(() => localStorage.getItem("heyqr:draft:v1")));
}

async function googleSignIn(p, ctx, label) {
  let body = null;
  p.on("request", (r) => {
    if (r.url().includes("/api/auth/sign-in/social")) body = JSON.parse(r.postData() ?? "{}");
  });
  await ctx.route("https://accounts.google.com/**", (r) =>
    r.fulfill({ status: 200, contentType: "text/html", body: "<title>QA stop</title>QA: Google consent reached" }),
  );
  await p.getByRole("button", { name: "Continue with Google" }).click();
  await p.waitForURL(/accounts\.google\.com/, { timeout: 30000 });
  const g = new URL(p.url());
  const q = Object.fromEntries(g.searchParams);
  ok(q.client_id === process.env.GOOGLE_CLIENT_ID, "client_id is not the configured Google client");
  ok(q.redirect_uri === `${BASE}/api/auth/callback/google`, `redirect_uri ${q.redirect_uri}`);
  ok(q.response_type === "code" && (q.state ?? "").length >= 16, "no code flow / state");
  ok(
    ["openid", "email", "profile"].every((s) => (q.scope ?? "").split(" ").includes(s)),
    `scope ${q.scope}`,
  );
  ok(body?.provider === "google" && typeof body.callbackURL === "string", "sign-in request without callbackURL");
  evidence.google = {
    host: g.host,
    redirect_uri: q.redirect_uri,
    scope: q.scope,
    state_len: q.state.length,
    callbackURL: body.callbackURL,
  };
  await ctx.unroute("https://accounts.google.com/**");
  const user = googleAccount(label);
  await ctx.addCookies([{ name: COOKIE, value: user.cookie, domain: host, path: "/", secure }]);
  await p.goto(BASE + body.callbackURL, { waitUntil: "load" });
  return { ...user, callbackURL: body.callbackURL };
}

async function checkResume(p, user, draft) {
  await p.waitForURL(/\/create\/export\?.*qr=/, { timeout: 30000 });
  const u = new URL(p.url());
  const qr = u.searchParams.get("qr");
  const layout = u.searchParams.get("layout");
  ok(u.searchParams.get("format") === "png" && u.searchParams.get("res") === "600", `export intent lost: ${u.search}`);
  await p
    .getByRole("group", { name: "PNG size" })
    .getByRole("button", { name: "600 dpi" })
    .and(p.locator('[aria-pressed="true"]'))
    .waitFor();
  ok(sql(`select count(*) from qr_code where user_id='${user.id}'`) === "1", "not exactly one code saved for the new account");
  const row = JSON.parse(
    sql(
      `select json_build_object('model',model,'status',status,'short',short_code,'destination',destination,'name',name) from qr_code where id='${qr}' and user_id='${user.id}'`,
    ),
  );
  ok(row.model === "dynamic" && row.destination === destA && row.name === name, `saved ${JSON.stringify(row)}`);
  ok(row.short === null && row.status !== "active", `live before activation: ${JSON.stringify(row)}`);
  const design = JSON.parse(sql(`select design from qr_layout where id='${layout}' and qr_code_id='${qr}'`));
  const want = findKey(draft, "fg");
  const got = findKey(findKey(design, "colors") ?? {}, "fg");
  ok(want && got?.toLowerCase() === want.toLowerCase(), `design changed: draft ${want} saved ${got}`);
  evidence.saved = { qr, layout, row, draftFg: want, savedFg: got };
  fs.writeFileSync(`${OUT}/draft.json`, JSON.stringify(draft, null, 2));
  await shot(p, "signed-export-locked");
  return { qr, layout };
}

async function stripeFill(p, card) {
  await p.waitForURL(/checkout\.stripe\.com/, { timeout: 45000 });
  const f = p.frameLocator('iframe[src*="elements-inner"]').first();
  const num = f.locator("#payment-numberInput");
  await num.waitFor({ timeout: 45000 });
  await num.fill(card);
  await f.locator("#payment-expiryInput").fill("12 / 34");
  await f.locator("#payment-cvcInput").fill("123");
  await f.locator("#payment-nameInput").fill("QA HEY-183");
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
  const pay = p.getByRole("button", { name: /^(Pay|Subscribe|Start trial)/ }).last();
  if (await pay.count()) await pay.click();
  else
    await f
      .getByRole("button", { name: /^(Pay|Subscribe)/ })
      .last()
      .click();
}

/** What the account holds: codes, short codes, orders, subscriptions, and its Stripe Checkout Sessions and charges. */
function ledger(user) {
  const db = JSON.parse(
    sql(
      `select json_build_object('codes',(select count(*) from qr_code where user_id='${user.id}'),` +
        `'shortCodes',(select coalesce(json_agg(short_code),'[]') from qr_code where user_id='${user.id}' and short_code is not null),` +
        `'purchases',(select count(*) from purchase where user_id='${user.id}'),` +
        `'subscriptions',(select coalesce(json_agg(json_build_object('status',status,'plan',plan,'limit',active_code_limit,'stripe',stripe_subscription_id)),'[]') from subscription where user_id='${user.id}'),` +
        `'trial',(select json_build_object('started',trial_started_at,'ends',trial_ends_at) from "user" where id='${user.id}'),` +
        `'customer',(select stripe_customer_id from "user" where id='${user.id}'))`,
    ),
  );
  const sessions = stripe("checkout", "sessions", "list", "--limit", "50", "-d", `created[gte]=${startedAt}`).data.filter(
    (s) => s.metadata?.userId === user.id || (db.customer && s.customer === db.customer),
  );
  const charges = db.customer
    ? stripe("charges", "list", "--limit", "50", "-d", `customer=${db.customer}`).data.filter((c) => c.status === "succeeded")
    : [];
  return {
    ...db,
    stripe: {
      sessions: sessions.map((s) => ({ id: s.id, mode: s.mode, status: s.status, livemode: s.livemode })),
      charges: charges.map((c) => ({ id: c.id, amount: c.amount, currency: c.currency, livemode: c.livemode })),
    },
  };
}
const same = (a, b) =>
  a.codes === b.codes &&
  JSON.stringify(a.shortCodes) === JSON.stringify(b.shortCodes) &&
  a.purchases === b.purchases &&
  a.subscriptions.length === b.subscriptions.length &&
  a.stripe.sessions.length === b.stripe.sessions.length &&
  a.stripe.charges.length === b.stripe.charges.length;

async function decode(file) {
  const out = execFileSync("pnpm", ["-s", "exec", "tsx", "scripts/qa/decode-file.ts", file], { encoding: "utf8" }).trim().split("\n").pop();
  return JSON.parse(out).payload;
}
/** A signed-out request to the short link, without following it: status, Location and Cache-Control. */
async function hop(url) {
  const r = await fetch(url, { redirect: "manual", headers: { "user-agent": "Mozilla/5.0 (HEY-183 QA)" } });
  return { status: r.status, location: r.headers.get("location"), cacheControl: r.headers.get("cache-control") };
}
/** A signed-out visitor follows the short link in a browser (a new one, or `ctx`: one that has been there before). */
async function visit(url, ctx) {
  const own = !ctx;
  const c = ctx ?? (await context(null));
  const p = await c.newPage();
  await p.goto(url, { waitUntil: "load" });
  const landed = { url: p.url(), title: await p.title() };
  await p.close();
  if (own) await c.close();
  return landed;
}

let failed = false;
try {
  await journey();
} catch {
  failed = true;
}
if (process.env.STRIPE_LISTEN_CMD) {
  const up = (() => {
    try {
      execFileSync("pgrep", ["-f", "stripe listen"]);
      return true;
    } catch {
      return false;
    }
  })();
  if (!up) spawn("sh", ["-c", process.env.STRIPE_LISTEN_CMD], { detached: true, stdio: "ignore" }).unref();
}
await browser.close();
fs.writeFileSync(`${OUT}/results.json`, JSON.stringify({ ...evidence, rows }, null, 2));
for (const r of rows) console.log(`${r.result.padEnd(4)} [${r.kind}] ${tag} ${r.name}${r.note ? ` — ${r.note}` : ""}`);
process.exitCode = failed ? 1 : 0;

async function journey() {
  const ctx = await context(null);
  const p = await ctx.newPage();
  let draft, user, ids, short, original;
  // A signed-out visitor who scans before the change and again after it, in the same browser (its cache kept).
  const returning = await context(null);
  await check(
    "Guest from the homepage: Website A, Forest, Type → Dynamic, Content keeps A, Design, Export PNG 600 dpi",
    "browser",
    p,
    async () => {
      ok(
        (await ctx.cookies()).every((c) => !c.name.endsWith("better-auth.session_token")),
        "not signed out",
      );
      draft = await guestDesign(p);
      ok(draft.model === "dynamic", `draft model ${draft.model}`);
      ok(sql(`select count(*) from qr_code where name='${name}'`) === "0", "a code was saved before sign-in");
      return `draft model=${draft.model}, fg=${findKey(draft, "fg")}`;
    },
  );
  await check(
    "Google: Continue with Google reaches Google's consent with the app's client, callback and state",
    "genuine-redirect",
    p,
    async () => {
      user = await googleSignIn(p, ctx, scenario);
      return `redirect_uri=${evidence.google.redirect_uri}; callbackURL=${user.callbackURL}`;
    },
  );
  await check(
    "Google: returning signed in (fixture) — the Dynamic draft, Forest design and PNG 600 dpi intent kept; not live yet",
    "fixture",
    p,
    async () => {
      ids = await checkResume(p, user, draft);
      return `qr=${ids.qr}`;
    },
  );
  const { qr, layout } = ids;

  if (scenario === "starter")
    await check(
      "Activation: Subscribe (Stripe test Checkout 4242); the code goes live only from the verified webhook",
      "stripe-test",
      p,
      async () => {
        const hold = Boolean(process.env.STRIPE_LISTEN_CMD);
        if (hold) execFileSync("pkill", ["-f", "stripe listen"]);
        await p.getByRole("button", { name: /^Subscribe for \$9\.00/ }).click();
        await stripeFill(p, "4242 4242 4242 4242");
        await p.waitForURL((u) => u.host === new URL(BASE).host && /checkout=success/.test(u.search), { timeout: 90000 });
        if (hold) {
          await p
            .getByText(/Confirming your payment/)
            .first()
            .waitFor({ timeout: 20000 });
          ok(
            JSON.parse(sql(`select json_build_object('s',status,'c',short_code) from qr_code where id='${qr}'`)).c === null,
            "live before the webhook",
          );
          evidence.pendingShot = await shot(p, "confirming-payment");
          spawn("sh", ["-c", process.env.STRIPE_LISTEN_CMD], { detached: true, stdio: "ignore" }).unref();
          await new Promise((r) => setTimeout(r, 7000));
          const customer = sql(`select stripe_customer_id from "user" where id='${user.id}'`);
          const events = stripe("events", "list", "--limit", "40", "-d", `created[gte]=${startedAt}`)
            .data.filter((e) => e.type.startsWith("customer.subscription.") || e.type === "checkout.session.completed")
            .filter((e) => e.data.object.customer === customer);
          for (const e of events.reverse())
            execFileSync("stripe", ["events", "resend", e.id, "--api-key", STRIPE_KEY], { stdio: "ignore" });
          evidence.webhookEvents = events.map((e) => `${e.type} ${e.id}`);
        }
        await p
          .getByRole("link", { name: /^Download/ })
          .or(p.getByRole("button", { name: /^Download/ }))
          .first()
          .waitFor({ timeout: 90000 });
        const l = ledger(user);
        const sub = l.subscriptions[0];
        ok(
          l.subscriptions.length === 1 && ["active", "trialing"].includes(sub.status) && sub.stripe?.startsWith("sub_"),
          `subscription ${JSON.stringify(l.subscriptions)}`,
        );
        ok(
          l.stripe.sessions.length === 1 && l.stripe.sessions[0].mode === "subscription" && !l.stripe.sessions[0].livemode,
          `sessions ${JSON.stringify(l.stripe.sessions)}`,
        );
        ok(
          l.stripe.charges.length === 1 && l.stripe.charges[0].amount === 900 && !l.stripe.charges[0].livemode,
          `charges ${JSON.stringify(l.stripe.charges)}`,
        );
        evidence.activation = l;
        return `subscription ${sub.stripe} ${sub.status} (${sub.plan}, limit ${sub.limit}); charge ${l.stripe.charges[0].id} $9.00; ${evidence.webhookEvents?.length ?? 0} held events delivered`;
      },
    );
  else
    await check("Activation: 7-day trial (no card) from Trial & usage, then Use your free trial on Export", "browser", p, async () => {
      ok((await p.getByRole("button", { name: /^Use your free trial/ }).count()) === 0, "trial offered before it started");
      await p.goto(`${BASE}/dashboard/trial`, { waitUntil: "networkidle" });
      await shot(p, "trial-page");
      await p.getByRole("button", { name: "Start 7-day free trial" }).first().click();
      await p.waitForFunction(() => !document.body.innerText.includes("Start 7-day free trial"), null, { timeout: 30000 }).catch(() => {});
      ok(sql(`select trial_started_at is not null from "user" where id='${user.id}'`) === "t", "trial not started");
      await p.goto(`${BASE}/create/export?qr=${qr}&layout=${layout}&format=png&res=600`, { waitUntil: "networkidle" });
      await p.getByRole("button", { name: /^Use your free trial/ }).click();
      await p
        .getByRole("link", { name: /^Download/ })
        .or(p.getByRole("button", { name: /^Download/ }))
        .first()
        .waitFor({ timeout: 60000 });
      const l = ledger(user);
      ok(
        l.trial.started && l.subscriptions.length === 0 && l.stripe.sessions.length === 0 && l.purchases === 0,
        `trial ledger ${JSON.stringify(l)}`,
      );
      ok(sql(`select is_trial from qr_code where id='${qr}'`) === "t", "the code is not the trial's test code");
      evidence.activation = l;
      return `trial ${l.trial.started} → ${l.trial.ends}; no Checkout, order or charge`;
    });

  await check("Live: the server holds the entitlement, the code is active with a permanent short code", "browser", p, async () => {
    const row = JSON.parse(
      sql(
        `select json_build_object('status',status,'short',short_code,'destination',destination,'trial',is_trial) from qr_code where id='${qr}'`,
      ),
    );
    ok(row.status === "active" && /^[A-Za-z0-9_-]{4,}$/.test(row.short ?? "") && row.destination === destA, `code ${JSON.stringify(row)}`);
    evidence.live = row;
    return JSON.stringify(row);
  });
  await check(
    "Download: the PNG decodes (ZXing) to the permanent short link, which sends a signed-out visitor to A",
    "browser",
    p,
    async () => {
      const ctl = p
        .getByRole("link", { name: /^Download/ })
        .or(p.getByRole("button", { name: /^Download/ }))
        .first();
      if ((await ctl.evaluate((el) => el.tagName)) === "BUTTON") await ctl.click();
      const link = p.getByRole("link", { name: /^Download/ }).first();
      await link.waitFor({ timeout: 60000 });
      const [dl] = await Promise.all([p.waitForEvent("download", { timeout: 60000 }), link.click()]);
      original = `${OUT}/original.png`;
      await dl.saveAs(original);
      ok(fs.readFileSync(original).subarray(0, 8).toString("hex") === "89504e470d0a1a0a", "not a PNG");
      short = await decode(original);
      const code = sql(`select short_code from qr_code where id='${qr}'`);
      ok(new URL(short).pathname === `/r/${code}`, `decoded ${short} is not this code's short link (${code})`);
      const h = await hop(short);
      ok(h.status === 302 && h.location === destA && /no-store/.test(h.cacheControl ?? ""), `short link answered ${JSON.stringify(h)}`);
      const landed = await visit(short);
      ok(landed.url === destA, `visitor landed on ${JSON.stringify(landed)}`);
      const first = await visit(short, returning);
      ok(first.url === destA, `returning visitor's first scan landed on ${first.url}`);
      evidence.before = {
        short,
        decoded: short,
        hop: h,
        landed,
        bytes: fs.statSync(original).size,
        sha256: createHash("sha256").update(fs.readFileSync(original)).digest("hex"),
      };
      await shot(p, "downloaded");
      return `${short} → 302 ${h.location} (Cache-Control ${h.cacheControl})`;
    },
  );

  let before;
  await check("Change destination to B on QR details; it persists after a reload", "browser", p, async () => {
    before = ledger(user);
    await p.goto(`${BASE}/dashboard`, { waitUntil: "networkidle" });
    await p
      .getByRole("link", { name: new RegExp(name) })
      .first()
      .click();
    await p.waitForURL(new RegExp(`/dashboard/qr/${qr}`));
    await p.getByRole("button", { name: "Change destination" }).click();
    const field = p.getByRole("textbox", { name: "New destination" });
    await field.fill(destB);
    await p.getByRole("button", { name: "Save destination" }).click();
    await p.getByText("Saved", { exact: true }).first().waitFor({ timeout: 20000 });
    await p.reload({ waitUntil: "networkidle" });
    ok((await p.locator("main").innerText()).includes(destB.replace(/^https:\/\//, "")), "B not shown after reload");
    ok(sql(`select destination from qr_code where id='${qr}'`) === destB, "B not stored");
    await shot(p, "destination-b");
  });
  await check(
    "The ORIGINAL file still decodes to the same short link, which now sends people to B — no new code, short code, order or Checkout",
    "browser",
    p,
    async () => {
      const again = await decode(original);
      ok(again === short, `original decodes to ${again}`);
      const h = await hop(short);
      ok(h.status === 302 && h.location === destB && /no-store/.test(h.cacheControl ?? ""), `after the change ${JSON.stringify(h)}`);
      const landed = await visit(short);
      ok(landed.url === destB, `visitor landed on ${JSON.stringify(landed)}`);
      const again2 = await visit(short, returning);
      ok(again2.url === destB, `the browser that saw A before still lands on ${again2.url}`);
      await returning.close();
      // Stale redirects: repeated requests, with and without a browser cache, never serve A again.
      const repeats = [];
      for (let i = 0; i < 8; i++) repeats.push((await hop(short)).location);
      ok(
        repeats.every((l) => l === destB),
        `stale redirect: ${JSON.stringify(repeats)}`,
      );
      const after = ledger(user);
      ok(same(before, after), `ledger changed: before ${JSON.stringify(before)} after ${JSON.stringify(after)}`);
      evidence.after = { decoded: again, hop: h, landed, returningVisitor: again2, repeats, before, after };
      return `${short} → 302 ${h.location}; same browser as before → B; 8 repeats all B; codes ${after.codes}, short codes ${after.shortCodes.join(",")}, orders ${after.purchases}, sessions ${after.stripe.sessions.length}`;
    },
  );
  await check("An invalid destination (form and API v1) is refused and B stays in effect", "browser", p, async () => {
    await p.getByRole("button", { name: "Change destination" }).click();
    const field = p.getByRole("textbox", { name: "New destination" });
    await field.fill("not a website");
    await p.getByRole("button", { name: "Save destination" }).click();
    await p.locator('[aria-invalid="true"]').first().waitFor({ timeout: 10000 });
    const error = await p
      .locator('[id$="-error"], [role="alert"]')
      .first()
      .textContent()
      .catch(() => "");
    await shot(p, "invalid-destination");
    ok(sql(`select destination from qr_code where id='${qr}'`) === destB, "invalid input changed the destination");
    const key = apiKeyFor(user.id);
    const revision = Number(sql(`select destination_revision from qr_code where id='${qr}'`));
    const api = await fetch(`${BASE}/api/v1/qr-codes/${qr}/destination`, {
      method: "PATCH",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({ destination: "javascript:alert(1)", revision }),
    });
    ok(api.status === 422, `API accepted an invalid destination: ${api.status}`);
    const h = await hop(short);
    ok(h.location === destB, `after invalid input the link goes to ${h.location}`);
    evidence.invalid = { formError: error?.trim(), api: api.status, hop: h };
    return `form: "${error?.trim()}"; API 422; link still → B`;
  });
  await check("Another account can't see or change the destination (QR details page, API v1 GET and PATCH)", "browser", p, async () => {
    const other = googleAccount("other");
    const c2 = await context(other.cookie);
    const p2 = await c2.newPage();
    const page = await p2.goto(`${BASE}/dashboard/qr/${qr}`, { waitUntil: "networkidle" });
    const leaked = (await p2.content()).includes(`${tag}-B`);
    const key = apiKeyFor(other.id);
    const revision = Number(sql(`select destination_revision from qr_code where id='${qr}'`));
    const get = await fetch(`${BASE}/api/v1/qr-codes/${qr}/destination`, { headers: { authorization: `Bearer ${key}` } });
    const patch = await fetch(`${BASE}/api/v1/qr-codes/${qr}/destination`, {
      method: "PATCH",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({ destination: `https://example.com/?heyqr=${tag}-other`, revision }),
    });
    await shot(p2, "other-account");
    await c2.close();
    ok(!leaked, "the other account sees the destination");
    ok(get.status === 404 && patch.status === 404, `API GET ${get.status} PATCH ${patch.status}`);
    ok(
      sql(`select destination from qr_code where id='${qr}'`) === destB && (await hop(short)).location === destB,
      "destination changed by another account",
    );
    evidence.crossAccount = { page: page?.status(), leaked, apiGet: get.status, apiPatch: patch.status };
    return JSON.stringify(evidence.crossAccount);
  });
  await ctx.close();
}
