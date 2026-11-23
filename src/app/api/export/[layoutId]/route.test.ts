import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_DESIGN, designSettingsOf, designToLayout } from "@/entities/qr";

vi.mock("server-only", () => ({}));
const session = vi.fn();
vi.mock("@/server/auth", () => ({ getSession: () => session() }));
const getLayoutWithQr = vi.fn();
vi.mock("@/server/qr/repository", () => ({ getLayoutWithQr: (...a: unknown[]) => getLayoutWithQr(...a) }));
const canDownload = vi.fn();
vi.mock("@/server/billing/entitlements", () => ({ canDownload: (...a: unknown[]) => canDownload(...a) }));
const renderExport = vi.fn();
vi.mock("@/server/qr/export", () => ({
  renderExport: (...a: unknown[]) => renderExport(...a),
  encodedValue: () => "https://bakery.example/private",
  withEmbeddedImages: async (l: unknown) => l,
  downloadFileName: () => ({ name: "card.png", header: 'attachment; filename="card.png"' }),
  ExportSizeError: class extends Error {},
}));
vi.mock("@/server/print/print", () => ({ layoutPdf: vi.fn() }));
// HEY-102: the real delivery (paid-delivery.ts) over stubbed private storage.
let storage = true;
vi.mock("@/server/config", () => ({ isConfigured: (what: string) => what === "storage" && storage }));
const stored = new Map<string, string>();
const headObject = vi.fn(async (key: string) => (stored.has(key) ? { contentDisposition: stored.get(key) ?? null } : null));
const putObject = vi.fn(async (key: string, _body: Buffer, _type: string, disposition?: string) => void stored.set(key, disposition ?? ""));
const signedFileUrl = vi.fn(async (key: string) => `https://r2.test/${key}?X-Amz-Expires=120&sig=${Math.random()}`);
vi.mock("@/server/storage/s3", () => ({
  headObject: (k: string) => headObject(k),
  putObject: (k: string, b: Buffer, t: string, d?: string) => putObject(k, b, t, d),
  signedFileUrl: (k: string) => signedFileUrl(k),
}));
const { GET } = await import("./route");

/* HEY-85 / HEY-102: a layout's file only for the account that owns its code, and only when that code is unlocked. */
const record = {
  id: "l-a",
  name: "Business card",
  updatedAt: new Date("2026-11-23T10:00:00Z"),
  design: { schemaVersion: 1, layout: designToLayout(DEFAULT_DESIGN), editor: designSettingsOf(DEFAULT_DESIGN) },
  qrCode: { id: "q-a", userId: "user-a", name: "A · Bakery", content: { type: "website", url: "https://bakery.example/private" } },
};
const get = (q = "format=png") =>
  GET(new NextRequest(`http://localhost/api/export/l-a?${q}`), { params: Promise.resolve({ layoutId: "l-a" }) } as never);

beforeEach(() => {
  storage = true;
  stored.clear();
  session.mockReset();
  getLayoutWithQr.mockReset().mockResolvedValue(record);
  canDownload.mockReset().mockResolvedValue(true);
  renderExport.mockReset().mockResolvedValue({ body: Buffer.from("png"), contentType: "image/png", scan: { ok: true } });
  headObject.mockClear();
  putObject.mockClear();
  signedFileUrl.mockClear();
});

describe("export a layout's file: account isolation (HEY-85)", () => {
  it("signed out: 401, nothing loaded or rendered", async () => {
    session.mockResolvedValue(null);
    const res = await get();
    expect(res.status).toBe(401);
    expect(getLayoutWithQr).not.toHaveBeenCalled();
    expect(renderExport).not.toHaveBeenCalled();
  });

  it("another account's layout, a deleted code, or a layout of another code than the one named: 404, no data, no link", async () => {
    session.mockResolvedValue({ user: { id: "user-b" } });
    const res = await get();
    expect(res.status).toBe(404);
    const body = await res.text();
    expect(body).toBe(JSON.stringify({ error: "not_found" }));
    expect(body).not.toMatch(/Bakery|bakery\.example|q-a/);
    getLayoutWithQr.mockResolvedValue(undefined); // missing, or its code deleted (getLayoutWithQr leaves those out)
    expect((await get()).status).toBe(404);
    session.mockResolvedValue({ user: { id: "user-a" } });
    getLayoutWithQr.mockResolvedValue(record);
    expect((await get("qr=q-other&format=png")).status).toBe(404);
    expect(canDownload).not.toHaveBeenCalled();
    expect(renderExport).not.toHaveBeenCalled();
    expect(signedFileUrl).not.toHaveBeenCalled();
  });

  it("the owner's draft: 402, no file and no link", async () => {
    session.mockResolvedValue({ user: { id: "user-a" } });
    canDownload.mockResolvedValue(false);
    expect((await get()).status).toBe(402);
    expect(renderExport).not.toHaveBeenCalled();
    expect(signedFileUrl).not.toHaveBeenCalled();
  });
});

describe("paid files through private storage and short-lived links (HEY-102)", () => {
  beforeEach(() => session.mockResolvedValue({ user: { id: "user-a" } }));

  it("first request renders and stores the file under its server-derived key, then redirects to a signed link", async () => {
    const res = await get("qr=q-a&format=png&scale=4");
    expect(res.status).toBe(302);
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    expect(res.headers.get("Referrer-Policy")).toBe("no-referrer");
    const key = putObject.mock.calls[0]?.[0] ?? "";
    expect(key).toMatch(/^paid\/user-a\/q-a\/l-a\/2026-11-23T10_00_00_000Z\/png-[0-9a-f]{32}\.png$/);
    expect(putObject.mock.calls[0]?.[3]).toBe('attachment; filename="card.png"');
    expect(res.headers.get("Location")).toMatch(new RegExp(`^https://r2.test/${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\?`));
    expect(renderExport).toHaveBeenCalledTimes(1);
  });

  it("a cache hit still rechecks the entitlement before every link: revoked (e.g. refunded) means 402, no link", async () => {
    await get();
    expect((await get()).status).toBe(302);
    expect(renderExport).toHaveBeenCalledTimes(1); // stored once, not rendered again
    expect(signedFileUrl).toHaveBeenCalledTimes(2); // a fresh link per request
    canDownload.mockResolvedValue(false);
    expect((await get()).status).toBe(402);
    expect(signedFileUrl).toHaveBeenCalledTimes(2);
    expect(canDownload).toHaveBeenCalledTimes(3);
  });

  it("a stored file that's gone is rendered again, without any new purchase or credit", async () => {
    await get();
    stored.clear(); // expired by a lifecycle rule, or removed
    expect((await get()).status).toBe(302);
    expect(renderExport).toHaveBeenCalledTimes(2);
  });

  it("prepare: makes sure the file is stored and answers its name; no link is issued", async () => {
    const res = await get("qr=q-a&format=png&prepare=1");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ready: true, name: "card.png" });
    expect(putObject).toHaveBeenCalledTimes(1);
    expect(signedFileUrl).not.toHaveBeenCalled();
  });

  it("a renderer error is answered as before and nothing is stored", async () => {
    renderExport.mockResolvedValue({ body: Buffer.from(""), contentType: "image/png", scan: { ok: false, issues: ["contrast"] } });
    const res = await get();
    expect(res.status).toBe(422);
    expect(putObject).not.toHaveBeenCalled();
    expect(signedFileUrl).not.toHaveBeenCalled();
  });

  it("keys follow the normalized settings and the saved layout: same file, same key; a new save, a new key", async () => {
    const keyOf = async (q: string, r = record) => {
      getLayoutWithQr.mockResolvedValue(r);
      putObject.mockClear();
      stored.clear();
      await get(q);
      return putObject.mock.calls[0]?.[0];
    };
    expect(await keyOf("format=svg&scale=4")).toBe(await keyOf("format=svg"));
    expect(await keyOf("format=png&scale=2")).toBe(await keyOf("format=png"));
    expect(await keyOf("format=png&scale=4")).not.toBe(await keyOf("format=png"));
    expect(await keyOf("format=png&transparent=1")).not.toBe(await keyOf("format=png"));
    const saved = {
      ...record,
      updatedAt: new Date("2026-11-23T11:00:00Z"),
      design: { ...record.design, editor: { ...record.design.editor } },
    };
    expect(await keyOf("format=png", saved)).not.toBe(await keyOf("format=png"));
  });

  it("without private storage configured (local dev): the file is streamed as before", async () => {
    storage = false;
    const res = await get();
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("image/png");
    expect(Buffer.from(await res.arrayBuffer()).toString()).toBe("png");
    expect(putObject).not.toHaveBeenCalled();
  });
});
