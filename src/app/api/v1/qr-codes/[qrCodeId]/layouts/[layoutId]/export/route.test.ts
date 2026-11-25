import { beforeEach, describe, expect, it, vi } from "vitest";
import type * as Sdk from "@heyqr/sdk";
import { DEFAULT_DESIGN, designSettingsOf, designToLayout } from "@/entities/qr";

vi.mock("server-only", () => ({}));
vi.mock("@/env", () => ({ env: { NEXT_PUBLIC_APP_URL: "https://heyqr.test" } }));
vi.mock("@/server/db", () => ({ db: {} }));
const KEY = "hqk_AbCdEfGhIjKl_0123456789abcdefghijklmnopqrstuvwxyzABCDEFG";
const apiKeyOwner = vi.fn();
vi.mock("@/server/api-keys/keys", () => ({ apiKeyOwner: (_db: unknown, key: unknown) => apiKeyOwner(key) }));
const takeRequest = vi.fn();
vi.mock("@/server/api/v1/rate-limit", () => ({ takeRequest: (...a: unknown[]) => takeRequest(...a) }));
// The decision (owner, pair, format, entitlement) is covered against PostgreSQL; here it is scripted per request.
const authorizeApiExport = vi.fn();
vi.mock("@/server/api/v1/export", () => ({ authorizeApiExport: (...a: unknown[]) => authorizeApiExport(...a) }));
const getLayoutWithQr = vi.fn();
vi.mock("@/server/qr/repository", () => ({ getLayoutWithQr: (...a: unknown[]) => getLayoutWithQr(...a) }));
const renderExport = vi.fn();
vi.mock("@/server/qr/export", () => ({
  renderExport: (...a: unknown[]) => renderExport(...a),
  encodedValue: () => "menu",
  withEmbeddedImages: async (l: unknown) => l,
  downloadFileName: () => ({ name: "card.png", header: 'attachment; filename="card.png"' }),
  ExportSizeError: class extends Error {},
}));
vi.mock("@/server/print/print", () => ({ layoutPdf: vi.fn() }));
// The real private delivery (layout-export.ts → paid-delivery.ts) over stubbed storage.
vi.mock("@/server/config", () => ({ isConfigured: (what: string) => what === "storage" }));
const stored = new Map<string, string>();
const headObject = vi.fn(async (key: string) => (stored.has(key) ? { contentDisposition: stored.get(key) ?? null } : null));
const putObject = vi.fn(async (key: string, _b: Buffer, _t: string, d?: string) => void stored.set(key, d ?? ""));
const signedFileUrl = vi.fn(async (key: string) => `https://r2.test/${key}?X-Amz-Expires=120&sig=abc`);
vi.mock("@/server/storage/s3", () => ({
  headObject: (k: string) => headObject(k),
  putObject: (k: string, b: Buffer, t: string, d?: string) => putObject(k, b, t, d),
  signedFileUrl: (k: string) => signedFileUrl(k),
}));
const { GET } = await import("./route");

const record = {
  id: "l-a",
  name: "Card",
  updatedAt: new Date("2026-11-25T10:00:00Z"),
  design: { schemaVersion: 1, layout: designToLayout(DEFAULT_DESIGN), editor: designSettingsOf(DEFAULT_DESIGN) },
  qrCode: { id: "q-a", userId: "user-a", model: "static", content: { type: "text", text: "menu" }, shortCode: null },
};
const call = (query = "format=png", auth: string | null = `Bearer ${KEY}`, pair = { qrCodeId: "q-a", layoutId: "l-a" }) =>
  GET(
    new Request(`http://localhost/api/v1/qr-codes/${pair.qrCodeId}/layouts/${pair.layoutId}/export?${query}`, {
      headers: auth ? { authorization: auth } : {},
    }),
    {
      params: Promise.resolve(pair),
    } as never,
  );
const allowed = { ok: true, options: { format: "png", transparent: false } };
const payment = {
  ok: false,
  error: "payment_required",
  paymentUrl: "https://heyqr.test/create/export?qr=q-a&layout=l-a&format=png",
  qrCodeId: "q-a",
  layoutId: "l-a",
  format: "png",
  mode: "static",
};
/** No file, no stored object read, no signed link: what every refused request must leave untouched. */
const nothingDelivered = () => {
  expect(headObject).not.toHaveBeenCalled();
  expect(putObject).not.toHaveBeenCalled();
  expect(signedFileUrl).not.toHaveBeenCalled();
  expect(renderExport).not.toHaveBeenCalled();
};

beforeEach(() => {
  stored.clear();
  apiKeyOwner.mockReset().mockImplementation(async (key: unknown) => (key === KEY ? "user-a" : null));
  takeRequest.mockReset().mockResolvedValue({ ok: true });
  authorizeApiExport.mockReset().mockResolvedValue(allowed);
  getLayoutWithQr.mockReset().mockResolvedValue(record);
  renderExport.mockReset().mockResolvedValue({ body: Buffer.from("png"), contentType: "image/png", scan: { ok: true } });
  for (const f of [headObject, putObject, signedFileUrl]) f.mockClear();
});

describe("GET …/layouts/{layoutId}/export (HEY-158)", () => {
  it("HEY-178: over either budget: 429 with Retry-After before the decision or anything rendered; an invalid key stays 401", async () => {
    for (const bucket of ["api", "export"]) {
      takeRequest
        .mockReset()
        .mockImplementation(async (_db: unknown, _owner: string, b: string) =>
          b === bucket ? { ok: false, retryAfterSeconds: 17 } : { ok: true },
        );
      const res = await call();
      expect([res.status, res.headers.get("retry-after"), res.headers.get("cache-control")]).toEqual([429, "17", "no-store"]);
      expect(((await res.json()) as { error: object }).error).toMatchObject({ code: "rate_limited", limit: bucket });
      takeRequest.mockClear();
      expect((await call("format=png", "Bearer hqk_nope")).status).toBe(401);
      expect(takeRequest).not.toHaveBeenCalled();
    }
    expect(authorizeApiExport).not.toHaveBeenCalled();
    nothingDelivered();
  });

  it("HEY-178: an unavailable limiter is the API's 500 and nothing is rendered; the key isn't logged", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    takeRequest.mockRejectedValue(new Error(`connection lost ${KEY}`));
    const res = await call();
    expect([res.status, res.headers.get("retry-after")]).toEqual([500, "5"]);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("internal_error");
    expect(JSON.stringify(error.mock.calls)).toContain("api.rate_limit");
    expect(JSON.stringify(error.mock.calls)).not.toContain(KEY);
    error.mockRestore();
    nothingDelivered();
  });

  it("missing, invalid and revoked keys: the shared 401, decided before anything else", async () => {
    const answers = new Set<string>();
    for (const auth of [null, "Bearer hqk_nope", "Bearer hqk_revokedrevok_0123456789abcdefghijklmnopqrstuvwxyzABCDEFG"]) {
      const res = await call("format=png", auth);
      answers.add(`${res.status} ${res.headers.get("location")} ${await res.text()}`);
    }
    expect([...answers]).toEqual([
      '401 null {"error":{"code":"unauthorized","message":"A valid API key is required: Authorization: Bearer <key>."}}',
    ]);
    expect(authorizeApiExport).not.toHaveBeenCalled();
    nothingDelivered();
  });

  it("paid: the private export flow — stored once, then a short-lived signed link; the decision runs with the key's owner", async () => {
    const first = await call();
    expect(first.status).toBe(302);
    expect(first.headers.get("cache-control")).toBe("private, no-store");
    expect(first.headers.get("location")).toMatch(/^https:\/\/r2\.test\/paid\/user-a\/q-a\/l-a\//);
    expect(first.headers.get("location")).not.toContain(KEY);
    expect(authorizeApiExport).toHaveBeenCalledWith(
      {},
      "user-a",
      { qrCodeId: "q-a", layoutId: "l-a", query: { format: "png" } },
      { appUrl: "https://heyqr.test" },
    );
    // Again: the stored file is reused (no second render), but the decision ran again first.
    expect((await call()).status).toBe(302);
    expect(renderExport).toHaveBeenCalledTimes(1);
    expect(authorizeApiExport).toHaveBeenCalledTimes(2);
  });

  it("a stored file after the entitlement is revoked: 402, and the stored file is never read or linked", async () => {
    expect((await call()).status).toBe(302);
    expect(stored.size).toBe(1);
    for (const f of [headObject, putObject, signedFileUrl, renderExport]) f.mockClear();
    authorizeApiExport.mockResolvedValue(payment);
    const res = await call();
    expect(res.status).toBe(402);
    expect(res.headers.get("location")).toBeNull();
    nothingDelivered();
  });

  it("unpaid: 402 payment_required with the payment URL and the same code, layout and format; no download link", async () => {
    authorizeApiExport.mockResolvedValue(payment);
    const res = await call();
    expect(res.status).toBe(402);
    const text = await res.text();
    expect(JSON.parse(text)).toEqual({
      error: {
        code: "payment_required",
        message: expect.stringContaining("paymentUrl"),
        paymentUrl: "https://heyqr.test/create/export?qr=q-a&layout=l-a&format=png",
        qrCodeId: "q-a",
        layoutId: "l-a",
        format: "png",
      },
    });
    expect(text).not.toMatch(/r2\.test|X-Amz|hqk_/);
    expect(getLayoutWithQr).not.toHaveBeenCalled();
    nothingDelivered();
  });

  it("not found and invalid options: refused before anything is loaded, rendered or signed", async () => {
    authorizeApiExport.mockResolvedValueOnce({ ok: false, error: "not_found" });
    const missing = await call("format=png", `Bearer ${KEY}`, { qrCodeId: "q-b", layoutId: "l-a" });
    expect([missing.status, ((await missing.json()) as { error: { code: string } }).error.code]).toEqual([404, "not_found"]);
    authorizeApiExport.mockResolvedValueOnce({ ok: false, error: "invalid_request", details: [{ path: "format", message: "bad" }] });
    const invalid = await call("format=gif");
    expect([invalid.status, ((await invalid.json()) as { error: { code: string } }).error.code]).toEqual([422, "invalid_request"]);
    expect(getLayoutWithQr).not.toHaveBeenCalled();
    nothingDelivered();
  });

  it("a renderer refusal comes back in the API's error shape, with no link", async () => {
    renderExport.mockResolvedValue({ body: Buffer.from(""), contentType: "image/png", scan: { ok: false, issues: ["contrast"] } });
    const res = await call();
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ error: { code: "scan_check_failed", message: expect.any(String), issues: ["contrast"] } });
    expect(signedFileUrl).not.toHaveBeenCalled();
  });
});

/* HEY-160: the export route's responses against SDK-typed samples (compile-time `satisfies`, runtime shape). */
const shape = (v: unknown): unknown =>
  v === null
    ? "null"
    : Array.isArray(v)
      ? [v.length ? shape(v[0]) : "empty"]
      : typeof v === "object"
        ? Object.fromEntries(
            Object.entries(v)
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([k, x]) => [k, shape(x)]),
          )
        : typeof v;

describe("SDK contract: export responses (HEY-160)", () => {
  it("302 redirect, 402 payment required, 404, 422 and 401 match the SDK types", async () => {
    const ok = await call();
    const redirect: Sdk.ExportRedirect = {
      status: 302,
      headers: { location: ok.headers.get("location") ?? "", "cache-control": "private, no-store" },
    };
    expect([ok.status, ok.headers.get("cache-control")]).toEqual([redirect.status, redirect.headers["cache-control"]]);
    expect(redirect.headers.location).toMatch(/^https:/);

    authorizeApiExport.mockResolvedValueOnce(payment);
    const pay = await call();
    const samplePay = {
      error: { code: "payment_required", message: "m", paymentUrl: "https://x", qrCodeId: "q", layoutId: "l", format: "png" },
    } satisfies Sdk.PaymentRequiredError;
    expect([pay.status, shape(await pay.json())]).toEqual([402, shape(samplePay)]);

    authorizeApiExport.mockResolvedValueOnce({ ok: false, error: "not_found" });
    expect(shape(await (await call()).json())).toEqual(shape({ error: { code: "not_found", message: "m" } } satisfies Sdk.NotFoundError));

    authorizeApiExport.mockResolvedValueOnce({ ok: false, error: "invalid_request", details: [{ path: "format", message: "bad" }] });
    expect(shape(await (await call("format=gif")).json())).toEqual(
      shape({ error: { code: "invalid_request", message: "m", details: [{ path: "p", message: "m" }] } } satisfies Sdk.InvalidRequestError),
    );

    stored.clear();
    renderExport.mockResolvedValueOnce({
      body: Buffer.from(""),
      contentType: "image/png",
      scan: { ok: false, issues: [{ code: "contrast", title: "t", detail: "d", fix: "f" }] },
    });
    const scan = await call();
    const sampleScan = {
      error: { code: "scan_check_failed", message: "m", issues: [{ code: "contrast", title: "t", detail: "d", fix: "f" }] },
    } satisfies Sdk.ScanCheckFailedError;
    expect([scan.status, shape(await scan.json())]).toEqual([422, shape(sampleScan)]);

    expect(shape(await (await call("format=png", null)).json())).toEqual(
      shape({ error: { code: "unauthorized", message: "m" } } satisfies Sdk.UnauthorizedError),
    );
  });
});
