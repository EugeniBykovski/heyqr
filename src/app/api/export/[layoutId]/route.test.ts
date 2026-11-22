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
const { GET } = await import("./route");

/* HEY-85: a layout's file only for the account that owns its code, and only when that code is unlocked. */
const record = {
  id: "l-a",
  name: "Business card",
  design: { schemaVersion: 1, layout: designToLayout(DEFAULT_DESIGN), editor: designSettingsOf(DEFAULT_DESIGN) },
  qrCode: { id: "q-a", userId: "user-a", name: "A · Bakery", content: { type: "website", url: "https://bakery.example/private" } },
};
const get = () =>
  GET(new NextRequest("http://localhost/api/export/l-a?format=png"), { params: Promise.resolve({ layoutId: "l-a" }) } as never);

beforeEach(() => {
  session.mockReset();
  getLayoutWithQr.mockReset().mockResolvedValue(record);
  canDownload.mockReset().mockResolvedValue(true);
  renderExport.mockReset().mockResolvedValue({ body: Buffer.from("png"), contentType: "image/png" });
});

describe("export a layout's file: account isolation (HEY-85)", () => {
  it("signed out: 401, nothing loaded or rendered", async () => {
    session.mockResolvedValue(null);
    const res = await get();
    expect(res.status).toBe(401);
    expect(getLayoutWithQr).not.toHaveBeenCalled();
    expect(renderExport).not.toHaveBeenCalled();
  });

  it("another account's layout: the same 404 as a missing one, no data and no file", async () => {
    session.mockResolvedValue({ user: { id: "user-b" } });
    const res = await get();
    expect(res.status).toBe(404);
    const body = await res.text();
    expect(body).toBe(JSON.stringify({ error: "not_found" }));
    expect(body).not.toMatch(/Bakery|bakery\.example|q-a/);
    expect(canDownload).not.toHaveBeenCalled();
    expect(renderExport).not.toHaveBeenCalled();
    getLayoutWithQr.mockResolvedValue(undefined);
    expect((await get()).status).toBe(404);
  });

  it("the owner's draft: 402, no file", async () => {
    session.mockResolvedValue({ user: { id: "user-a" } });
    canDownload.mockResolvedValue(false);
    expect((await get()).status).toBe(402);
    expect(renderExport).not.toHaveBeenCalled();
  });
});
