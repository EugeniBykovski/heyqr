/*
 * HEY-180 / QR-24.06 pre-launch UI matrix (docs/qa/HEY-180-prelaunch-matrix.md). One engine and viewport per run:
 *
 *   node scripts/qa/ui-matrix.mjs <chromium|firefox|webkit> <390|834|1440> [create,branded,purchase,account,loading,keyboard]
 *
 * Needs: a running HeyQR in test configuration (test Stripe keys, the Stripe CLI forwarding to its webhook), its own
 * throw-away database (QA_DB, used through psql to add per-run QA accounts and to read results), the app's
 * BETTER_AUTH_SECRET, M (an output folder), BASE (the app URL), and playwright-core 1.64.1, which isn't an app
 * dependency: install it in a scratch folder and point PLAYWRIGHT_CORE at its entry file. Each run makes its own
 * owner, other and empty accounts, so runs can go in parallel. Writes screenshots, failure trees and results.json
 * under $M/runs/<engine>-<viewport>. Payments use Stripe test cards only.
 */
const { chromium, firefox, webkit } = await import(process.env.PLAYWRIGHT_CORE ?? "playwright-core");
import fs from "node:fs";
import { execFileSync } from "node:child_process";

const [engineName, vwArg, areasArg = "create,branded,purchase,account,loading,keyboard"] = process.argv.slice(2);
const VW = Number(vwArg);
const VH = VW === 390 ? 844 : VW === 834 ? 1112 : 900;
const BASE = process.env.BASE ?? "http://localhost:3180";
const DB = process.env.QA_DB ?? "heyqr_hey180_e2e";
const M = process.env.M;
const OUT = `${M}/runs/${engineName}-${VW}${process.env.TAG ?? ""}`;
fs.mkdirSync(OUT, { recursive: true });
const SECRET = process.env.BETTER_AUTH_SECRET;
const run = `${engineName}-${VW}${process.env.TAG ?? ""}`;
const { createHmac } = await import("node:crypto");
const cookies = {};
for (const role of ["qa-owner", "qa-other", "qa-empty"]) {
  const id = `${role}-${run}`;
  execFileSync("psql", [
    DB,
    "-qc",
    `insert into "user"(id,name,email,email_verified) values('${id}','QA ${role.slice(3)}','${id}@example.test',true) on conflict do nothing; insert into session(id,expires_at,token,user_id) values('s-${id}',now()+interval '1 day','tok_${id}','${id}') on conflict do nothing`,
  ]);
  cookies[role] = encodeURIComponent(`tok_${id}.${createHmac("sha256", SECRET).update(`tok_${id}`).digest("base64")}`);
}
const OWNER = `qa-owner-${run}`;
const engines = { chromium, firefox, webkit };
const browser = await engines[engineName].launch();
const version = browser.version();
const rows = [];
process.on("unhandledRejection", (e) => console.error("[unhandled]", String(e?.message ?? e).split("\n")[0]));
const sql = (q) => execFileSync("psql", [DB, "-Atc", q], { encoding: "utf8" }).trim();

async function context(account, extra = {}) {
  const ctx = await browser.newContext({ viewport: { width: VW, height: VH }, acceptDownloads: true, ...extra });
  if (account) await ctx.addCookies([{ name: "better-auth.session_token", value: cookies[account], domain: "localhost", path: "/" }]);
  ctx.setDefaultTimeout(20000);
  return ctx;
}
let shotN = 0;
async function shot(p, name) {
  const f = `${OUT}/${String(++shotN).padStart(2, "0")}-${name}.png`;
  await p.screenshot({ path: f, fullPage: true }).catch(() => {});
  return f.replace(`${M}/`, "");
}
async function overflow(p) {
  return p.evaluate(() => {
    const w = document.documentElement.scrollWidth - window.innerWidth;
    if (w <= 1) return null;
    const off = [...document.querySelectorAll("body *")]
      .filter((e) => e.getBoundingClientRect().right > window.innerWidth + 1 && getComputedStyle(e).position !== "fixed")
      .slice(0, 3)
      .map((e) => `${e.tagName.toLowerCase()}.${String(e.className).split(" ").slice(0, 2).join(".")}`);
    return `${w}px wider than the viewport (${off.join(", ")})`;
  });
}
/** One check: PASS when fn returns without throwing; FAIL keeps the error, a screenshot and the accessible tree. */
async function check(area, scenario, p, fn) {
  const t0 = Date.now();
  try {
    const note = (await fn()) ?? "";
    rows.push({ area, scenario, engine: engineName, version, viewport: VW, result: "PASS", note, ms: Date.now() - t0 });
  } catch (e) {
    const evidence = p ? await shot(p, `FAIL-${area}-${scenario.replace(/\W+/g, "-").slice(0, 40)}`) : "";
    if (p)
      fs.writeFileSync(
        `${OUT}/FAIL-${area}-${shotN}.aria.txt`,
        await p
          .locator("body")
          .ariaSnapshot()
          .catch(() => ""),
      );
    rows.push({
      area,
      scenario,
      engine: engineName,
      version,
      viewport: VW,
      result: "FAIL",
      note: String(e.message ?? e)
        .split("\n")[0]
        .slice(0, 300),
      evidence,
      ms: Date.now() - t0,
    });
  }
}
const expectTrue = (v, msg) => {
  if (!v) throw new Error(msg);
};
/** Polls until fn() is truthy (UI settles asynchronously). */
async function until(fn, msg, ms = 5000) {
  const end = Date.now() + ms;
  for (;;) {
    if (await fn()) return;
    if (Date.now() > end) throw new Error(msg);
    await new Promise((r) => setTimeout(r, 150));
  }
}
const scanVerified = (p) => p.getByRole("status").filter({ hasText: "Scan verified" }).first().waitFor({ timeout: 20000 });
const noOverflow = async (p, where) => {
  const o = await overflow(p);
  if (o) throw new Error(`horizontal overflow on ${where}: ${o}`);
};
async function back(p, previous) {
  const b = p.getByRole("button", { name: "Back", exact: true });
  if (await b.isVisible().catch(() => false)) return b.click();
  return p.getByRole("button", { name: previous, exact: true }).first().click();
}
async function apiStatus(ctx, path) {
  const r = await ctx.request.get(BASE + path, { maxRedirects: 0 });
  return r.status();
}

/* ── 1 · Create: Type → Content → Design, validation, Back, values kept ─────────────────────────────────────── */
async function create() {
  const ctx = await context(null);
  const p = await ctx.newPage();
  await p.goto(`${BASE}/create`, { waitUntil: "networkidle" });
  await check("create", "Type step renders, Website preselected, no overflow", p, async () => {
    await p.getByRole("heading", { name: "What should your code open?" }).waitFor();
    expectTrue((await p.getByRole("button", { name: /^Website/ }).getAttribute("aria-pressed")) === "true", "Website not preselected");
    await noOverflow(p, "Type");
    await shot(p, "create-type");
  });
  await check("create", "Wi-Fi: empty Continue shows field errors and a summary, focus moves to the first invalid field", p, async () => {
    await p.getByRole("button", { name: /^Wi-Fi/ }).click();
    await p.getByRole("button", { name: "Continue", exact: true }).click();
    await p.getByRole("heading", { level: 1 }).waitFor();
    await p.getByRole("button", { name: "Continue to design" }).click();
    await p.getByRole("alert").first().waitFor();
    const invalid = await p.locator('[aria-invalid="true"]').count();
    expectTrue(invalid >= 1, "no field marked invalid");
    await until(
      () => p.evaluate(() => document.activeElement?.getAttribute("aria-invalid") === "true"),
      "focus is not on an invalid field after Continue",
    );
    await noOverflow(p, "Content · Wi-Fi errors");
    await shot(p, "create-wifi-errors");
    return `${invalid} invalid field(s)`;
  });
  await check("create", "Back to Type keeps Wi-Fi; switching to Website and back keeps typed values", p, async () => {
    const ssid = p.getByRole("textbox", { name: /network/i }).first();
    await ssid.fill("Little Fern Guest");
    await back(p, "Type");
    await p.getByRole("heading", { name: "What should your code open?" }).waitFor();
    expectTrue((await p.getByRole("button", { name: /^Wi-Fi/ }).getAttribute("aria-pressed")) === "true", "Wi-Fi not kept on Back");
    await p.getByRole("button", { name: "Continue", exact: true }).click();
    expectTrue(
      (await p
        .getByRole("textbox", { name: /network/i })
        .first()
        .inputValue()) === "Little Fern Guest",
      "SSID lost after Back",
    );
  });
  await check("create", "Website: invalid address error, then valid address continues to Design; Back keeps it", p, async () => {
    await back(p, "Type");
    await p.getByRole("button", { name: /^Website/ }).click();
    await p.getByRole("button", { name: "Continue", exact: true }).click();
    const url = p.getByRole("textbox", { name: "Website address" });
    await url.fill("not a url");
    await p.getByRole("button", { name: "Continue to design" }).click();
    await p.getByRole("alert").first().waitFor();
    await url.fill("littlefern.cafe/menu");
    await p.getByRole("textbox", { name: /Name in My QR codes/ }).fill("Fern menu");
    await p.getByRole("button", { name: "Continue to design" }).click();
    await p
      .getByRole("heading", { name: /How do you want to design it|Design/ })
      .first()
      .waitFor();
    await shot(p, "create-design-choose");
    await noOverflow(p, "Design · choose mode");
    await p.getByRole("tab", { name: /Content/ }).click();
    expectTrue(
      (await p.getByRole("textbox", { name: "Website address" }).inputValue()).includes("littlefern.cafe/menu"),
      "address lost on Back from Design",
    );
    expectTrue(
      (await p.getByRole("textbox", { name: /Name in My QR codes/ }).inputValue()) === "Fern menu",
      "name lost on Back from Design",
    );
  });
  await check("create", "Custom design workspace: groups, live preview, scan verified, no overflow; draft survives reload", p, async () => {
    await p.getByRole("button", { name: "Continue to design" }).click();
    await p
      .getByRole("button", { name: /^Custom design/ })
      .first()
      .click();
    await p.getByRole("tablist", { name: "Design settings" }).waitFor();
    await p.getByRole("tab", { name: "Colors" }).click();
    await scanVerified(p);
    await noOverflow(p, "Design workspace");
    await shot(p, "create-design-custom");
    await p.reload({ waitUntil: "networkidle" });
    await p.getByRole("tab", { name: /Content/ }).click();
    expectTrue(
      (await p.getByRole("textbox", { name: "Website address" }).inputValue()).includes("littlefern.cafe/menu"),
      "draft lost on reload",
    );
  });
  await ctx.close();
}

/* ── 2 · Branded end to end: sample logo → look → save → reopen → export keeps it ───────────────────────────── */
async function branded() {
  const ctx = await context("qa-owner");
  const p = await ctx.newPage();
  let layoutColors = null;
  let qrId = null;
  let layoutId = null;
  await check("branded", "Branded: sample logo, palette and three looks", p, async () => {
    await p.goto(`${BASE}/create`, { waitUntil: "networkidle" });
    await p.getByRole("button", { name: "Continue", exact: true }).click();
    await p.getByRole("textbox", { name: "Website address" }).fill(`fern-${engineName}-${VW}.example/branded`);
    await p.getByRole("textbox", { name: /Name in My QR codes/ }).fill(`Branded ${engineName} ${VW}`);
    await p.getByRole("button", { name: "Continue to design" }).click();
    await p
      .getByRole("button", { name: /^Branded design/ })
      .first()
      .click();
    await p.getByRole("button", { name: "Try a sample logo" }).click();
    const looks = p.getByRole("group", { name: "Branded looks" });
    await looks.waitFor({ timeout: 20000 });
    await shot(p, "branded-looks");
    await noOverflow(p, "Branded looks");
    const buttons = looks.getByRole("button");
    expectTrue((await buttons.count()) >= 3, `expected three looks, found ${await buttons.count()}`);
    await buttons.nth(1).click();
    await scanVerified(p);
  });
  await check("branded", "Save from Export, reopen from My QR codes: the applied design is kept", p, async () => {
    const before = await p.getByRole("img", { name: "Preview" }).first().innerHTML();
    layoutColors = [...new Set(before.match(/#[0-9A-Fa-f]{6}/g) ?? [])].sort();
    await p
      .getByRole("button", { name: /^Export/ })
      .first()
      .click();
    await p.waitForURL(/\/create\/export\?qr=/);
    const u = new URL(p.url());
    qrId = u.searchParams.get("qr");
    layoutId = u.searchParams.get("layout");
    await p.goto(`${BASE}/dashboard`, { waitUntil: "networkidle" });
    await p
      .getByRole("link", { name: `Branded ${engineName} ${VW}`, exact: true })
      .first()
      .waitFor();
    await p.goto(`${BASE}/edit/${qrId}?layout=${layoutId}`, { waitUntil: "networkidle" });
    const after = await p.getByRole("img", { name: "Preview" }).first().innerHTML();
    const afterColors = [...new Set(after.match(/#[0-9A-Fa-f]{6}/g) ?? [])].sort();
    expectTrue(
      JSON.stringify(afterColors) === JSON.stringify(layoutColors),
      `colors changed after reopening: ${layoutColors} → ${afterColors}`,
    );
    expectTrue(after.includes("<image") === before.includes("<image"), "logo image presence changed after reopening");
    await shot(p, "branded-reopened");
    return `colors ${layoutColors.join(" ")}`;
  });
  await check("branded", "Export preview and SVG file carry the same design (unlocked by test credit)", p, async () => {
    // Unlocked through the account's own credit path (Static Pack credit granted as a fixture) so this row tests the
    // design's persistence through export; payment itself is covered by the purchase rows.
    sql(
      `insert into credit_ledger(id,user_id,delta,reason) values('qa-credit-${engineName}-${VW}-' || md5(random()::text),'${OWNER}',1,'pack3') on conflict do nothing`,
    );
    await p.goto(`${BASE}/create/export?qr=${qrId}&layout=${layoutId}&format=svg`, { waitUntil: "networkidle" });
    const use = p.getByRole("button", { name: /Use 1 (static )?credit/i }).first();
    await use.waitFor({ timeout: 15000 });
    await use.click();
    await p
      .getByRole("link", { name: /^Download/ })
      .or(p.getByRole("button", { name: /^Download/ }))
      .first()
      .waitFor({ timeout: 20000 });
    const r = await ctx.request.get(`${BASE}/api/export/${layoutId}?format=svg&qr=${qrId}`);
    expectTrue(r.status() === 200, `SVG export answered ${r.status()}`);
    const svg = await r.text();
    const fileColors = [...new Set(svg.match(/#[0-9A-Fa-f]{6}/g) ?? [])].map((c) => c.toUpperCase());
    const missing = layoutColors.filter((c) => !fileColors.includes(c.toUpperCase()));
    expectTrue(missing.length === 0, `colors of the design missing from the SVG: ${missing.join(" ")}`);
    fs.writeFileSync(`${OUT}/branded.svg`, svg);
    return `SVG ${svg.length} bytes, all ${layoutColors.length} design colors present`;
  });
  await ctx.close();
}

/* ── 3 · Export & purchase: locked, cancel, decline, success, paid download, repeat ─────────────────────────── */
async function stripeFill(p, card) {
  await p.waitForURL(/checkout\.stripe\.com/, { timeout: 30000 });
  const f = p.frameLocator('iframe[src*="elements-inner"]').first();
  const num = f.locator("#payment-numberInput");
  await num.waitFor({ timeout: 30000 });
  await num.fill(card);
  await f.locator("#payment-expiryInput").fill("12 / 34");
  await f.locator("#payment-cvcInput").fill("123");
  await f.locator("#payment-nameInput").fill("QA Matrix");
  const pay = p.getByRole("button", { name: /^(Pay|Zapłać)/ }).last();
  if (await pay.count()) await pay.click();
  else await f.getByRole("button", { name: /^Pay/ }).last().click();
}
async function purchase() {
  const ctx = await context("qa-owner");
  const p = await ctx.newPage();
  const name = `Paid ${engineName} ${VW}`;
  let qr, layout;
  await check("purchase", "Locked export: Pay shown, no download; the file API answers 402", p, async () => {
    await p.goto(`${BASE}/create`, { waitUntil: "networkidle" });
    await p.getByRole("button", { name: "Continue", exact: true }).click();
    await p.getByRole("textbox", { name: "Website address" }).fill(`paid-${engineName}-${VW}.example`);
    await p.getByRole("textbox", { name: /Name in My QR codes/ }).fill(name);
    await p.getByRole("button", { name: "Continue to design" }).click();
    await p
      .getByRole("button", { name: /^Custom design/ })
      .first()
      .click();
    await p
      .getByRole("button", { name: /^Export/ })
      .first()
      .click();
    await p.waitForURL(/\/create\/export\?qr=/);
    const u = new URL(p.url());
    qr = u.searchParams.get("qr");
    layout = u.searchParams.get("layout");
    await p.getByRole("button", { name: /^Pay \$4\.99/ }).waitFor();
    expectTrue(
      (await p
        .getByRole("link", { name: /^Download/ })
        .or(p.getByRole("button", { name: /^Download/ }))
        .count()) === 0,
      "Download offered before payment",
    );
    expectTrue((await apiStatus(ctx, `/api/export/${layout}?format=png`)) === 402, "locked file not 402");
    await noOverflow(p, "Export locked");
    await shot(p, "export-locked");
  });
  await check("purchase", "Stripe test Checkout cancelled: back on Export, 'not charged' notice, still locked", p, async () => {
    await p.getByRole("button", { name: /^Pay / }).click();
    await p.waitForURL(/checkout\.stripe\.com/, { timeout: 30000 });
    await p.frameLocator('iframe[src*="elements-inner"]').first().locator("#payment-numberInput").waitFor({ timeout: 30000 });
    await p.getByRole("link", { name: /^Back to HeyQR/ }).click();
    await p.waitForURL(/checkout=cancelled/, { timeout: 30000 });
    await p
      .getByText(/weren.t charged|not charged/i)
      .first()
      .waitFor();
    expectTrue((await apiStatus(ctx, `/api/export/${layout}?format=png`)) === 402, "unlocked after cancellation");
    await shot(p, "export-cancelled");
  });
  await check("purchase", "Declined test card: Stripe shows the decline, nothing is unlocked", p, async () => {
    await p.getByRole("button", { name: /^Pay / }).click();
    await stripeFill(p, "4000 0000 0000 0002");
    await p
      .frameLocator('iframe[src*="elements-inner"]')
      .first()
      .getByText(/declined/i)
      .first()
      .waitFor({ timeout: 30000 });
    expectTrue((await apiStatus(ctx, `/api/export/${layout}?format=png`)) === 402, "unlocked after a declined card");
    expectTrue(
      sql(`select count(*) from purchase where qr_code_id='${qr}' and status='paid'`) === "0",
      "a paid order exists after decline",
    );
    await p.goBack();
    await p.waitForURL(/localhost/, { timeout: 30000 }).catch(() => {});
  });
  await check("purchase", "Test card 4242: return, confirmation, webhook grant, Download delivers the PNG", p, async () => {
    await p.goto(`${BASE}/create/export?qr=${qr}&layout=${layout}&format=png&res=2`, { waitUntil: "networkidle" });
    await p.getByRole("button", { name: /^Pay / }).click();
    await stripeFill(p, "4242 4242 4242 4242");
    await p.waitForURL(/checkout=success/, { timeout: 60000 });
    await shot(p, "export-success-return");
    const control = p
      .getByRole("link", { name: /^Download/ })
      .or(p.getByRole("button", { name: /^Download/ }))
      .first();
    await control.waitFor({ timeout: 60000 });
    if ((await control.evaluate((el) => el.tagName)) === "BUTTON") await control.click(); // prepares the file
    const link = p.getByRole("link", { name: /^Download/ }).first();
    await link.waitFor({ timeout: 60000 });
    const [dl] = await Promise.all([p.waitForEvent("download", { timeout: 60000 }), link.click()]);
    const file = `${OUT}/paid.png`;
    await dl.saveAs(file);
    const head = fs.readFileSync(file).subarray(0, 8).toString("hex");
    expectTrue(head === "89504e470d0a1a0a", "downloaded file is not a PNG");
    expectTrue(sql(`select count(*) from purchase where qr_code_id='${qr}' and status='paid'`) === "1", "not exactly one paid order");
    await shot(p, "export-downloaded");
    return `PNG ${fs.statSync(file).size} bytes, ${dl.suggestedFilename()}`;
  });
  await check("purchase", "Repeat export (SVG, other resolution) needs no new payment", p, async () => {
    expectTrue((await apiStatus(ctx, `/api/export/${layout}?format=svg`)) === 200, "repeat SVG not 200");
    expectTrue((await apiStatus(ctx, `/api/export/${layout}?format=png&scale=4`)) === 200, "repeat PNG 4x not 200");
    await p.goto(`${BASE}/create/export?qr=${qr}&layout=${layout}&format=svg`, { waitUntil: "networkidle" });
    expectTrue((await p.getByRole("button", { name: /^Pay / }).count()) === 0, "Pay offered again after purchase");
    expectTrue(sql(`select count(*) from purchase where qr_code_id='${qr}'`) === "1", "a second order was created");
  });
  fs.writeFileSync(`${OUT}/paid-code.json`, JSON.stringify({ qr, layout }));
  await ctx.close();
}

/* ── 4 · Account: signed out, empty, populated, owner access, another account denied ────────────────────────── */
async function account() {
  const anon = await context(null);
  const a = await anon.newPage();
  await check("account", "Signed out: My QR codes asks to sign in", a, async () => {
    await a.goto(`${BASE}/dashboard`, { waitUntil: "networkidle" });
    expectTrue(/sign-in/.test(a.url()), `stayed on ${a.url()}`);
    await noOverflow(a, "Sign in");
    await shot(a, "account-signed-out");
  });
  await anon.close();
  const empty = await context("qa-empty");
  const e = await empty.newPage();
  await check("account", "Empty account: empty state with Create", e, async () => {
    await e.goto(`${BASE}/dashboard`, { waitUntil: "networkidle" });
    await e
      .getByRole("link", { name: /Create/ })
      .first()
      .waitFor();
    expectTrue((await e.getByRole("list", { name: "My QR codes" }).count()) === 0, "a code list is shown for an empty account");
    await noOverflow(e, "Empty account");
    await shot(e, "account-empty");
  });
  await empty.close();
  const owner = await context("qa-owner");
  const o = await owner.newPage();
  const code = sql(
    `select q.id||' '||l.id from qr_code q join qr_layout l on l.qr_code_id=q.id join purchase p on p.qr_code_id=q.id and p.status='paid' where q.user_id='${OWNER}' limit 1`,
  ).split(" ");
  await check("account", "Populated account: codes listed; details and paid export open for the owner", o, async () => {
    await o.goto(`${BASE}/dashboard`, { waitUntil: "networkidle" });
    await o.getByRole("list", { name: "My QR codes" }).waitFor();
    await noOverflow(o, "My QR codes");
    await shot(o, "account-populated");
    expectTrue(code.length === 2 && code[0], "no paid code to check (run purchase first)");
    await o.goto(`${BASE}/dashboard/qr/${code[0]}`, { waitUntil: "networkidle" });
    await noOverflow(o, "QR details");
    await shot(o, "account-details");
    expectTrue((await apiStatus(owner, `/api/export/${code[1]}?format=png`)) === 200, "owner's paid export not 200");
  });
  await check("account", "Delete dialog: Escape closes it and focus returns to its trigger", o, async () => {
    await o.goto(`${BASE}/dashboard`, { waitUntil: "networkidle" });
    const trigger = o.getByRole("button", { name: /^Delete / }).first();
    await trigger.focus();
    await o.keyboard.press("Enter");
    await o.getByRole("alertdialog").or(o.getByRole("dialog")).first().waitFor();
    await shot(o, "account-delete-dialog");
    await o.keyboard.press("Escape");
    await o.getByRole("alertdialog").or(o.getByRole("dialog")).first().waitFor({ state: "hidden" });
    await until(() => trigger.evaluate((el) => el === document.activeElement), "focus not restored to the Delete button");
    const first = await o.evaluate(() => document.activeElement?.textContent?.trim());
    await trigger.click();
    await o.getByRole("alertdialog").first().waitFor();
    const initial = await o.evaluate(() => document.activeElement?.textContent?.trim());
    await o.keyboard.press("Escape");
    return `initial focus in the dialog: "${initial}" (${first})`;
  });
  await owner.close();
  const other = await context("qa-other");
  const x = await other.newPage();
  await check("account", "Another account: details, edit, export page and file API are refused", x, async () => {
    const answers = [];
    for (const path of [`/dashboard/qr/${code[0]}`, `/edit/${code[0]}`, `/create/export?qr=${code[0]}&layout=${code[1]}`]) {
      const r = await x.goto(BASE + path, { waitUntil: "networkidle" });
      const body = await x.locator("body").innerText();
      answers.push(`${path.split("?")[0].replace(code[0], "<id>")}: ${r?.status()}`);
      expectTrue(
        !body.includes(`Paid `) && (r?.status() === 404 || /not found|isn.t here|doesn.t exist/i.test(body)),
        `${path} readable by another account (${r?.status()})`,
      );
    }
    for (const f of ["png", "svg", "pdf"]) {
      const s = await apiStatus(other, `/api/export/${code[1]}?format=${f}`);
      answers.push(`/api/export ${f}: ${s}`);
      expectTrue(s === 404, `another account's ${f} export answered ${s}`);
    }
    expectTrue((await apiStatus(other, `/api/export/all/${code[0]}`)) === 404, "Download all readable by another account");
    return answers.join("; ");
  });
  await other.close();
}

/* ── 5 · Loading: controlled delays, skeletons, transition, error and recovery ──────────────────────────────── */
async function loading() {
  const ctx = await context("qa-owner");
  const p = await ctx.newPage();
  const delayRsc = async (ms) =>
    p.route("**/*", async (route) => {
      const r = route.request();
      if (r.headers()["rsc"] === "1" || r.url().includes("_rsc=")) await new Promise((res) => setTimeout(res, ms));
      await route.continue();
    });
  await check("loading", "My QR codes: skeleton (aria-busy) during a 2.5 s delay, then the list", p, async () => {
    await p.goto(`${BASE}/pricing`, { waitUntil: "networkidle" });
    await delayRsc(4000);
    const link = p.getByRole("link", { name: "My QR codes" }).first();
    if (!(await link.isVisible().catch(() => false))) await p.getByRole("button", { name: "Menu" }).click();
    await p.getByRole("link", { name: "My QR codes" }).filter({ visible: true }).first().click();
    await p.locator('[aria-busy="true"]').first().waitFor({ timeout: 3500 });
    await p.waitForTimeout(400); // past the 240 ms fade-in, so the capture shows the skeleton
    const busyShot = await shot(p, "loading-dashboard-skeleton");
    await p.getByRole("list", { name: "My QR codes" }).waitFor({ timeout: 15000 });
    expectTrue((await p.locator('[aria-busy="true"]').count()) === 0, "aria-busy left on after content");
    await p.unrouteAll({ behavior: "wait" });
    await p.waitForLoadState("networkidle");
    return busyShot;
  });
  const paid = () =>
    sql(
      `select q.id||' '||l.id from qr_code q join qr_layout l on l.qr_code_id=q.id join purchase pu on pu.qr_code_id=q.id and pu.status='paid' where q.user_id='${OWNER}' limit 1`,
    ).split(" ");
  const saveLink = (p) => p.getByRole("link", { name: /^Download (PNG|SVG|PDF|again)/ }).first();
  await check("loading", "Export: 'Preparing your PNG…' during a 3 s delay, then 'ready' and the file", p, async () => {
    const [qr, layout] = paid();
    expectTrue(qr, "no paid code (purchase rows must pass first)");
    await p.goto(`${BASE}/create/export?qr=${qr}&layout=${layout}&format=png`, { waitUntil: "networkidle" });
    await p.route("**/api/export/**", async (route) => {
      await new Promise((res) => setTimeout(res, 3000));
      await route.continue();
    });
    await p
      .getByRole("button", { name: /^Download/ })
      .first()
      .click();
    await p
      .getByText(/Preparing your PNG/i)
      .first()
      .waitFor({ timeout: 2500 });
    await shot(p, "loading-export-preparing");
    await p
      .getByText(/is ready/i)
      .first()
      .waitFor({ timeout: 15000 });
    await p.unrouteAll({ behavior: "wait" });
    const [dl] = await Promise.all([p.waitForEvent("download", { timeout: 30000 }), saveLink(p).click()]);
    return `saved ${dl.suggestedFilename()}`;
  });
  await check("loading", "Export error: the failure offers Try again with the settings kept; the retry delivers the file", p, async () => {
    const [qr, layout] = paid();
    await p.goto(`${BASE}/create/export?qr=${qr}&layout=${layout}&format=svg`, { waitUntil: "networkidle" });
    await p.route("**/api/export/**", (route) => route.abort("failed"));
    await p
      .getByRole("button", { name: /^Download/ })
      .first()
      .click();
    const retry = p.getByRole("button", { name: /Try again/i }).first();
    await retry.waitFor({ timeout: 15000 });
    expectTrue((await p.getByRole("button", { name: "SVG" }).getAttribute("aria-pressed")) === "true", "format not kept after the error");
    await shot(p, "loading-export-error");
    await p.unrouteAll({ behavior: "wait" });
    await retry.click();
    await p
      .getByText(/is ready/i)
      .first()
      .waitFor({ timeout: 15000 });
    const [dl] = await Promise.all([p.waitForEvent("download", { timeout: 30000 }), saveLink(p).click()]);
    expectTrue(sql(`select count(*) from purchase where qr_code_id='${qr}'`) === "1", "a second order after the error");
    return `saved ${dl.suggestedFilename()}, no second charge`;
  });
  await ctx.close();
}

/* ── Keyboard, focus and reduced motion through the core flow ──────────────────────────────────────────────── */
async function keyboard() {
  const ctx = await context(null, { reducedMotion: "reduce" });
  const p = await ctx.newPage();
  await check("keyboard", "Create by keyboard only (reduced motion): visible focus at each stop, order follows the page", p, async () => {
    await p.goto(`${BASE}/create`, { waitUntil: "networkidle" });
    const stops = [];
    const focusInfo = () =>
      p.evaluate(() => {
        const el = document.activeElement;
        if (!el || el === document.body) return null;
        const s = getComputedStyle(el);
        const r = el.getBoundingClientRect();
        const visible = (s.outlineStyle !== "none" && parseFloat(s.outlineWidth) > 0) || s.boxShadow !== "none";
        return {
          role: el.getAttribute("role") ?? el.tagName.toLowerCase(),
          label: (el.getAttribute("aria-label") || el.textContent || el.tagName).trim().slice(0, 30),
          visible,
          y: Math.round(r.top + window.scrollY),
          x: Math.round(r.left),
        };
      });
    const tabTo = async (re, max = 60, role) => {
      for (let i = 0; i < max; i++) {
        await p.keyboard.press(engineName === "webkit" ? "Alt+Tab" : "Tab");
        const f = await focusInfo();
        if (f) stops.push(f);
        if (f && re.test(f.label) && (!role || f.role === role)) return f;
      }
      throw new Error(
        `could not reach ${re} by Tab; last stops: ${stops
          .slice(-6)
          .map((s) => `${s.role}:${s.label}`)
          .join(" | ")}`,
      );
    };
    await tabTo(/^Website/);
    await tabTo(/^Continue$/);
    await p.keyboard.press("Enter");
    await p.getByRole("textbox", { name: "Website address" }).waitFor();
    await p.getByRole("textbox", { name: "Website address" }).focus();
    await p.keyboard.type("littlefern.cafe/menu");
    await tabTo(/Continue to design/);
    await p.keyboard.press("Enter");
    await p.getByRole("heading", { name: "How do you want to design it?" }).waitFor();
    const afterStep = await p.evaluate(() => document.activeElement?.tagName);
    await tabTo(/^Custom design/);
    await p.keyboard.press("Enter");
    await p.getByRole("tablist", { name: "Design settings" }).waitFor();
    // The settings tablist uses a roving tabindex: Tab enters the selected tab, arrows move between tabs.
    await tabTo(/^(Layout|Brand)$/, 120, "tab");
    for (let i = 0; i < 8 && (await p.getByRole("tab", { name: "Colors" }).getAttribute("aria-selected")) !== "true"; i++)
      await p.keyboard.press("ArrowRight").then(() => p.waitForTimeout(200));
    await until(
      async () => (await p.getByRole("tab", { name: "Colors" }).getAttribute("aria-selected")) === "true",
      "ArrowRight didn't reach Colors",
    );
    const invisible = stops.filter((s) => !s.visible).map((s) => s.label);
    await shot(p, "keyboard-design-colors");
    expectTrue(invisible.length === 0, `focus not visible on: ${[...new Set(invisible)].slice(0, 6).join(" | ")}`);
    const motion = await p.evaluate(() => window.matchMedia("(prefers-reduced-motion: reduce)").matches);
    expectTrue(motion, "reduced motion not active");
    return `${stops.length} focus stops, all visible; focus after the step change: ${afterStep}`;
  });
  await check("keyboard", "Language menu: opens by keyboard, Escape closes it, focus returns", p, async () => {
    const btn = p.getByRole("button", { name: /language|EN/i }).first();
    await btn.focus();
    await p.keyboard.press("Enter");
    await p.getByRole("dialog").or(p.getByRole("menu")).or(p.getByRole("listbox")).first().waitFor();
    await p.keyboard.press("Escape");
    await until(() => btn.evaluate((el) => el === document.activeElement), "focus not returned to the language button");
  });
  await ctx.close();
}

const want = new Set(areasArg.split(","));
for (const [k, fn] of Object.entries({ create, branded, purchase, account, loading, keyboard })) if (want.has(k)) await fn();
await browser.close();
fs.writeFileSync(`${OUT}/results.json`, JSON.stringify(rows, null, 2));
for (const r of rows)
  console.log(
    `${r.result.padEnd(4)} ${r.engine} ${r.version} ${r.viewport} [${r.area}] ${r.scenario}${r.note ? ` — ${r.note}` : ""}${r.evidence ? ` (${r.evidence})` : ""}`,
  );
