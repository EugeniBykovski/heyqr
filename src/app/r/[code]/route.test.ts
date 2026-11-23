import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/env", () => ({ env: { NEXT_PUBLIC_APP_URL: "http://localhost:3000" } }));
const findQr = vi.fn();
const findUser = vi.fn();
vi.mock("@/server/db", () => ({
  db: { query: { qrCode: { findFirst: (...a: unknown[]) => findQr(...a) }, user: { findFirst: (...a: unknown[]) => findUser(...a) } } },
  schema: { qrCode: { shortCode: "short_code" }, user: { id: "id" } },
}));
const subscription = vi.fn();
vi.mock("@/server/billing/entitlements", () => ({ activeSubscription: (...a: unknown[]) => subscription(...a) }));
const recordScan = vi.fn();
vi.mock("@/server/qr/repository", () => ({ recordScan: (...a: unknown[]) => recordScan(...a) }));
const afterQueue: (() => unknown)[] = [];
vi.mock("next/server", async (original) => ({
  ...(await original<typeof import("next/server")>()),
  after: (fn: () => unknown) => afterQueue.push(fn),
}));

const { GET } = await import("./route");

const live = {
  id: "q1",
  userId: "u1",
  shortCode: "AbCdEf2",
  status: "active",
  deletedAt: null,
  isTrial: false,
  destination: "https://menu.example.test/today?table=4#drinks",
};
const open = async (code = "AbCdEf2") => {
  const res = await GET(new NextRequest(`http://localhost:3000/r/${code}`), { params: Promise.resolve({ code }) });
  // Scans recorded after the response, as next/server's after() would.
  for (const fn of afterQueue.splice(0)) await fn();
  return { status: res.status, location: res.headers.get("location"), cache: res.headers.get("cache-control") };
};
const unavailable = "http://localhost:3000/link-unavailable";

/* HEY-120 / QR-16.05: every answer of the short link is a 302 with Cache-Control: no-store. */
describe("GET /r/:code", () => {
  beforeEach(() => {
    findQr.mockReset();
    findUser.mockReset();
    subscription.mockReset();
    recordScan.mockReset();
    afterQueue.length = 0;
  });

  it("an active code: 302 to its exact current destination, no-store, one scan recorded", async () => {
    findQr.mockResolvedValue(live);
    expect(await open()).toEqual({ status: 302, location: live.destination, cache: "no-store" });
    expect(recordScan).toHaveBeenCalledExactlyOnceWith("q1");
  });

  it("a changed destination is followed by the very next request", async () => {
    findQr.mockResolvedValueOnce(live).mockResolvedValueOnce({ ...live, destination: "http://plain.example.test/new?x=1#y" });
    expect((await open()).location).toBe(live.destination);
    expect(await open()).toEqual({ status: 302, location: "http://plain.example.test/new?x=1#y", cache: "no-store" });
  });

  it("fallbacks: unknown, deleted, not live or without a destination go to /link-unavailable, no-store, no scan", async () => {
    for (const qr of [
      undefined,
      { ...live, deletedAt: new Date() },
      { ...live, status: "draft" },
      { ...live, status: "paused" },
      { ...live, destination: null },
    ]) {
      findQr.mockResolvedValueOnce(qr);
      expect(await open()).toEqual({ status: 302, location: unavailable, cache: "no-store" });
    }
    expect(recordScan).not.toHaveBeenCalled();
  });

  it("the trial's test code: paused after the trial (no-store, no scan); live while it runs or under a plan", async () => {
    const trial = { ...live, isTrial: true };
    const ended = { trialStartedAt: new Date("2026-01-01T00:00:00Z"), trialEndsAt: new Date("2026-01-08T00:00:00Z") };
    findQr.mockResolvedValue(trial);
    findUser.mockResolvedValue(ended);
    subscription.mockResolvedValue(null);
    expect(await open()).toEqual({ status: 302, location: `${unavailable}?reason=inactive`, cache: "no-store" });
    expect(recordScan).not.toHaveBeenCalled();

    subscription.mockResolvedValue({ id: "sub" });
    expect(await open()).toEqual({ status: 302, location: live.destination, cache: "no-store" });
    subscription.mockResolvedValue(null);
    findUser.mockResolvedValue({ trialStartedAt: new Date(Date.now() - 86_400_000), trialEndsAt: new Date(Date.now() + 86_400_000) });
    expect(await open()).toEqual({ status: 302, location: live.destination, cache: "no-store" });
    expect(recordScan).toHaveBeenCalledTimes(2);
  });

  it("HEY-121: a trial code never started, or deleted, inactive or without a destination: the right fallback, no lookups leak", async () => {
    findQr.mockResolvedValue({ ...live, isTrial: true });
    findUser.mockResolvedValue({ trialStartedAt: null, trialEndsAt: null });
    subscription.mockResolvedValue(null);
    expect(await open()).toEqual({ status: 302, location: `${unavailable}?reason=inactive`, cache: "no-store" });
    // The generic fallback comes first: a deleted or paused trial code isn't looked up further.
    for (const qr of [
      { ...live, isTrial: true, deletedAt: new Date() },
      { ...live, isTrial: true, status: "paused" },
    ]) {
      findUser.mockClear();
      findQr.mockResolvedValueOnce(qr);
      expect(await open()).toEqual({ status: 302, location: unavailable, cache: "no-store" });
      expect(findUser).not.toHaveBeenCalled();
    }
    expect(recordScan).not.toHaveBeenCalled();
  });

  it("HEY-121: the fallback names nothing about the code: no slug, destination or owner in its URL", async () => {
    findQr.mockResolvedValueOnce({ ...live, status: "paused" });
    const { location } = await open();
    expect(location).toBe(unavailable);
    for (const secret of ["AbCdEf2", "menu.example.test", "u1", "q1"]) expect(location).not.toContain(secret);
  });

  it("HEY-121: reactivating a paused code turns the same short link back on at the next request", async () => {
    findQr.mockResolvedValueOnce({ ...live, status: "paused" }).mockResolvedValueOnce(live);
    expect((await open()).location).toBe(unavailable);
    expect(await open()).toEqual({ status: 302, location: live.destination, cache: "no-store" });
    expect(recordScan).toHaveBeenCalledExactlyOnceWith("q1");
  });
});
