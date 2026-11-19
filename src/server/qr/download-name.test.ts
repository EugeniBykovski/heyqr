import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/env", () => ({
  env: { S3_PUBLIC_URL: undefined, NEXT_PUBLIC_APP_URL: "https://heyqr.app", NEXT_PUBLIC_SHORT_LINK_BASE: "https://hey.qr" },
}));
vi.mock("@/server/config", () => ({ paymentsConfig: () => ({}) }));
vi.mock("../db", () => ({ db: {}, schema: {} }));
const { downloadFileName } = await import("./export");
const { exportReturnUrl } = await import("../billing/checkout");

describe("download file name (Content-Disposition)", () => {
  it("a Cyrillic name is a valid header: ASCII fallback plus the UTF-8 name (it used to throw)", () => {
    const { name, header } = downloadFileName("Меню кафе", "png");
    expect(name).toBe("меню-кафе.png");
    expect(() => new Headers({ "Content-Disposition": header })).not.toThrow();
    expect(header).toContain(`filename*=UTF-8''${encodeURIComponent("меню-кафе.png")}`);
    expect(header).toMatch(/filename="qr-code\.png"/);
  });

  it("Latin names keep their readable slug in both forms", () => {
    const { header } = downloadFileName("Café menu · table 4", "svg");
    expect(header).toContain('filename="cafe-menu-table-4.svg"');
    expect(() => new Headers({ "Content-Disposition": header })).not.toThrow();
  });
});

describe("checkout return URL", () => {
  it("returns to the same code, layout and file settings (the code id was missing, so every return was a 404)", () => {
    const url = new URL(exportReturnUrl({ qrCodeId: "q1", layoutId: "l2", format: "png", locale: "en", resolution: 4, transparent: true }));
    expect(url.pathname).toBe("/en/create/export");
    expect(Object.fromEntries(url.searchParams)).toEqual({ qr: "q1", layout: "l2", format: "png", res: "4", transparent: "1" });
  });
});
