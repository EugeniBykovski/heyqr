import * as Sentry from "@sentry/nextjs";
import { NextRequest } from "next/server";
import StripeSdk from "stripe";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { monitoringOptions } from "@/shared/lib/monitoring/options";

/*
 * HEY-175: controlled failures through the real route handlers, the real Sentry client and a test transport: what is
 * asserted is the serialized envelope that would leave the process.
 */
const SECRET = "whsec_test_only_hey175_not_a_real_secret";
const sdk = new StripeSdk("sk_test_unused_hey175");
const LEAKS = [
  "littlefern",
  "hunter2",
  "cs_test_hey175",
  "AbCdEf2",
  "buyer@example.test",
  "X-Amz",
  "session_token",
  SECRET,
  "amount_total",
];

const sdkState = vi.hoisted(() => ({ broken: false }));
vi.mock("@sentry/nextjs", async (original) => {
  const real = await original<typeof import("@sentry/nextjs")>();
  return {
    ...real,
    captureException: (...a: Parameters<typeof real.captureException>) => {
      if (sdkState.broken) throw new Error("sdk broke");
      return real.captureException(...a);
    },
  };
});
vi.mock("server-only", () => ({}));
vi.mock("@/env", () => ({ env: { NEXT_PUBLIC_APP_URL: "http://localhost:3000" } }));
vi.mock("@/server/config", () => ({
  isConfigured: () => true,
  paymentsConfig: () => ({ STRIPE_WEBHOOK_SECRET: SECRET }),
}));
vi.mock("@/server/billing/stripe", () => ({ stripe: () => sdk }));
const tx = vi.fn();
const findQr = vi.fn();
vi.mock("@/server/db", () => ({
  db: { transaction: () => tx(), query: { qrCode: { findFirst: () => findQr() } } },
  schema: { qrCode: { shortCode: "short_code" } },
}));
vi.mock("@/server/billing/catalog", () => ({ planForPrice: () => null }));
vi.mock("@/server/email/send", () => ({ sendPurchaseReceipt: async () => undefined }));
const recordScan = vi.fn();
const getLayoutWithQr = vi.fn();
vi.mock("@/server/qr/repository", () => ({ recordScan: () => recordScan(), getLayoutWithQr: () => getLayoutWithQr() }));
vi.mock("@/server/auth", () => ({ getSession: async () => ({ user: { id: "u1" } }) }));
const canDownload = vi.fn();
vi.mock("@/server/billing/entitlements", () => ({ canDownload: () => canDownload() }));
const deliver = vi.fn();
vi.mock("@/server/qr/layout-export", () => ({ deliverLayoutExport: () => deliver() }));
class CatalogError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}
vi.mock("@/server/billing/checkout", () => ({ CatalogError }));

const { POST } = await import("@/app/api/stripe/webhook/route");
const { GET: scan } = await import("@/app/r/[code]/route");
const { GET: exportFile } = await import("@/app/api/export/[layoutId]/route");
const { guard } = await import("@/server/actions/result");
const { reportFailure } = await import("./monitoring");
const { step } = await import("./monitoring-step");
const { onRequestError } = await import("@/instrumentation");

type Sent = { level?: string; release?: string; environment?: string; tags?: Record<string, string>; fingerprint?: string[] };
const raw: string[] = [];
let transportFails = false;
const settings = { dsn: "https://public@sentry.test/1", environment: "test", release: "abc123", ownHosts: ["localhost:3000"] };

beforeAll(() => {
  Sentry.init({
    ...monitoringOptions(settings),
    enableOpenTelemetrySetup: false,
    transport: () => ({
      send: async (envelope: unknown) => {
        if (transportFails) throw new Error("monitoring is down");
        raw.push(JSON.stringify(envelope));
        return { statusCode: 200 };
      },
      flush: async () => true,
    }),
  });
});
afterAll(async () => void (await Sentry.close(100)));
beforeEach(async () => {
  await Sentry.flush(500);
  raw.length = 0;
  transportFails = false;
  for (const m of [tx, findQr, recordScan, getLayoutWithQr, canDownload, deliver]) m.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});

async function sent(): Promise<Sent[]> {
  await Sentry.flush(500);
  for (const envelope of raw) for (const leak of LEAKS) expect(envelope, leak).not.toContain(leak);
  return raw.map((e) => (JSON.parse(e) as [unknown, [unknown, Sent][]])[1][0]?.[1] ?? {});
}

/** As Drizzle and pg throw it: the message carries the parameters. */
const dbError = () =>
  Object.assign(new Error("Failed query: select … where short_code = $1\nparams: AbCdEf2,https://littlefern.cafe/menu,hunter2"), {
    name: "DrizzleQueryError",
    cause: Object.assign(new Error("connection terminated"), { code: "57P01" }),
  });

const payload = JSON.stringify({
  id: "evt_hey175abc",
  object: "event",
  type: "checkout.session.completed",
  livemode: false,
  data: {
    object: { id: "cs_test_hey175", payment_status: "paid", amount_total: 499, customer_details: { email: "buyer@example.test" } },
  },
});
const webhook = (event = payload) =>
  POST(
    new Request("http://localhost:3000/api/stripe/webhook?token=hunter2", {
      method: "POST",
      body: event,
      headers: {
        "stripe-signature": sdk.webhooks.generateTestHeaderString({ payload: event, secret: SECRET }),
        cookie: "session_token=hunter2",
      },
    }),
  );
const open = () => scan(new NextRequest("http://localhost:3000/r/AbCdEf2"), { params: Promise.resolve({ code: "AbCdEf2" }) } as never);
const download = () =>
  exportFile(new NextRequest("http://localhost:3000/api/export/l1?format=png"), { params: Promise.resolve({ layoutId: "l1" }) } as never);
const record = { qrCode: { id: "q1", userId: "u1" } };

describe("Stripe webhook fulfillment", () => {
  it("a failed transaction is one critical event with the step and Stripe event id, and still fails so Stripe retries", async () => {
    tx.mockImplementation(() =>
      step("webhook.claim", () => {
        throw dbError();
      }),
    );
    await expect(webhook()).rejects.toThrow("Failed query");
    const events = await sent();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      level: "fatal",
      environment: "test",
      release: "abc123",
      tags: {
        alert: "critical",
        operation: "stripe.webhook.fulfill",
        step: "webhook.claim",
        route: "/api/stripe/webhook",
        event_type: "checkout.session.completed",
        correlation_id: "evt_hey175abc",
        error_code: "57P01",
      },
    });
  });

  it("Stripe's retry of the same failure groups with it; the recovered retry answers 200", async () => {
    tx.mockRejectedValueOnce(dbError())
      .mockRejectedValueOnce(dbError())
      .mockResolvedValueOnce({ duplicate: false, result: { granted: true } });
    await expect(webhook()).rejects.toThrow();
    await expect(webhook()).rejects.toThrow();
    expect((await webhook()).status).toBe(200);
    const events = await sent();
    expect(events).toHaveLength(2); // every failure counts, in one issue
    expect(new Set(events.map((e) => e.fingerprint?.join())).size).toBe(1);
  });

  it("paid but refused is critical and still acknowledged; expected refusals are silent or low", async () => {
    const outcome = async (reason: string) => {
      raw.length = 0;
      tx.mockResolvedValueOnce({ duplicate: false, result: { granted: false, reason } });
      const res = await webhook();
      expect([res.status, await res.json()]).toEqual([200, { received: true, duplicate: false }]);
      return (await sent()).map((e) => e.tags?.alert);
    };
    expect(await outcome("total_mismatch")).toEqual(["critical"]);
    expect(await outcome("no_order")).toEqual(["critical"]);
    expect(await outcome("slot_full")).toEqual(["low"]);
    for (const reason of ["already_paid", "not_paid", "subscription_ended"]) expect(await outcome(reason), reason).toEqual([]);
  });

  it("a bad signature is 400 as before and never critical", async () => {
    const res = await POST(
      new Request("http://localhost:3000/api/stripe/webhook", {
        method: "POST",
        body: payload,
        headers: { "stripe-signature": "t=1,v1=x" },
      }),
    );
    expect(res.status).toBe(400);
    expect((await sent()).map((e) => e.tags?.alert)).toEqual(["low"]);
  });
});

describe("Checkout creation", () => {
  it("an unexpected Stripe failure is critical with its step and code; the action's answer is unchanged", async () => {
    const result = await guard(
      () =>
        step("stripe.session_create", () => {
          throw Object.assign(new Error("No such customer: 'cus_AbCdEfGhIjk' buyer@example.test"), { code: "resource_missing" });
        }),
      "checkout.create",
    );
    expect(result).toEqual({ ok: false, error: "failed" });
    expect(await sent()).toMatchObject([
      { tags: { alert: "critical", operation: "checkout.create", step: "stripe.session_create", error_code: "resource_missing" } },
    ]);
    expect(raw[0]).not.toContain("cus_AbC");
  });

  it("signed out, not for sale, owned and processing aren't reported; a mismatched Stripe Price is critical", async () => {
    await guard(async () => {
      throw Object.assign(new Error("Sign in required"), { name: "UnauthorizedError" });
    }, "checkout.create");
    await guard(async () => {
      throw new CatalogError("not_offered");
    }, "checkout.create");
    for (const error of ["owned", "processing"] as const) await guard(async () => ({ ok: false, error }), "checkout.create");
    expect(await sent()).toEqual([]);
    await guard(async () => {
      throw new CatalogError("price_mismatch");
    }, "checkout.create");
    expect((await sent()).map((e) => e.tags?.alert)).toEqual(["critical"]);
  });
});

describe("public QR resolution", () => {
  it("a failed lookup is reported as high without the code, and fails as before", async () => {
    findQr.mockRejectedValue(dbError());
    await expect(open()).rejects.toThrow("Failed query");
    expect(await sent()).toMatchObject([{ tags: { alert: "high", operation: "qr.resolve", route: "/r/[code]", error_code: "57P01" } }]);
  });

  it("unknown, paused and deleted codes redirect to the unavailable page and report nothing", async () => {
    for (const qr of [
      undefined,
      { status: "paused", destination: "https://littlefern.cafe" },
      { status: "active", deletedAt: new Date() },
    ]) {
      findQr.mockResolvedValueOnce(qr);
      const res = await open();
      expect([res.status, res.headers.get("location")]).toEqual([302, "http://localhost:3000/link-unavailable"]);
    }
    expect(await sent()).toEqual([]);
  });
});

describe("paid export", () => {
  it("authorization and delivery failures are high with their step; the error is rethrown", async () => {
    getLayoutWithQr.mockResolvedValue(record);
    canDownload.mockRejectedValueOnce(dbError());
    await expect(download()).rejects.toThrow();
    canDownload.mockResolvedValue(true);
    deliver.mockImplementation(() =>
      step("storage.put", () => {
        throw Object.assign(new Error("PUT https://bucket.r2.test/paid/f.png?X-Amz-Signature=hunter2 failed"), { name: "StorageError" });
      }),
    );
    await expect(download()).rejects.toThrow();
    expect((await sent()).map((e) => [e.tags?.operation, e.tags?.step, e.tags?.alert, e.tags?.route])).toEqual([
      ["export.authorize", undefined, "high", "/api/export/[id]"],
      ["export.deliver", "storage.put", "high", "/api/export/[id]"],
    ]);
  });

  it("402 and 404 are answers: nothing is reported", async () => {
    getLayoutWithQr.mockResolvedValueOnce(undefined).mockResolvedValueOnce(record);
    canDownload.mockResolvedValue(false);
    expect([(await download()).status, (await download()).status]).toEqual([404, 402]);
    expect(await sent()).toEqual([]);
  });
});

describe("monitoring never changes an outcome", () => {
  it("a failing transport, an unsendable event and a frozen error leave responses and retries as they were", async () => {
    transportFails = true;
    tx.mockRejectedValue(dbError());
    await expect(webhook()).rejects.toThrow("Failed query");
    findQr.mockResolvedValue(undefined);
    expect((await open()).status).toBe(302);
    canDownload.mockResolvedValue(false);
    getLayoutWithQr.mockResolvedValue(record);
    expect((await download()).status).toBe(402);
    for (const e of [Object.freeze(new Error("x")), null, "text", 5])
      expect(() => reportFailure(e, { operation: "t", severity: "low" })).not.toThrow();
    const broken = monitoringOptions(settings).beforeSend({
      get tags() {
        throw new Error("boom");
      },
    });
    expect(broken).toBeNull();
  });

  it("a capture that throws never reaches the caller", async () => {
    sdkState.broken = true;
    expect(() => reportFailure(new Error("x"), { operation: "t", severity: "low" })).not.toThrow();
    findQr.mockRejectedValue(dbError());
    await expect(open()).rejects.toThrow("Failed query");
    sdkState.broken = false;
  });
});

it("the SDK collects no personal or request data by itself and adds no headers to outgoing calls", () => {
  const o = monitoringOptions(settings);
  expect(o.dataCollection).toMatchObject({
    userInfo: false,
    cookies: false,
    httpHeaders: false,
    httpBodies: [],
    stackFrameVariables: false,
  });
  expect(o.tracePropagationTargets).toEqual([]);
  const kept = o.integrations(
    ["Dedupe", "Http", "Console", "RequestData", "BrowserSession", "OnUncaughtException", "LinkedErrors"].map((name) => ({ name })),
  );
  expect(kept).toEqual([{ name: "LinkedErrors" }]);
});

describe("onRequestError", () => {
  const context = {
    routerKind: "App Router",
    routePath: "/[locale]/(account)/dashboard/qr/[id]",
    routeType: "render",
    renderSource: "react-server-components",
    revalidateReason: undefined,
    renderType: "dynamic",
  } as unknown as Parameters<typeof onRequestError>[2];
  const request = {
    path: "/dashboard/qr/Q1?checkout=success&session_id=cs_test_hey175",
    method: "GET",
    headers: { cookie: "session_token=hunter2" },
  };
  it("page failures carry the route, area and digest; control flow and already reported errors don't repeat", async () => {
    vi.stubEnv("SENTRY_DSN", settings.dsn);
    try {
      await onRequestError(Object.assign(dbError(), { digest: "1234567" }), request, context);
      expect(await sent()).toMatchObject([
        {
          tags: {
            alert: "high",
            area: "checkout_return",
            route: "/dashboard/qr/[id]",
            correlation_id: "1234567",
            operation: "request.render",
          },
        },
      ]);
      raw.length = 0;
      await onRequestError(Object.assign(new Error("NEXT_REDIRECT"), { digest: "NEXT_REDIRECT;replace;/x;307;" }), request, context);
      const done = dbError();
      reportFailure(done, { operation: "qr.resolve", severity: "high" });
      await onRequestError(done, request, context);
      expect((await sent()).map((e) => e.tags?.operation)).toEqual(["qr.resolve"]);
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
