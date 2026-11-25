import { describe, expect, it } from "vitest";
import { NAVIGATION_CRUMB, sanitizeBreadcrumb, sanitizeEvent, scrubText } from "./sanitize";

const opts = { ownHosts: ["heyqr.app", "hqr.to", "localhost:3000"] };
// Secret-shaped test values, assembled so no real-looking credential sits in the source.
const KEY = ["hqk", "AbCdEf123456", "s3cr3tPartThatIsLongEnough_xyz"].join("_");
const STRIPE = ["sk", "test", "51NzAbCdEfGhIjKlMn"].join("_");
const WHSEC = ["whsec", "AbCdEfGhIjKlMnOp"].join("_");
const SIGNED = "https://bucket.r2.cloudflarestorage.com/paid/u1/f.png?X-Amz-Signature=abc123&X-Amz-Credential=AKIA";

describe("monitoring sanitizer (HEY-175)", () => {
  it("text: keys, Stripe secrets and ids, emails, database URLs, data URIs and third-party URLs are replaced", () => {
    const text = `boom ${KEY} ${STRIPE} ${WHSEC} cs_test_a1B2c3D4e5F6g7 pi_3OabcdEFGH12 owner@example.com postgres://u:p@db/x data:image/png;base64,iVBORw0KGgo= https://littlefern.cafe/menu?table=4 ${SIGNED} https://heyqr.app/dashboard/qr/Q8d3abcXyZ12?checkout=success Bearer abc.def.ghi`;
    const out = scrubText(text, opts);
    for (const leaked of [
      KEY,
      STRIPE,
      WHSEC,
      "cs_test_a1B2",
      "pi_3Oabcd",
      "owner@example.com",
      "postgres://",
      "base64",
      "littlefern",
      "X-Amz",
      "r2.cloudflare",
      "Q8d3abc",
      "checkout=success",
      "abc.def.ghi",
    ])
      expect(out, leaked).not.toContain(leaked);
    expect(out).toContain("https://heyqr.app/dashboard/qr/[id]");
    expect(out).toContain("[external-url]");
  });

  it("events: request cookies, headers, body and query, the user, and local variables never leave", () => {
    const event = {
      message: `checkout failed for ${KEY}`,
      request: {
        method: "POST",
        url: "https://heyqr.app/api/stripe/webhook?sig=1",
        headers: { cookie: "better-auth.session_token=abc", authorization: `Bearer ${KEY}`, "stripe-signature": "t=1,v1=x" },
        cookies: { "better-auth.session_token": "abc" },
        data: { type: "checkout.session.completed", data: { object: { customer_details: { email: "a@b.co" }, amount_total: 499 } } },
        query_string: "sig=1",
      },
      user: { id: "u1", email: "a@b.co", ip_address: "203.0.113.7" },
      exception: {
        values: [
          {
            type: "Error",
            value: `deliver failed ${SIGNED}`,
            stacktrace: { frames: [{ function: "f", vars: { destination: "https://x.example", key: KEY } }] },
          },
        ],
      },
      tags: { operation: "stripe.webhook.fulfill", alert: "critical", correlation_id: "evt_1QabcDEF234" },
      extra: { destination: "https://littlefern.cafe/menu", note: `pwd ${STRIPE}` },
    };
    const out = sanitizeEvent(event, opts);
    const json = JSON.stringify(out);
    for (const leaked of [
      KEY,
      STRIPE,
      "session_token",
      "stripe-signature",
      "customer_details",
      "amount_total",
      "a@b.co",
      "203.0.113.7",
      "X-Amz",
      "littlefern",
      "x.example",
      "sig=1",
    ])
      expect(json, leaked).not.toContain(leaked);
    expect(out.request).toEqual({ method: "POST", url: "https://heyqr.app/api/stripe/webhook" });
    expect("user" in out).toBe(false);
    // What identifies the failure stays.
    expect(out.tags).toEqual({ operation: "stripe.webhook.fulfill", alert: "critical", correlation_id: "evt_1QabcDEF234" });
    expect(out.exception.values[0]?.type).toBe("Error");
    expect(out.exception.values[0]?.stacktrace.frames[0]).toEqual({ function: "f" });
  });

  it("messages: failed-query parameters, quoted values, QR payloads, other URL schemes and own relative paths", () => {
    const cases: [string, string][] = [
      ["Failed query: select * from qr_code where short_code = $1\nparams: AbCdEf2,hunter2", "hunter2"],
      ['URL is malformed "menu.littlefern.cafe/secret"', "littlefern"],
      ["bad WIFI:T:WPA;S:Cafe;P:hunter2;;", "hunter2"],
      ["cannot open heyapp://table/4?key=hunter2", "hunter2"],
      ["card 4242 4242 4242 4242 declined", "4242"],
      ["failed at /de/create/export?checkout=success&session_id=cs_test_abcdefgh1 for /r/AbCdEf2", "AbCdEf2"],
    ];
    for (const [text, leaked] of cases) expect(scrubText(text, opts), text).not.toContain(leaked);
    expect(scrubText(cases[5]?.[0] ?? "", opts)).toBe("failed at /create/export for /r/[code]");
    // What says where the code broke stays.
    expect(scrubText("Cannot read properties of undefined (reading 'layout')", opts)).toContain("'layout'");
  });

  it("is an allowlist: unknown fields, host names, transactions, extra and foreign contexts are left out", () => {
    const out = JSON.stringify(
      sanitizeEvent(
        {
          message: "x",
          server_name: "leak-host",
          transaction: "GET /r/leak-code",
          extra: { __serialized__: { pass: "leak-extra" } },
          contexts: { nextjs: { request_path: "/leak-ctx" }, trace: { trace_id: "t1", data: { url: "leak-trace" } } },
          breadcrumbs: [
            { category: "console", message: "leak-console" },
            { category: "ui.click", message: "leak-click" },
          ],
          exception: { values: [{ type: "Error", value: "x", mechanism: { type: "generic", data: { a: "leak-mech" } } }] },
          future_field: "leak-future",
        },
        opts,
      ),
    );
    expect(out).not.toContain("leak");
    expect(out).toContain("t1");
  });

  it("stack frames keep HeyQR's own bundle paths (for source lookup), never a query or a third party's address", () => {
    const frames = [
      { filename: "https://heyqr.app/_next/static/chunks/0a1b2c3d4e.js?dpl=x", lineno: 1 },
      { filename: "https://evil.example/x.js", lineno: 2 },
    ];
    const out = sanitizeEvent({ exception: { values: [{ type: "E", stacktrace: { frames } }] } }, opts);
    expect(out.exception.values[0]?.stacktrace.frames.map((f) => f.filename)).toEqual([
      "https://heyqr.app/_next/static/chunks/0a1b2c3d4e.js",
      "[external-url]",
    ]);
  });

  it("breadcrumbs: only HeyQR's navigation steps, as route templates", () => {
    expect(sanitizeBreadcrumb({ category: "fetch", data: { url: SIGNED }, message: SIGNED }, opts)).toBeNull();
    const out = sanitizeBreadcrumb({ category: NAVIGATION_CRUMB, message: "push /dashboard/qr/Q8d3abc?x=1", data: { to: SIGNED } }, opts);
    expect(out).toEqual({ category: NAVIGATION_CRUMB, message: "push /dashboard/qr/[id]" });
  });
});
