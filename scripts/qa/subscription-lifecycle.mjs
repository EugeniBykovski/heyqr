/*
 * HEY-185: a Starter subscription's cancellation and reactivation, in a real browser against a running HeyQR in test
 * configuration (local or a deployed Preview). One run per fresh account; each starts signed out.
 *
 *   node scripts/qa/subscription-lifecycle.mjs <chromium|firefox|webkit> <390|834|1440> <undo|keep|expire> [tag]
 *
 * Both: homepage → Website · Dynamic with destination A → Design → Export → Continue with Google → Subscribe (Stripe
 * test Checkout, 4242) → the code goes live → download, decode the file (ZXing) → the permanent short link; a
 * signed-out visitor is sent to A. Then Manage subscription → Stripe's Customer Portal → Cancel subscription (at period
 * end, the Portal's configuration): Plan & billing says "Cancels" and "Ends on <Stripe's period end>", the plan and the
 * short link stay.
 *   keep    as undo, but with Plan & billing's own "Keep my plan" (no Portal) instead of the Portal's Renew
 *   undo    the Portal's Renew: the same subscription continues (no new subscription, invoice or charge), the link
 *           still redirects; a stale or repeated delivery of the cancellation event changes nothing.
 *   expire  three more codes go live, then are paused (QR details), deleted (My QR codes) and taken down (operator,
 *           `pnpm moderation`). The account's Stripe Customer lives on a Stripe test clock, which is advanced past the
 *           period end: Stripe ends the subscription (customer.subscription.deleted), the stored status is canceled,
 *           Plan & billing shows no plan and the link shows the neutral "not active" page. Choose a plan → Subscribe
 *           again: a new subscription, the ORIGINAL file's short link redirects again (same short code); the paused,
 *           deleted and taken-down codes stay unavailable.
 *   then both: another account, and a signed-out visitor, can't reach the account's billing.
 *
 * Fixtures (reported as such): completing Google sign-in (rows written as Better Auth writes them, after the genuine
 * redirect to Google's consent); for `expire`, the account's Stripe Customer created on a test clock and bound the way
 * the app binds one (user.stripe_customer_id) before the first Checkout; the three extra codes are copies of the first
 * code's draft rows (then activated, paused and deleted through the product). Stripe is genuine test mode.
 *
 * Needs: BASE (refused when /api/health reports production), QA_DATABASE_URL (that deployment's database),
 * BETTER_AUTH_SECRET, GOOGLE_CLIENT_ID, STRIPE_SECRET_KEY (sk_test_ only), M (output folder), PLAYWRIGHT_CORE
 * (optional). Locally a Stripe CLI listener must forward to BASE; a deployed Preview gets Stripe's own webhook.
 * Report: docs/qa/HEY-185-subscription-lifecycle.md.
 */
const { chromium, firefox, webkit } = await import(process.env.PLAYWRIGHT_CORE ?? "playwright-core");
import fs from "node:fs";
import { execFileSync } from "node:child_process";
import { createHmac, randomBytes } from "node:crypto";

const [engineName, vwArg, scenario, tagArg] = process.argv.slice(2);
const VW = Number(vwArg);
const VH = VW === 390 ? 844 : VW === 834 ? 1112 : 900;
const BASE = (process.env.BASE ?? "").replace(/\/$/, "");
const DBURL = process.env.QA_DATABASE_URL ?? "";
const SECRET = process.env.BETTER_AUTH_SECRET ?? "";
const STRIPE_KEY = process.env.STRIPE_SECRET_KEY ?? "";
if (!BASE || !DBURL || !SECRET) throw new Error("BASE, QA_DATABASE_URL and BETTER_AUTH_SECRET are required");
if (!STRIPE_KEY.startsWith("sk_test_")) throw new Error("STRIPE_SECRET_KEY must be a test-mode key");
if (!["undo", "keep", "expire"].includes(scenario)) throw new Error(`unknown scenario ${scenario}`);
const health = await (await fetch(`${BASE}/api/health`)).json();
if (health.environment !== "dev" || health.database?.target === "production")
  throw new Error(`refusing to run against ${BASE}: it reports ${health.environment} / ${health.database?.target}`);
const host = new URL(BASE).hostname;
const secure = BASE.startsWith("https://");
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
const shot = async (p, label) => {
  const f = `${OUT}/${String(++n).padStart(2, "0")}-${label}.png`;
  await p.screenshot({ path: f, fullPage: true }).catch(() => {});
  return f.slice(f.lastIndexOf("/") + 1);
};
async function check(label, kind, p, fn) {
  const t0 = Date.now();
  try {
    rows.push({ name: label, kind, result: "PASS", note: (await fn()) ?? "", ms: Date.now() - t0 });
  } catch (e) {
    const f = p ? await shot(p, "FAIL") : "";
    rows.push({
      name: label,
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
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, msg, ms = 60000, every = 1500) {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error(msg);
    await wait(every);
  }
}
const findKey = (o, key) => {
  if (!o || typeof o !== "object") return undefined;
  if (key in o) return o[key];
  for (const v of Object.values(o)) {
    const r = findKey(v, key);
    if (r !== undefined) return r;
  }
  return undefined;
};

const destA = `https://example.com/?heyqr=${tag}-A`;
const name = `HEY-185 ${tag}`;

const cookieFor = (token) => encodeURIComponent(`${token}.${createHmac("sha256", SECRET).update(token).digest("base64")}`);
function googleAccount(label) {
  const id = `qa185-${label}-${tag}`;
  const token = `tok_${id}_${randomBytes(6).toString("hex")}`;
  sql(
    `insert into "user"(id,name,email,email_verified,created_at,updated_at) values('${id}','QA ${label}','${id}@example.test',true,now(),now());` +
      `insert into account(id,account_id,provider_id,user_id,scope,created_at,updated_at) values('acc-${id}','google-sub-${id}','google','${id}','openid email profile',now(),now());` +
      `insert into session(id,expires_at,token,user_id,created_at,updated_at) values('s-${token}',now()+interval '1 day','${token}','${id}',now(),now())`,
  );
  return { id, cookie: cookieFor(token) };
}
async function context(cookie) {
  const ctx = await browser.newContext({ viewport: { width: VW, height: VH }, acceptDownloads: true });
  if (cookie) await ctx.addCookies([{ name: COOKIE, value: cookie, domain: host, path: "/", secure }]);
  ctx.setDefaultTimeout(30000);
  return ctx;
}

/** Guest, from the homepage: Website A and Forest in the hero, More + → Type: Dynamic → Content → Design → Export. */
async function guestDesign(p) {
  await p.goto(`${BASE}/`, { waitUntil: "networkidle" });
  await p.getByRole("textbox", { name: "Website address" }).fill(destA.replace(/^https:\/\//, ""));
  await p.getByRole("group", { name: "Code color" }).getByRole("button", { name: "Forest" }).click();
  await p.getByRole("button", { name: "More +" }).click();
  await p.waitForURL(/\/create\?step=type/);
  await p.getByRole("button", { name: /^Yes, I may change it/ }).click();
  await p.getByText("Website · Dynamic").first().waitFor();
  await p.getByRole("button", { name: "Continue", exact: true }).click();
  await p.waitForURL(/step=content/);
  await p.getByRole("textbox", { name: /Name in My QR codes/ }).fill(name);
  await p.getByRole("button", { name: "Continue to design" }).click();
  await p.waitForURL(/step=design/);
  await p.getByRole("status").filter({ hasText: "Scan verified" }).first().waitFor({ timeout: 20000 });
  await p.getByRole("button", { name: "Export", exact: true }).first().click();
  await p.waitForURL(/\/create\/export/);
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
  const q = Object.fromEntries(new URL(p.url()).searchParams);
  ok(q.client_id === process.env.GOOGLE_CLIENT_ID, "client_id is not the configured Google client");
  ok(q.redirect_uri === `${BASE}/api/auth/callback/google`, `redirect_uri ${q.redirect_uri}`);
  ok(q.response_type === "code" && (q.state ?? "").length >= 16, "no code flow / state");
  ok(body?.provider === "google" && typeof body.callbackURL === "string", "sign-in request without callbackURL");
  evidence.google = { redirect_uri: q.redirect_uri, scope: q.scope, callbackURL: body.callbackURL };
  await ctx.unroute("https://accounts.google.com/**");
  const user = googleAccount(label);
  await ctx.addCookies([{ name: COOKIE, value: user.cookie, domain: host, path: "/", secure }]);
  await p.goto(BASE + body.callbackURL, { waitUntil: "load" });
  return user;
}

async function stripeFill(p, card) {
  await p.waitForURL(/checkout\.stripe\.com/, { timeout: 45000 });
  const f = p.frameLocator('iframe[src*="elements-inner"]').first();
  const num = f.locator("#payment-numberInput");
  await num.waitFor({ timeout: 45000 });
  await num.fill(card);
  await f.locator("#payment-expiryInput").fill("12 / 34");
  await f.locator("#payment-cvcInput").fill("123");
  await f.locator("#payment-nameInput").fill("QA HEY-185");
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

/** The account's subscriptions as stored, and as Stripe has them, with its invoices and charges. */
function ledger(user) {
  const db = JSON.parse(
    sql(
      `select json_build_object('codes',(select count(*) from qr_code where user_id='${user.id}'),` +
        `'subscriptions',(select coalesce(json_agg(json_build_object('stripe',stripe_subscription_id,'status',status,'plan',plan,'cancelAtPeriodEnd',cancel_at_period_end,'cancelAt',cancel_at,'periodEnd',current_period_end) order by created_at),'[]') from subscription where user_id='${user.id}'),` +
        `'customer',(select stripe_customer_id from "user" where id='${user.id}'))`,
    ),
  );
  const subs = db.customer
    ? stripe("subscriptions", "list", "--limit", "20", "-d", `customer=${db.customer}`, "-d", "status=all").data
    : [];
  const invoices = db.customer ? stripe("invoices", "list", "--limit", "50", "-d", `customer=${db.customer}`).data : [];
  const charges = db.customer
    ? stripe("charges", "list", "--limit", "50", "-d", `customer=${db.customer}`).data.filter((c) => c.status === "succeeded")
    : [];
  return {
    ...db,
    stripe: {
      subscriptions: subs.map((s) => ({
        id: s.id,
        status: s.status,
        cancelAtPeriodEnd: s.cancel_at_period_end,
        cancelAt: s.cancel_at,
        periodEnd: s.items?.data?.[0]?.current_period_end ?? null,
        livemode: s.livemode,
      })),
      invoices: invoices.map((i) => ({
        id: i.id,
        status: i.status,
        total: i.total,
        subscription: i.parent?.subscription_details?.subscription ?? i.subscription ?? null,
      })),
      charges: charges.map((c) => ({ id: c.id, amount: c.amount, livemode: c.livemode })),
    },
  };
}

async function decode(file) {
  const out = execFileSync("pnpm", ["-s", "exec", "tsx", "scripts/qa/decode-file.ts", file], { encoding: "utf8" }).trim().split("\n").pop();
  return JSON.parse(out).payload;
}
async function hop(url) {
  const r = await fetch(url, { redirect: "manual", headers: { "user-agent": "Mozilla/5.0 (HEY-185 QA)" } });
  return { status: r.status, location: r.headers.get("location"), cacheControl: r.headers.get("cache-control") };
}
/** A signed-out visitor follows the link in a fresh browser; what it shows (no owner data on an unavailable page). */
async function visit(url) {
  const c = await context(null);
  const p = await c.newPage();
  await p.goto(url, { waitUntil: "load" });
  const landed = {
    url: p.url(),
    text: (
      await p
        .locator("body")
        .innerText()
        .catch(() => "")
    ).slice(0, 400),
  };
  await c.close();
  return landed;
}
const unavailable = (h) => h.status >= 300 && h.status < 400 && /\/link-unavailable/.test(h.location ?? "");

/** Plan & billing as the owner sees it after a reload: the status badge and the dated row. */
async function billing(p) {
  await p.goto(`${BASE}/dashboard/billing`, { waitUntil: "networkidle" });
  const main = await p.locator("main").innerText();
  const row = (label) => {
    const m = main.match(new RegExp(`${label}\\s*\\n\\s*([^\\n]+)`));
    return m ? m[1].trim() : null;
  };
  return { main, endsOn: row("Ends on"), renewsOn: row("Renews on"), canceling: /\bCancels\b/.test(main), noPlan: /No plan/.test(main) };
}
/** Stripe's date as the billing page prints it (dateStyle medium, en), in the server's or UTC time zone. */
const printed = (unix) =>
  [undefined, "UTC"].map((timeZone) => new Date(unix * 1000).toLocaleDateString("en-US", { dateStyle: "medium", timeZone }));

/** Manage subscription → Stripe's Customer Portal (a real test-mode Portal session for this account's Customer). */
async function portal(p) {
  await p.goto(`${BASE}/dashboard/billing`, { waitUntil: "networkidle" });
  await p.getByRole("button", { name: /^Manage subscription/ }).click();
  await p.waitForURL(/billing\.stripe\.com/, { timeout: 45000 });
  await p.waitForLoadState("networkidle").catch(() => {});
}
async function portalCancel(p) {
  await portal(p);
  await shot(p, "portal");
  await p
    .getByRole("link", { name: /^Cancel (subscription|plan)/ })
    .or(p.getByRole("button", { name: /^Cancel (subscription|plan)/ }))
    .first()
    .click();
  // The Portal's review page opens with its "why are you leaving?" dialog (reasons are on in this configuration).
  const onward = p.getByRole("button", { name: /^Continue to cancellation/ });
  await onward.waitFor({ timeout: 30000 }).catch(() => {});
  await shot(p, "portal-reason");
  if (await onward.count()) await onward.click();
  const confirm = p.getByRole("button", { name: /^Cancel (subscription|plan)/ }).last();
  await confirm.waitFor({ timeout: 30000 });
  await shot(p, "portal-review");
  await confirm.click();
  await p
    .getByText(/(will be canceled|cancels on|Cancell?ation scheduled|ends on|cancel)/i)
    .first()
    .waitFor({ timeout: 30000 })
    .catch(() => {});
  await wait(2000);
  await shot(p, "portal-cancelled");
}
/** HEY-185 Plan & billing "Keep my plan": clears the scheduled cancellation on the same subscription, in the app. */
async function keepMyPlan(p) {
  await p.goto(`${BASE}/dashboard/billing`, { waitUntil: "networkidle" });
  await shot(p, "billing-keep-offered");
  await p.getByRole("button", { name: /^Keep my plan/ }).click();
  await wait(3000);
  await shot(p, "billing-kept");
}
async function portalRenew(p) {
  await portal(p);
  const undo = /^(Renew|Don.t cancel|Reactivate)/i;
  await p
    .getByRole("link", { name: undo })
    .or(p.getByRole("button", { name: undo }))
    .first()
    .click();
  // A review page with its own confirmation ("Renew subscription"), when the Portal shows one.
  const confirm = p.getByRole("button", { name: /^(Renew|Don.t cancel|Confirm)/i }).last();
  await confirm.waitFor({ timeout: 15000 }).catch(() => {});
  await shot(p, "portal-renew-review");
  if (/billing\.stripe\.com\/.+\/(subscriptions|renew|flow)/.test(p.url()) || (await confirm.count()))
    await confirm.click({ timeout: 10000 }).catch(() => {});
  await wait(3000);
  await shot(p, "portal-renewed");
}

const dbSub = (user, id) =>
  JSON.parse(
    sql(
      `select json_build_object('status',status,'cancelAtPeriodEnd',cancel_at_period_end,'cancelAt',cancel_at,'periodEnd',current_period_end) from subscription where user_id='${user.id}' and stripe_subscription_id='${id}'`,
    ) || "null",
  );

let failed = false;
try {
  await journey();
} catch {
  failed = true;
}
await browser.close();
fs.writeFileSync(`${OUT}/results.json`, JSON.stringify({ ...evidence, rows }, null, 2));
for (const r of rows) console.log(`${r.result.padEnd(4)} [${r.kind}] ${tag} ${r.name}${r.note ? ` — ${r.note}` : ""}`);
process.exitCode = failed ? 1 : 0;

async function journey() {
  const ctx = await context(null);
  const p = await ctx.newPage();
  let user, qr, layout, short, original, subId, periodEnd;

  await check("Guest from the homepage: Website · Dynamic with destination A, designed, Export", "browser", p, async () => {
    const draft = await guestDesign(p);
    ok(draft.model === "dynamic", `draft model ${draft.model}`);
    return `draft model=${draft.model}, fg=${findKey(draft, "fg")}`;
  });
  await check(
    "Google: Continue with Google reaches Google's consent with the app's client and callback",
    "genuine-redirect",
    p,
    async () => {
      user = await googleSignIn(p, ctx, scenario);
      return `redirect_uri=${evidence.google.redirect_uri}`;
    },
  );
  await check("Google: returning signed in (fixture) — the Dynamic draft is this account's code, not live yet", "fixture", p, async () => {
    await p.waitForURL(/\/create\/export\?.*qr=/, { timeout: 30000 });
    const u = new URL(p.url());
    qr = u.searchParams.get("qr");
    layout = u.searchParams.get("layout");
    const row = JSON.parse(
      sql(
        `select json_build_object('model',model,'status',status,'short',short_code) from qr_code where id='${qr}' and user_id='${user.id}'`,
      ),
    );
    ok(row.model === "dynamic" && row.short === null, `saved ${JSON.stringify(row)}`);
    return `qr=${qr}`;
  });

  if (scenario === "expire")
    await check(
      "Setup (fixture): the account's Stripe Customer is created on a Stripe test clock and bound as the app binds one",
      "fixture",
      p,
      async () => {
        const clock = stripe(
          "test_helpers",
          "test_clocks",
          "create",
          "-d",
          `frozen_time=${Math.floor(Date.now() / 1000)}`,
          "-d",
          `name=HEY-185 ${tag}`,
        );
        const customer = stripe(
          "customers",
          "create",
          "-d",
          `email=${user.id}@example.test`,
          "-d",
          `metadata[userId]=${user.id}`,
          "-d",
          `test_clock=${clock.id}`,
        );
        sql(`update "user" set stripe_customer_id='${customer.id}' where id='${user.id}' and stripe_customer_id is null`);
        evidence.clock = { id: clock.id, frozenTime: clock.frozen_time, customer: customer.id };
        return `clock ${clock.id}, customer ${customer.id}`;
      },
    );

  await check("Subscribe (Stripe test Checkout 4242): the webhook activates Starter and the code goes live", "stripe-test", p, async () => {
    await p.getByRole("button", { name: /^Subscribe for \$9\.00/ }).click();
    await stripeFill(p, "4242 4242 4242 4242");
    await p.waitForURL((u) => u.host === new URL(BASE).host && /checkout=success/.test(u.search), { timeout: 90000 });
    await p
      .getByRole("link", { name: /^Download/ })
      .or(p.getByRole("button", { name: /^Download/ }))
      .first()
      .waitFor({ timeout: 90000 });
    const l = ledger(user);
    ok(l.subscriptions.length === 1 && l.subscriptions[0].status === "active", `stored ${JSON.stringify(l.subscriptions)}`);
    ok(l.stripe.subscriptions.length === 1 && !l.stripe.subscriptions[0].livemode, `stripe ${JSON.stringify(l.stripe.subscriptions)}`);
    ok(l.stripe.charges.length === 1 && l.stripe.charges[0].amount === 900, `charges ${JSON.stringify(l.stripe.charges)}`);
    subId = l.subscriptions[0].stripe;
    periodEnd = l.stripe.subscriptions[0].periodEnd;
    evidence.subscribed = l;
    return `${subId} active; period end ${new Date(periodEnd * 1000).toISOString()}; charge ${l.stripe.charges[0].id} $9.00`;
  });

  await check("Download: the PNG decodes (ZXing) to the permanent short link; a signed-out visitor reaches A", "browser", p, async () => {
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
    short = await decode(original);
    const code = sql(`select short_code from qr_code where id='${qr}'`);
    ok(new URL(short).pathname === `/r/${code}`, `decoded ${short} is not /r/${code}`);
    const h = await hop(short);
    ok(h.status === 302 && h.location === destA, `short link ${JSON.stringify(h)}`);
    const landed = await visit(short);
    ok(landed.url === destA, `visitor landed on ${landed.url}`);
    evidence.short = { short, code, hop: h };
    return `${short} → 302 ${h.location}`;
  });

  const extras = {};
  if (scenario === "expire")
    await check(
      "Three more codes go live on the plan (draft rows copied: fixture), then are paused, deleted and taken down",
      "browser",
      p,
      async () => {
        for (const kind of ["paused", "deleted", "takendown"]) {
          const id = `x${kind.slice(0, 3)}${randomBytes(8).toString("hex")}`.slice(0, 21);
          const lid = `l${randomBytes(10).toString("hex")}`.slice(0, 21);
          const xname = `${name} ${kind}`;
          sql(
            `insert into qr_code(id,user_id,name,content,model,status,destination) select '${id}',user_id,'${xname}',content,model,'draft',destination from qr_code where id='${qr}';` +
              `insert into qr_layout(id,qr_code_id,name,design,sort_order) select '${lid}','${id}',name,design,sort_order from qr_layout where id='${layout}'`,
          );
          await p.goto(`${BASE}/create/export?qr=${id}&layout=${lid}&format=png`, { waitUntil: "networkidle" });
          await p.getByRole("button", { name: /^Go live/ }).click();
          await until(
            () => sql(`select status='active' and short_code is not null from qr_code where id='${id}'`) === "t",
            `${kind} not live`,
            60000,
          );
          extras[kind] = { id, name: xname, short: `${new URL(short).origin}/r/${sql(`select short_code from qr_code where id='${id}'`)}` };
        }
        // Owner pause on QR details.
        await p.goto(`${BASE}/dashboard/qr/${extras.paused.id}`, { waitUntil: "networkidle" });
        await p.getByRole("button", { name: "Pause", exact: true }).click();
        await until(() => sql(`select status from qr_code where id='${extras.paused.id}'`) === "paused", "pause not stored", 30000);
        // Owner delete in My QR codes.
        await p.goto(`${BASE}/dashboard`, { waitUntil: "networkidle" });
        await p.getByRole("button", { name: `Delete ${extras.deleted.name}` }).click();
        await p.getByRole("alertdialog").getByRole("button", { name: "Delete code" }).click();
        await until(
          () => sql(`select deleted_at is not null from qr_code where id='${extras.deleted.id}'`) === "t",
          "delete not stored",
          30000,
        );
        await wait(9000); // past the Undo window
        // Operator takedown.
        execFileSync("pnpm", ["-s", "moderation", "take-down", extras.takendown.short.split("/r/")[1], "other"], {
          env: { ...process.env, DATABASE_URL: DBURL, DATABASE_URL_UNPOOLED: "", APP_ENV: "dev" },
          stdio: "ignore",
        });
        for (const [kind, x] of Object.entries(extras)) {
          const h = await hop(x.short);
          ok(unavailable(h) || h.status === 404, `${kind} still answers ${JSON.stringify(h)}`);
          x.before = h;
        }
        return Object.entries(extras)
          .map(([k, x]) => `${k} ${x.short} → ${x.before.status} ${x.before.location ?? ""}`)
          .join("; ");
      },
    );

  await check(
    "Cancel through Manage subscription → Stripe's Portal: Plan & billing shows Cancels and Ends on Stripe's period end",
    "stripe-test",
    p,
    async () => {
      await portalCancel(p);
      const s = await until(() => {
        const x = dbSub(user, subId);
        return x?.cancelAtPeriodEnd ? x : null;
      }, "the scheduled cancellation never reached the database (webhook)");
      const st = ledger(user).stripe.subscriptions.find((x) => x.id === subId);
      ok(st.status === "active" && (st.cancelAtPeriodEnd || st.cancelAt), `Stripe ${JSON.stringify(st)}`);
      const cutoff = st.cancelAt ?? st.periodEnd;
      const b = await billing(p);
      await shot(p, "billing-cancels");
      ok(
        b.canceling && b.endsOn && printed(cutoff).includes(b.endsOn),
        `billing shows ${JSON.stringify({ canceling: b.canceling, endsOn: b.endsOn })}, Stripe cutoff ${printed(cutoff)}`,
      );
      evidence.scheduled = { stripe: st, stored: s, billing: { endsOn: b.endsOn }, cutoff: new Date(cutoff * 1000).toISOString() };
      return `stored status ${s.status}, cancel_at_period_end ${s.cancelAtPeriodEnd}; Stripe cutoff ${new Date(cutoff * 1000).toISOString()}; page "Cancels" · "Ends on ${b.endsOn}"`;
    },
  );
  await check("Before the cutoff: the plan stays (file 200, link → A)", "stripe-test", p, async () => {
    const h = await hop(short);
    ok(h.status === 302 && h.location === destA, `link ${JSON.stringify(h)}`);
    const file = await p.request.get(`${BASE}/api/export/${layout}?format=png&qr=${qr}&prepare=1`, { maxRedirects: 0 });
    ok(file.status() === 200, `file answered ${file.status()}`);
    return `link 302 → A; file ${file.status()}`;
  });

  if (scenario === "undo" || scenario === "keep") {
    await check(
      scenario === "keep"
        ? "Undo with Plan & billing's Keep my plan: the same subscription continues, no new subscription, invoice or charge"
        : "Undo with the Portal's Renew: the same subscription continues, no new subscription, invoice or charge",
      "stripe-test",
      p,
      async () => {
        const before = ledger(user);
        if (scenario === "keep") await keepMyPlan(p);
        else await portalRenew(p);
        await until(() => dbSub(user, subId)?.cancelAtPeriodEnd === false, "the renewal never reached the database (webhook)");
        const after = ledger(user);
        const st = after.stripe.subscriptions;
        ok(
          st.length === 1 && st[0].id === subId && st[0].status === "active" && !st[0].cancelAtPeriodEnd && !st[0].cancelAt,
          `Stripe ${JSON.stringify(st)}`,
        );
        ok(after.subscriptions.length === 1, `stored ${JSON.stringify(after.subscriptions)}`);
        ok(
          after.stripe.invoices.length === before.stripe.invoices.length && after.stripe.charges.length === before.stripe.charges.length,
          "a new invoice or charge",
        );
        const b = await billing(p);
        await shot(p, "billing-renewed");
        ok(!b.canceling && b.renewsOn, `billing ${JSON.stringify({ canceling: b.canceling, renewsOn: b.renewsOn })}`);
        const h = await hop(short);
        ok(h.status === 302 && h.location === destA, `link ${JSON.stringify(h)}`);
        evidence.renewed = { before: before.stripe, after: after.stripe, renewsOn: b.renewsOn };
        return `${subId} active, not cancelling; subscriptions 1, invoices ${after.stripe.invoices.length}, charges ${after.stripe.charges.length} (unchanged); "Renews on ${b.renewsOn}"; link → A`;
      },
    );
    await check("A repeated and a stale delivery of the cancellation event change nothing", "stripe-test", p, async () => {
      const events = stripe(
        "events",
        "list",
        "--limit",
        "50",
        "-d",
        `created[gte]=${startedAt}`,
        "-d",
        "type=customer.subscription.updated",
      ).data.filter(
        // The Portal schedules with cancel_at (cancel_at_period_end stays false), HEY-139.
        (e) => e.data.object.id === subId && (e.data.object.cancel_at_period_end || e.data.object.cancel_at),
      );
      ok(events.length >= 1, "no cancellation event found");
      execFileSync("stripe", ["events", "resend", events[0].id, "--api-key", STRIPE_KEY], { stdio: "ignore" });
      await wait(6000);
      const s = dbSub(user, subId);
      ok(s.status === "active" && s.cancelAtPeriodEnd === false, `stored after resend ${JSON.stringify(s)}`);
      ok((await hop(short)).location === destA, "link changed");
      return `resent ${events[0].id}: stored stays active, not cancelling`;
    });
  } else {
    await check(
      "The test clock passes the period end: Stripe ends the subscription and the webhook stores canceled",
      "stripe-test",
      p,
      async () => {
        const to = periodEnd + 2 * 86400;
        stripe("test_helpers", "test_clocks", "advance", evidence.clock.id, "-d", `frozen_time=${to}`);
        await until(
          () => stripe("test_helpers", "test_clocks", "retrieve", evidence.clock.id).status === "ready",
          "clock never ready",
          180000,
          3000,
        );
        const deleted = await until(
          () =>
            stripe("events", "list", "--limit", "50", "-d", "type=customer.subscription.deleted").data.find(
              (e) => e.data.object.id === subId,
            ) ?? null,
          "no customer.subscription.deleted event",
          120000,
          3000,
        );
        const s = await until(
          () => (dbSub(user, subId)?.status === "canceled" ? dbSub(user, subId) : null),
          "stored status never canceled",
          90000,
        );
        evidence.ended = { event: deleted.id, stored: s, clockTo: new Date(to * 1000).toISOString() };
        return `${deleted.type} ${deleted.id}; stored ${s.status}; clock at ${new Date(to * 1000).toISOString()}`;
      },
    );
    await check(
      "After the end: Plan & billing shows no plan; the link shows the neutral page; the file is locked",
      "stripe-test",
      p,
      async () => {
        const b = await billing(p);
        await shot(p, "billing-ended");
        ok(b.noPlan && !b.canceling, `billing ${JSON.stringify({ noPlan: b.noPlan, canceling: b.canceling })}`);
        const h = await hop(short);
        ok(unavailable(h), `link ${JSON.stringify(h)}`);
        const v = await visit(short);
        ok(!v.text.includes("example.com") && !v.text.includes(name), "the unavailable page shows owner data");
        const file = await p.request.get(`${BASE}/api/export/${layout}?format=png&qr=${qr}&prepare=1`, { maxRedirects: 0 });
        ok(file.status() === 402, `file answered ${file.status()}`);
        const row = JSON.parse(
          sql(`select json_build_object('status',status,'short',short_code,'destination',destination) from qr_code where id='${qr}'`),
        );
        evidence.afterEnd = { hop: h, landed: v.url, file: file.status(), code: row };
        return `"No plan"; ${short} → ${h.status} ${h.location}; file ${file.status()}; code kept ${JSON.stringify(row)}`;
      },
    );
    await check(
      "Reactivate from Plan & billing (Stripe test Checkout); the ORIGINAL file's short link redirects again",
      "stripe-test",
      p,
      async () => {
        await p.goto(`${BASE}/dashboard/billing`, { waitUntil: "networkidle" });
        // HEY-185 Plan & billing offers "Reactivate <plan>" once a plan has ended; before it, Choose a plan → Pricing.
        const reactivate = p.getByRole("button", { name: /^Reactivate / }).or(p.getByRole("link", { name: /^Reactivate / }));
        if (await reactivate.count()) {
          evidence.reactivateLabel = (await reactivate.first().innerText()).trim();
          await reactivate.first().click();
        } else {
          await p.getByRole("link", { name: /^Choose a plan/ }).click();
          await p.waitForURL(/\/pricing/);
          await p
            .getByRole("button", { name: /^Subscribe now/ })
            .first()
            .click();
        }
        await stripeFill(p, "4242 4242 4242 4242");
        await p.waitForURL((u) => u.host === new URL(BASE).host, { timeout: 90000 });
        const l = await until(() => {
          const x = ledger(user);
          return x.subscriptions.some((s) => s.status === "active" && s.stripe !== subId) ? x : null;
        }, "no new active subscription stored");
        const fresh = l.subscriptions.find((s) => s.stripe !== subId);
        ok(l.subscriptions.find((s) => s.stripe === subId).status === "canceled", "the old subscription came back");
        const again = await decode(original);
        ok(again === short, `original decodes to ${again}`);
        const h = await hop(short);
        ok(h.status === 302 && h.location === destA, `link after reactivation ${JSON.stringify(h)}`);
        const code = sql(`select short_code from qr_code where id='${qr}'`);
        ok(code === evidence.short.code, "short code changed");
        const b = await billing(p);
        await shot(p, "billing-reactivated");
        ok(!b.noPlan && b.renewsOn, `billing ${JSON.stringify({ noPlan: b.noPlan, renewsOn: b.renewsOn })}`);
        evidence.reactivated = { subscription: fresh, ledger: l.stripe, hop: h, renewsOn: b.renewsOn };
        return `new ${fresh.stripe} ${fresh.status}; old ${subId} canceled; ${short} (same code ${code}) → 302 A; "Renews on ${b.renewsOn}"; charges ${l.stripe.charges.length}`;
      },
    );
    await check("A redelivered event of the ended subscription doesn't revive it or touch the new one", "stripe-test", p, async () => {
      const old = stripe(
        "events",
        "list",
        "--limit",
        "100",
        "-d",
        `created[gte]=${startedAt}`,
        "-d",
        "type=customer.subscription.updated",
      ).data.find((e) => e.data.object.id === subId && e.data.object.status === "active");
      ok(old, "no earlier update event of the old subscription");
      execFileSync("stripe", ["events", "resend", old.id, "--api-key", STRIPE_KEY], { stdio: "ignore" });
      await wait(6000);
      const l = ledger(user);
      ok(l.subscriptions.find((s) => s.stripe === subId).status === "canceled", "the ended subscription came back");
      ok(l.subscriptions.filter((s) => s.status === "active").length === 1, `active rows ${JSON.stringify(l.subscriptions)}`);
      ok((await hop(short)).location === destA, "link changed");
      return `resent ${old.id} (an "active" update of ${subId}): it stays canceled; one active subscription`;
    });
    await check("Reactivation doesn't undo an owner pause, a deletion or an operator takedown", "stripe-test", p, async () => {
      const out = [];
      for (const [kind, x] of Object.entries(extras)) {
        const h = await hop(x.short);
        ok(unavailable(h) || h.status === 404, `${kind} answers ${JSON.stringify(h)} after reactivation`);
        out.push(`${kind} ${h.status}`);
      }
      const rowsNow = JSON.parse(
        sql(
          `select json_agg(json_build_object('id',id,'status',status,'deleted',deleted_at is not null,'takenDown',taken_down_at is not null)) from qr_code where id in ('${Object.values(
            extras,
          )
            .map((x) => x.id)
            .join("','")}')`,
        ),
      );
      evidence.extrasAfter = rowsNow;
      return `${out.join(", ")}; ${JSON.stringify(rowsNow)}`;
    });
  }

  await check("Owner only: another account sees its own (empty) billing; signed out is sent to sign in", "browser", p, async () => {
    const other = googleAccount("other");
    const c = await context(other.cookie);
    const q = await c.newPage();
    await q.goto(`${BASE}/dashboard/billing`, { waitUntil: "networkidle" });
    const text = await q.locator("main").innerText();
    ok(/No plan/.test(text) && !/Manage subscription/.test(text), "another account sees a plan or Manage");
    await c.close();
    const anon = await context(null);
    const r = await anon.newPage();
    // The account area streams its loading skeleton first, so the sign-in redirect lands after hydration.
    const html = await (await fetch(`${BASE}/dashboard/billing`)).text();
    // (The page ships its i18n strings; what must never appear is this account's own data.)
    const own = [
      user.id,
      subId,
      evidence.short.code,
      sql(`select coalesce(stripe_customer_id,'') from "user" where id='${user.id}'`),
    ].filter(Boolean);
    ok(
      own.every((v) => !html.includes(v)),
      "signed-out HTML holds this account's data",
    );
    await r.goto(`${BASE}/dashboard/billing`, { waitUntil: "load" });
    await r.waitForURL(/\/sign-in\?next=/, { timeout: 20000 });
    await anon.close();
    return "other account: No plan, no Manage; signed out → sign-in";
  });
}
