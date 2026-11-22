import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_DESIGN, DEFAULT_PRINT_SETTINGS, designToLayout, printSettingsQuery, type EditorDesign } from "@/entities/qr";

vi.mock("server-only", () => ({}));
vi.mock("@/env", () => ({ env: { NEXT_PUBLIC_SHORT_LINK_BASE: "https://hey.qr" } }));
vi.mock("next-intl/server", () => ({ getTranslations: async () => (k: string) => k }));
const session = vi.fn();
vi.mock("@/server/auth", () => ({ getSession: () => session() }));
const load = vi.fn();
vi.mock("@/server/print/load", () => ({ loadPrint: (...a: unknown[]) => load(...a) }));

const { printPage } = await import("@/server/print/print");
const { GET } = await import("./route");

/* Design 8.5 / Handoff §4: the Print Pack files come only from here, matching the preview's render key. */
const card: EditorDesign = { ...DEFAULT_DESIGN, preset: "caption", caption: "Menu", size: { unit: "mm", qr: 40, width: 50, height: 62 } };
const layout = designToLayout(card);
const page = printPage(layout, "https://littlefern.coffee/menu", DEFAULT_PRINT_SETTINGS, { layoutId: "l1", revision: "r1" });
const ctx = (unlocked: boolean) => ({
  ok: true,
  ctx: {
    layout,
    page,
    value: "https://littlefern.coffee/menu",
    settings: DEFAULT_PRINT_SETTINGS,
    name: "Menu",
    layoutName: "Card",
    entitled: true,
    unlocked,
    forSale: true,
  },
});
const call = (q: string) =>
  GET(new NextRequest(`http://localhost/api/print/files/l1?${q}&${printSettingsQuery(DEFAULT_PRINT_SETTINGS)}`), {
    params: Promise.resolve({ layoutId: "l1" }),
  });

describe("GET /api/print/files/:layoutId", () => {
  beforeEach(() => {
    session.mockResolvedValue({ user: { id: "u1" } });
    load.mockResolvedValue(ctx(true));
  });

  it("401 signed out, 404 not the owner's, 400 without a file", async () => {
    session.mockResolvedValueOnce(null);
    expect((await call(`file=pdf&key=${page.renderKey}`)).status).toBe(401);
    load.mockResolvedValueOnce({ ok: false, error: "not_found" });
    expect((await call(`file=pdf&key=${page.renderKey}`)).status).toBe(404);
    expect((await call(`key=${page.renderKey}`)).status).toBe(400);
  });

  it("402 while the Print Pack is locked; a download link goes back to Print Preview instead", async () => {
    load.mockResolvedValue(ctx(false));
    expect((await call(`file=pdf&key=${page.renderKey}`)).status).toBe(402);
    const nav = await call(`file=pdf&key=${page.renderKey}&nav=1&qr=q1`);
    expect(nav.status).toBe(303);
    expect(nav.headers.get("location")).toContain("/print?qr=q1&layout=l1");
  });

  it("409 when the layout or settings changed since the preview", async () => {
    const res = await call("file=pdf&key=0000000000000000");
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: "revision_changed", renderKey: page.renderKey });
  });

  it("serves the print PDF, the editable SVG at the finished size and the specifications", async () => {
    const pdf = await call(`file=pdf&key=${page.renderKey}`);
    expect([pdf.status, pdf.headers.get("content-type")]).toEqual([200, "application/pdf"]);
    expect(Buffer.from(await pdf.arrayBuffer()).toString("latin1", 0, 8)).toBe("%PDF-1.7");
    const svg = await call(`file=svg&key=${page.renderKey}`);
    expect(svg.headers.get("content-type")).toBe("image/svg+xml");
    expect(await svg.text()).toMatch(/^<svg [^>]*width="50mm" height="62mm"/);
    const spec = await call(`file=spec&key=${page.renderKey}`);
    expect([spec.status, spec.headers.get("content-disposition")]).toEqual([200, expect.stringContaining("specifications")]);
  }, 60_000);
});
