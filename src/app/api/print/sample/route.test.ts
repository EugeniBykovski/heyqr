import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/env", () => ({
  env: { S3_PUBLIC_URL: undefined, NEXT_PUBLIC_SHORT_LINK_BASE: "https://hey.qr", NEXT_PUBLIC_APP_URL: "https://heyqr.app" },
}));
vi.mock("next-intl/server", () => ({ getTranslations: async () => (k: string) => k }));
const session = vi.fn();
vi.mock("@/server/auth", () => ({ getSession: () => session() }));
const trial = vi.fn();
vi.mock("@/server/billing/entitlements", () => ({ userTrial: () => trial() }));
const { GET } = await import("./route");
const { samplePrint } = await import("@/server/print/sample");

/* Design 9.1: the Print Pack sample is a demo QR's files, for accounts whose trial runs. */
const call = (file: string) => GET(new NextRequest(`http://localhost/api/print/sample?file=${file}`));

describe("GET /api/print/sample", () => {
  beforeEach(() => {
    session.mockResolvedValue({ user: { id: "u1" } });
    trial.mockResolvedValue({ state: "active", day: 2, daysLeft: 6 });
  });

  it("401 signed out, 403 without a running trial, 400 for an unknown file", async () => {
    session.mockResolvedValueOnce(null);
    expect((await call("pdf")).status).toBe(401);
    for (const state of ["none", "expired", "upgraded"]) {
      trial.mockResolvedValueOnce({ state });
      expect((await call("pdf")).status).toBe(403);
    }
    expect((await call("zip")).status).toBe(400);
  });

  it("serves the demo QR's print PDF, editable SVG and specifications while the trial runs (also on its last day)", async () => {
    const pdf = await call("pdf");
    expect([pdf.status, pdf.headers.get("content-type")]).toEqual([200, "application/pdf"]);
    trial.mockResolvedValue({ state: "ending", day: 7, daysLeft: 1 });
    const svg = await call("svg");
    expect(await svg.text()).toMatch(/^<svg [^>]*width="55mm" height="85mm"/);
    expect((await call("spec")).headers.get("content-disposition")).toContain("specifications");
  }, 60_000);

  it("the sample is a demo QR that opens the app, and it scans", () => {
    const s = samplePrint("https://heyqr.app");
    expect(s.value).toBe("https://heyqr.app/");
    expect(s.page.scanOk).toBe(true);
  });
});
