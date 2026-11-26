import { describe, expect, it, vi } from "vitest";
import type { PaidFileKey } from "./paid-delivery";

/*
 * HEY-184: a paid file is stored once under a key derived on the server, then re-served from storage. A design saved
 * in one browser must never be answered with the file stored for the previous design in another: the key follows the
 * saved layout (its revision and the design itself), while everything outside the file (the request, the browser)
 * stays out of it.
 */
vi.mock("server-only", () => ({}));
vi.mock("@/env", () => ({ env: { NEXT_PUBLIC_SHORT_LINK_BASE: "https://www.heyqr.me/r" } }));
vi.mock("@/server/print/print", () => ({ layoutPdf: vi.fn() }));
const keys: PaidFileKey[] = [];
vi.mock("./paid-delivery", async (original) => ({
  ...(await original<typeof import("./paid-delivery")>()),
  deliverPaidFile: vi.fn(async (_request: Request, key: PaidFileKey) => {
    keys.push(key);
    return new Response(null, { status: 302 });
  }),
}));
const { deliverLayoutExport } = await import("./layout-export");
const { paidFileKey } = await import("./paid-delivery");

const layout = {
  preset: "qr",
  unit: "px",
  width: 512,
  height: 512,
  qrSize: 512,
  border: false,
  colors: { fg: "#1F5C45", eye: "#1F5C45", eyeIn: "#1F5C45", bg: "#FFFFFF", frame: "#1F5C45", caption: "#1F5C45" },
  style: { pattern: "dot", eyeFrame: "rounded", eyeBall: "rounded" },
  caption: { text: "", fontFamily: "DM Sans, sans-serif", size: 14, weight: 700, align: "center", position: "after" },
};
type Record = Parameters<typeof deliverLayoutExport>[2];
const record = (design: typeof layout, updatedAt: string) =>
  ({
    id: "L1",
    name: "QR only",
    updatedAt: new Date(updatedAt),
    design: { schemaVersion: 1, layout: design },
    qrCode: { id: "Q1", model: "static", content: { type: "website", url: "https://menu.example.test" }, shortCode: null },
  }) as unknown as Record;
const request = (ua: string) => new Request("https://www.heyqr.me/api/export/L1?format=png", { headers: { "user-agent": ua } });
const revised = {
  ...layout,
  preset: "caption",
  colors: { ...layout.colors, fg: "#1F4E8C" },
  caption: { ...layout.caption, text: "Scan me" },
};

async function keyFor(rec: Record, ua = "Chromium") {
  keys.length = 0;
  await deliverLayoutExport(request(ua), "U1", rec, { format: "png", scale: 2 });
  const k = keys[0];
  if (!k) throw new Error("no file key");
  return paidFileKey(k);
}

describe("paid export keys follow the saved design (HEY-184)", () => {
  it("a saved redesign gets its own stored file; the previous design's file is never re-served for it", async () => {
    const before = await keyFor(record(layout, "2026-11-26T13:43:58.936Z"));
    const after = await keyFor(record(revised, "2026-11-26T13:44:13.228Z"));
    expect(after).not.toBe(before);
    expect(after).toContain("/2026-11-26T13_44_13_228Z/");
  });

  it("two saves within the same millisecond still differ: the design itself is part of the key", async () => {
    const at = "2026-11-26T13:43:58.936Z";
    expect(await keyFor(record(revised, at))).not.toBe(await keyFor(record(layout, at)));
  });

  it("the same saved design from another browser is the same stored file (downloaded again, not rendered or paid again)", async () => {
    const at = "2026-11-26T13:44:13.228Z";
    expect(await keyFor(record(revised, at), "Firefox")).toBe(await keyFor(record(revised, at), "Chromium"));
  });

  it("the key holds the encoded payload, which a design change leaves alone", async () => {
    await keyFor(record(revised, "2026-11-26T13:44:13.228Z"));
    expect((keys[0]?.facts as { value: string }).value).toBe("https://menu.example.test");
  });
});
