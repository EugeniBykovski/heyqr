/*
 * HEY-182: a Static QR from guest to repeat download, in a real browser against a running HeyQR in test configuration.
 * One run per fresh account; each starts signed out.
 *
 *   node scripts/qa/static-checkout.mjs <chromium|firefox|webkit> <390|834|1440> <fresh|cancel|retry> [tag]
 *
 *   fresh   create + design a Static QR as a guest, Export, Continue with Google, sign-in keeps the draft, design and
 *           export choices; Stripe test Checkout (4242); confirmation pending (webhook held back, then delivered);
 *           file preparation; download; ZXing decode of the downloaded file equals the input; access persists after a
 *           reload and in a new session; back from My QR codes, a repeat download with no new Checkout or charge.
 *   cancel  the same up to Checkout, then "Back to HeyQR": draft kept, export locked (402), Checkout can be resumed.
 *   retry   paid with 4242, then the first file preparation fails at the storage boundary (QA S3 answers 500 once):
 *           error and Try again; the retry succeeds on the same purchase; another account can't reach the file.
 *
 * Google: the real Google consent redirect is checked (client_id, redirect_uri = the app's callback, state, scopes) and
 * stopped there; completing Google sign-in needs a person, so the account Google would create is written as Better Auth
 * writes it (user + account(google) + session) and the browser continues to the same callbackURL. Results mark this
 * step "fixture". Stripe is genuine test mode: real Checkout, test cards, the Stripe CLI forwarding signed webhooks.
 *
 * Needs: the app running with APP_ENV=dev, its own database and S3_ENDPOINT pointing at scripts/qa/fake-s3.mjs; BASE,
 * QA_DB (psql), BETTER_AUTH_SECRET, GOOGLE_CLIENT_ID, STRIPE_SECRET_KEY (sk_test_ only), M (output folder), QA_S3 (the
 * fake S3's URL), PLAYWRIGHT_CORE (playwright-core 1.64.1, outside the app), and for `fresh` STRIPE_LISTEN_CMD: the
 * Stripe CLI listener is stopped while the webhook is held back and started again by this script. Report:
 * docs/qa/HEY-182-static-checkout.md.
 */
const { chromium, firefox, webkit } = await import(process.env.PLAYWRIGHT_CORE ?? "playwright-core");
import fs from "node:fs";
import { execFileSync, spawn } from "node:child_process";
import { createHmac, randomBytes } from "node:crypto";

const [engineName, vwArg, scenario, tagArg] = process.argv.slice(2);
const VW = Number(vwArg);
const VH = VW === 390 ? 844 : VW === 834 ? 1112 : 900;
const BASE = process.env.BASE ?? "http://localhost:3193";
const DB = process.env.QA_DB ?? "heyqr_hey182_checkout";
const S3 = process.env.QA_S3 ?? "http://localhost:9182";
const SECRET = process.env.BETTER_AUTH_SECRET;
const STRIPE_KEY = process.env.STRIPE_SECRET_KEY ?? "";
if (!STRIPE_KEY.startsWith("sk_test_")) throw new Error("STRIPE_SECRET_KEY must be a test-mode key");
const tag = tagArg ?? `${scenario}-${engineName}-${VW}-${randomBytes(3).toString("hex")}`;
const OUT = `${process.env.M}/runs/${tag}`;
fs.mkdirSync(OUT, { recursive: true });
const sql = (q) => execFileSync("psql", [DB, "-Atc", q], { encoding: "utf8" }).trim();
const stripe = (...args) => JSON.parse(execFileSync("stripe", [...args, "--api-key", STRIPE_KEY], { encoding: "utf8" }));
const browser = await { chromium, firefox, webkit }[engineName].launch();
const version = browser.version();
const rows = [];
const evidence = { tag, engine: engineName, version, viewport: VW, scenario };
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

/* Fresh accounts: the browser is signed out; the user rows appear only when "Google" returns. */
function googleAccount(label) {
  const id = `qa182-${label}-${tag}`;
  const token = `tok_${id}_${randomBytes(6).toString("hex")}`;
  sql(
    `insert into "user"(id,name,email,email_verified,created_at,updated_at) values('${id}','QA ${label}','${id}@example.test',true,now(),now());` +
      `insert into account(id,account_id,provider_id,user_id,scope,created_at,updated_at) values('acc-${id}','google-sub-${id}','google','${id}','openid email profile',now(),now());` +
      `insert into session(id,expires_at,token,user_id,created_at,updated_at) values('s-${token}',now()+interval '1 day','${token}','${id}',now(),now())`,
  );
  return { id, cookie: cookieFor(token) };
}
function newSession(userId) {
  const token = `tok_${userId}_${randomBytes(6).toString("hex")}`;
  sql(
    `insert into session(id,expires_at,token,user_id,created_at,updated_at) values('s-${token}',now()+interval '1 day','${token}','${userId}',now(),now())`,
  );
  return cookieFor(token);
}
const cookieFor = (token) => encodeURIComponent(`${token}.${createHmac("sha256", SECRET).update(token).digest("base64")}`);
async function context(cookie) {
  const ctx = await browser.newContext({ viewport: { width: VW, height: VH }, acceptDownloads: true });
  if (cookie) await ctx.addCookies([{ name: "better-auth.session_token", value: cookie, domain: "localhost", path: "/" }]);
  ctx.setDefaultTimeout(30000);
  return ctx;
}

const input = `qa182-${tag}.example/landing?src=print`;
const expectedPayload = `https://${input}`;

/** Guest: Website → content → Custom design (Dots, Forest) → Export with PNG 4×. Returns the browser draft. */
async function guestDesign(p) {
  await p.goto(`${BASE}/create`, { waitUntil: "networkidle" });
  await p.getByRole("button", { name: "Continue", exact: true }).click();
  await p.getByRole("textbox", { name: "Website address" }).fill(input);
  await p.getByRole("textbox", { name: /Name in My QR codes/ }).fill(`HEY-182 ${tag}`);
  await p.getByRole("button", { name: "Continue to design" }).click();
  await p
    .getByRole("button", { name: /^Custom design/ })
    .first()
    .click();
  await p.getByRole("tablist", { name: "Design settings" }).waitFor();
  await p.getByRole("tab", { name: "Pattern" }).click();
  await p
    .getByRole("group", { name: /^Modules/ })
    .getByRole("button", { name: "Dots", exact: true })
    .click();
  await p.getByRole("tab", { name: "Colors" }).click();
  await p.getByRole("group", { name: "Swatches" }).first().getByRole("button", { name: "Forest" }).click();
  await p.getByRole("status").filter({ hasText: "Scan verified" }).first().waitFor({ timeout: 20000 });
  await shot(p, "guest-design");
  await p.getByRole("button", { name: "Export", exact: true }).first().click();
  await p.waitForURL(/\/create\/export/);
  await p.getByRole("group", { name: "PNG size" }).getByRole("button", { name: "4×" }).click();
  await p.getByRole("button", { name: "Continue with Google" }).waitFor();
  await shot(p, "guest-export");
  return JSON.parse(await p.evaluate(() => localStorage.getItem("heyqr:draft:v1")));
}

/** Continue with Google: check the real consent redirect, then return as Google would (fixture sign-in). */
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
    path: g.pathname,
    redirect_uri: q.redirect_uri,
    scope: q.scope,
    state_len: q.state.length,
    client_id_matches: true,
    callbackURL: body.callbackURL,
    errorCallbackURL: body.errorCallbackURL,
  };
  await ctx.unroute("https://accounts.google.com/**");
  const user = googleAccount(label);
  await ctx.addCookies([{ name: "better-auth.session_token", value: user.cookie, domain: "localhost", path: "/" }]);
  await p.goto(BASE + body.callbackURL, { waitUntil: "load" });
  return { ...user, callbackURL: body.callbackURL };
}

/** After sign-in: the saved code, its design and the export choices are the guest's. */
async function checkResume(p, user, draft) {
  await p.waitForURL(/\/create\/export\?.*qr=/, { timeout: 30000 });
  const u = new URL(p.url());
  const qr = u.searchParams.get("qr");
  const layout = u.searchParams.get("layout");
  ok(u.searchParams.get("format") === "png" && u.searchParams.get("res") === "4", `export intent lost: ${u.search}`);
  await p.getByRole("group", { name: "PNG size" }).getByRole("button", { name: "4×" }).and(p.locator('[aria-pressed="true"]')).waitFor();
  const codes = sql(`select count(*) from qr_code where user_id='${user.id}'`);
  ok(codes === "1", `${codes} codes saved for the new account`);
  const row = JSON.parse(
    sql(`select json_build_object('content',content,'model',model,'name',name) from qr_code where id='${qr}' and user_id='${user.id}'`),
  );
  ok(row.model === "static" && findKey(row.content, "url")?.includes(input.split("/")[0]), `saved content ${JSON.stringify(row.content)}`);
  const design = JSON.parse(sql(`select design from qr_layout where id='${layout}' and qr_code_id='${qr}'`));
  const want = { pattern: findKey(draft, "pattern"), fg: findKey(draft, "fg") };
  const got = { pattern: findKey(design, "pattern"), fg: findKey(findKey(design, "colors") ?? {}, "fg") };
  ok(
    want.pattern === "dot" && got.pattern === "dot" && want.fg && got.fg?.toLowerCase() === want.fg.toLowerCase(),
    `design changed: draft ${JSON.stringify(want)} saved ${JSON.stringify(got)}`,
  );
  evidence.saved = { qr, layout, content: row.content, draftDesign: want, savedDesign: got };
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
  await f.locator("#payment-nameInput").fill("QA HEY-182");
  const country = f.locator("#payment-countryInput");
  if (await country.count()) await country.selectOption("US").catch(() => {});
  // Stripe Tax collects the full billing address on this account's Checkout.
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
  // Stripe adds fields over time (address for tax); when Pay doesn't leave Checkout, keep what the form shows.
  const left = await p
    .waitForURL((u) => !u.host.includes("stripe.com"), { timeout: 20000 })
    .then(
      () => true,
      () => false,
    );
  if (!left) {
    fs.writeFileSync(
      `${OUT}/stripe-form.aria.txt`,
      (await p
        .locator("body")
        .ariaSnapshot()
        .catch(() => "")) +
        "\n---iframe---\n" +
        (await f
          .locator("body")
          .ariaSnapshot()
          .catch(() => "")),
    );
    await p.screenshot({ path: `${OUT}/stripe-form.png` }).catch(() => {});
  }
}
const fileStatus = async (ctx, path) => (await ctx.request.get(BASE + path, { maxRedirects: 0 })).status();
const purchases = (user) =>
  JSON.parse(
    sql(
      `select coalesce(json_agg(json_build_object('id',id,'status',status,'session',stripe_checkout_session_id,'pi',stripe_payment_intent_id,'amount',amount_total,'currency',currency) order by created_at),'[]') from purchase where user_id='${user.id}'`,
    ),
  );
function stripeFor(user) {
  const sessions = stripe("checkout", "sessions", "list", "--limit", "50", "-d", `created[gte]=${startedAt}`).data.filter(
    (s) => s.metadata?.userId === user.id,
  );
  const intents = stripe("payment_intents", "list", "--limit", "50", "-d", `created[gte]=${startedAt}`).data.filter(
    (x) => x.metadata?.userId === user.id,
  );
  return {
    sessions: sessions.map((s) => ({ id: s.id, status: s.status, payment_status: s.payment_status, livemode: s.livemode })),
    succeededCharges: intents
      .filter((x) => x.status === "succeeded")
      .map((x) => ({ id: x.id, amount: x.amount_received, currency: x.currency, livemode: x.livemode })),
  };
}
async function download(p, name) {
  const link = p.getByRole("link", { name: /^Download/ }).first();
  await link.waitFor({ timeout: 60000 });
  const [dl] = await Promise.all([p.waitForEvent("download", { timeout: 60000 }), link.click()]);
  const file = `${OUT}/${name}`;
  await dl.saveAs(file);
  const head = fs.readFileSync(file).subarray(0, 8).toString("hex");
  ok(head === "89504e470d0a1a0a", `${name} is not a PNG`);
  const decoded = JSON.parse(
    execFileSync("pnpm", ["-s", "exec", "tsx", "scripts/qa/decode-file.ts", file], { encoding: "utf8" }).trim().split("\n").pop(),
  );
  ok(decoded.payload === expectedPayload, `decoded ${decoded.payload} ≠ ${expectedPayload}`);
  return { file: name, bytes: fs.statSync(file).size, suggested: dl.suggestedFilename(), decoded: decoded.payload };
}
const s3 = async (path) => (await fetch(S3 + path)).json();

let failed = false;
try {
  if (scenario === "fresh") await fresh();
  else if (scenario === "cancel") await cancel();
  else if (scenario === "retry") await retry();
  else throw new Error(`unknown scenario ${scenario}`);
} catch {
  failed = true;
}
// The fresh run stops the Stripe listener to hold a webhook back; whatever happened, leave one running.
if (scenario === "fresh" && process.env.STRIPE_LISTEN_CMD) {
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

async function signedInWithDraft(label) {
  const ctx = await context(null);
  const p = await ctx.newPage();
  let draft, user, ids;
  await check(
    "Guest: Static Website QR created and designed (Dots, Forest), Export shows PNG 4× and Continue with Google",
    "browser",
    p,
    async () => {
      ok(
        (await ctx.cookies()).every((c) => c.name !== "better-auth.session_token"),
        "not signed out",
      );
      draft = await guestDesign(p);
      ok(sql(`select count(*) from qr_code where name='HEY-182 ${tag}'`) === "0", "a code was saved before sign-in");
      return `draft pattern=${findKey(draft, "pattern")}`;
    },
  );
  await check(
    "Google: Continue with Google reaches Google's consent with the app's client, callback and state",
    "genuine-redirect",
    p,
    async () => {
      user = await googleSignIn(p, ctx, label);
      return `redirect_uri=${evidence.google.redirect_uri}; callbackURL=${user.callbackURL}`;
    },
  );
  await check(
    "Google: returning signed in (Google's account written as Better Auth does) — draft, design and PNG 4× intent kept",
    "fixture",
    p,
    async () => {
      ids = await checkResume(p, user, draft);
      ok((await fileStatus(ctx, `/api/export/${ids.layout}?format=png&qr=${ids.qr}&prepare=1`)) === 402, "unpaid file not 402");
      await p.getByRole("button", { name: /^Pay \$4\.99/ }).waitFor();
      return `qr=${ids.qr}`;
    },
  );
  return { ctx, p, user, ...ids };
}

async function fresh() {
  const { ctx, p, user, qr, layout } = await signedInWithDraft("fresh");
  let first;
  await check(
    "Stripe test Checkout 4242; back on Export the payment is 'confirming' until the signed webhook arrives",
    "stripe-test",
    p,
    async () => {
      // Hold the webhook back: stop the listener so the return shows the confirmation-pending state for real.
      execFileSync("pkill", ["-f", "stripe listen"]);
      await p.getByRole("button", { name: /^Pay \$4\.99/ }).click();
      await stripeFill(p, "4242 4242 4242 4242");
      await p.waitForURL(/checkout=success/, { timeout: 90000 });
      await p
        .getByText(/Confirming your payment/)
        .first()
        .waitFor({ timeout: 20000 });
      ok((await fileStatus(ctx, `/api/export/${layout}?format=png&qr=${qr}&prepare=1`)) === 402, "file unlocked before the webhook");
      ok(
        purchases(user).every((x) => x.status !== "paid"),
        "paid before the webhook",
      );
      evidence.pendingShot = await shot(p, "confirming-payment");
      await p.waitForTimeout(6000);
      ok(
        await p
          .getByText(/Confirming your payment/)
          .first()
          .isVisible(),
        "pending state did not persist without the webhook",
      );
      // Deliver it: start the listener again and resend the completed event Stripe created for this session.
      const listener = spawn("sh", ["-c", process.env.STRIPE_LISTEN_CMD], { detached: true, stdio: "ignore" });
      listener.unref();
      await new Promise((r) => setTimeout(r, 7000));
      const session = purchases(user)[0]?.session;
      const events = stripe("events", "list", "--limit", "20", "-d", "type=checkout.session.completed").data.filter(
        (e) => e.data.object.id === session,
      );
      ok(events.length === 1, `completed event for ${session} not found`);
      // The first storage write is held 5 s so the file-preparation state is on screen long enough to check.
      await fetch(`${S3}/__fail?op=delay&n=5000`);
      execFileSync("stripe", ["events", "resend", events[0].id, "--api-key", STRIPE_KEY], { stdio: "ignore" });
      evidence.webhookEvent = events[0].id;
      await p.getByRole("button", { name: /^Preparing your PNG/ }).waitFor({ timeout: 60000 });
      evidence.preparingShot = await shot(p, "preparing-file");
      return `event ${events[0].id} delivered after the pending state; then "Preparing your PNG…"`;
    },
  );
  await check(
    "Paid access is the server's: one paid order from the verified webhook; Preparing your PNG… then Download",
    "stripe-test",
    p,
    async () => {
      const paid = purchases(user).filter((x) => x.status === "paid");
      ok(paid.length === 1 && paid[0].amount === 499 && paid[0].currency === "usd", `paid orders ${JSON.stringify(paid)}`);
      const st = stripeFor(user);
      ok(st.sessions.length === 1 && st.sessions[0].livemode === false && st.succeededCharges.length === 1, `stripe ${JSON.stringify(st)}`);
      evidence.afterPayment = { purchases: purchases(user), stripe: st };
      return `order ${paid[0].id}, ${paid[0].pi}`;
    },
  );
  await check("Download: the PNG decodes (ZXing) to the typed address", "stripe-test", p, async () => {
    await p
      .getByRole("link", { name: /^Download/ })
      .first()
      .waitFor({ timeout: 60000 });
    evidence.readyShot = await shot(p, "file-ready");
    first = await download(p, "paid-first.png");
    evidence.firstDownload = first;
    return `${first.bytes} bytes → ${first.decoded}`;
  });
  await check("Persists: after a reload, and in a new browser session, the code is paid (no Pay, file 200)", "stripe-test", p, async () => {
    await p.reload({ waitUntil: "networkidle" });
    ok((await p.getByRole("button", { name: /^Pay / }).count()) === 0, "Pay offered after reload");
    const ctx2 = await context(newSession(user.id));
    const p2 = await ctx2.newPage();
    await p2.goto(`${BASE}/create/export?qr=${qr}&layout=${layout}&format=png&res=4`, { waitUntil: "networkidle" });
    ok((await p2.getByRole("button", { name: /^Pay / }).count()) === 0, "Pay offered in a new session");
    ok((await fileStatus(ctx2, `/api/export/${layout}?format=png&qr=${qr}&prepare=1`)) === 200, "new session can't prepare the paid file");
    await shot(p2, "new-session-export");
    await ctx2.close();
  });
  await check(
    "Repeat: from My QR codes back to the code, download again — same order, no new Checkout or charge",
    "stripe-test",
    p,
    async () => {
      const before = { purchases: purchases(user).length, stripe: stripeFor(user) };
      await p.goto(`${BASE}/dashboard`, { waitUntil: "networkidle" });
      await p
        .getByRole("link", { name: new RegExp(`HEY-182 ${tag}`) })
        .first()
        .click();
      await p.waitForURL(new RegExp(`/dashboard/qr/${qr}`));
      await shot(p, "code-page");
      await p.getByRole("heading", { level: 1, name: `HEY-182 ${tag}` }).waitFor();
      await p
        .getByRole("link", { name: /^Download PNG of / })
        .first()
        .click();
      await p.waitForURL(/\/create\/export\?/);
      ok((await p.getByRole("button", { name: /^Pay / }).count()) === 0, "Pay offered on return");
      // A paid code opens on "Download PNG" (prepares the file) or, once prepared, the download link itself.
      const ctl = p
        .getByRole("button", { name: /^Download/ })
        .or(p.getByRole("link", { name: /^Download/ }))
        .first();
      await ctl.waitFor({ timeout: 30000 });
      if ((await ctl.evaluate((el) => el.tagName)) === "BUTTON") await ctl.click();
      const again = await download(p, "paid-repeat.png");
      const after = { purchases: purchases(user).length, stripe: stripeFor(user) };
      ok(
        after.purchases === before.purchases &&
          after.stripe.sessions.length === before.stripe.sessions.length &&
          after.stripe.succeededCharges.length === 1,
        `before ${JSON.stringify(before)} after ${JSON.stringify(after)}`,
      );
      evidence.repeat = { download: again, before, after };
      await shot(p, "repeat-downloaded");
      return `${again.decoded}; orders ${after.purchases}, sessions ${after.stripe.sessions.length}, charges ${after.stripe.succeededCharges.length}`;
    },
  );
  await ctx.close();
}

async function cancel() {
  const { ctx, p, user, qr, layout } = await signedInWithDraft("cancel");
  await check(
    "Cancel: Back to HeyQR from Checkout — 'not charged', draft and choices kept, export still locked",
    "stripe-test",
    p,
    async () => {
      await p.getByRole("button", { name: /^Pay \$4\.99/ }).click();
      await p.waitForURL(/checkout\.stripe\.com/, { timeout: 45000 });
      await p.frameLocator('iframe[src*="elements-inner"]').first().locator("#payment-numberInput").waitFor({ timeout: 45000 });
      await p.getByRole("link", { name: /^Back to HeyQR/ }).click();
      await p.waitForURL(/checkout=cancelled/, { timeout: 45000 });
      await p
        .getByText(/weren.t charged/i)
        .first()
        .waitFor();
      const u = new URL(p.url());
      ok(
        u.searchParams.get("qr") === qr && u.searchParams.get("layout") === layout && u.searchParams.get("res") === "4",
        `choices lost ${u.search}`,
      );
      ok((await fileStatus(ctx, `/api/export/${layout}?format=png&qr=${qr}&prepare=1`)) === 402, "unlocked after cancel");
      ok(
        purchases(user).every((x) => x.status !== "paid"),
        "paid after cancel",
      );
      ok(stripeFor(user).succeededCharges.length === 0, "charged after cancel");
      const design = JSON.parse(sql(`select design from qr_layout where id='${layout}'`));
      ok(findKey(design, "pattern") === "dot", "design lost");
      await shot(p, "cancelled");
    },
  );
  await check("Cancel: Pay again opens a new Checkout for the same code (resume)", "stripe-test", p, async () => {
    await p.getByRole("button", { name: /^Pay \$4\.99/ }).click();
    await p.waitForURL(/checkout\.stripe\.com/, { timeout: 45000 });
    await p.frameLocator('iframe[src*="elements-inner"]').first().locator("#payment-numberInput").waitFor({ timeout: 45000 });
    await shot(p, "resumed-checkout");
    const st = stripeFor(user);
    evidence.cancel = { purchases: purchases(user), stripe: st };
    ok(st.succeededCharges.length === 0, "charged");
    return `${st.sessions.length} sessions, 0 charges`;
  });
  await ctx.close();
}

async function retry() {
  const { ctx, p, user, qr, layout } = await signedInWithDraft("retry");
  await check("Retry: paid (4242), the first file preparation fails at storage — error and Try again shown", "stripe-test", p, async () => {
    // The S3 client retries a failed PUT (3 attempts by default), so a whole preparation fails only when all 3 do.
    await fetch(`${S3}/__fail?op=put&n=3`);
    await p.getByRole("button", { name: /^Pay \$4\.99/ }).click();
    await stripeFill(p, "4242 4242 4242 4242");
    await p.waitForURL(/checkout=success/, { timeout: 90000 });
    await p
      .getByText(/couldn.t prepare your PNG/i)
      .first()
      .waitFor({ timeout: 60000 });
    await p.getByRole("button", { name: /^Try again/ }).waitFor();
    const log = await s3("/__log");
    const failedPuts = log.log.filter((l) => l.method === "PUT" && l.status === 500 && l.key.includes(qr)).length;
    ok(failedPuts === 3, `${failedPuts} failed storage PUTs for this code`);
    evidence.injected = { failedPuts };
    ok(purchases(user).filter((x) => x.status === "paid").length === 1, "payment not recorded");
    evidence.failShot = await shot(p, "prepare-failed");
  });
  await check(
    "Retry: Try again succeeds on the same purchase — no new order, Checkout or charge; file decodes",
    "stripe-test",
    p,
    async () => {
      const before = { purchases: purchases(user).length, stripe: stripeFor(user) };
      await p.getByRole("button", { name: /^Try again/ }).click();
      const got = await download(p, "paid-retry.png");
      const after = { purchases: purchases(user).length, stripe: stripeFor(user) };
      ok(
        after.purchases === before.purchases &&
          after.stripe.sessions.length === before.stripe.sessions.length &&
          after.stripe.succeededCharges.length === 1,
        `before ${JSON.stringify(before)} after ${JSON.stringify(after)}`,
      );
      evidence.retry = { download: got, before, after, storage: (await s3("/__log")).log.slice(-8) };
      await shot(p, "retry-downloaded");
      return `${got.decoded}; 1 order, ${after.stripe.sessions.length} session, 1 charge`;
    },
  );
  await check(
    "Another account: no access to the paid code or its file (export page, file API, prepare, all-files, code page)",
    "browser",
    p,
    async () => {
      const other = googleAccount("other");
      const c2 = await context(other.cookie);
      const p2 = await c2.newPage();
      const statuses = {
        file: await fileStatus(c2, `/api/export/${layout}?format=png`),
        fileWithQr: await fileStatus(c2, `/api/export/${layout}?format=png&qr=${qr}`),
        prepare: await fileStatus(c2, `/api/export/${layout}?format=png&qr=${qr}&prepare=1`),
        all: await fileStatus(c2, `/api/export/all/${qr}`),
      };
      const page = await p2.goto(`${BASE}/create/export?qr=${qr}&layout=${layout}`, { waitUntil: "networkidle" });
      const codePage = await p2.goto(`${BASE}/dashboard/qr/${qr}`, { waitUntil: "networkidle" });
      const leaked = (await p2.content()).includes(input);
      const signedOut = await context(null);
      const anon = await fileStatus(signedOut, `/api/export/${layout}?format=png`);
      await signedOut.close();
      evidence.crossAccount = {
        ...statuses,
        exportPage: page?.status(),
        codePage: codePage?.status(),
        leakedContent: leaked,
        signedOut: anon,
      };
      ok(
        Object.values(statuses).every((s) => s === 404),
        `file routes ${JSON.stringify(statuses)}`,
      );
      ok(!leaked, "the other account sees the code's content");
      ok(anon === 401, `signed out ${anon}`);
      await shot(p2, "other-account");
      await c2.close();
      return JSON.stringify(evidence.crossAccount);
    },
  );
  await ctx.close();
}
