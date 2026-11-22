import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const session = vi.fn();
vi.mock("@/server/auth", () => ({ getSession: () => session() }));
vi.mock("@/server/db", () => ({ db: {} }));
vi.mock("@/server/config", () => ({ isConfigured: () => true }));
const authorized = vi.fn();
vi.mock("@/server/qr/file-access", () => ({ authorizedLogo: (...a: unknown[]) => authorized(...a) }));
const presign = vi.fn();
vi.mock("@/server/storage/s3", () => ({ presignDownload: (...a: unknown[]) => presign(...a), SIGNED_URL_TTL_SECONDS: 120 }));
const { GET } = await import("./route");

/* HEY-84: a signed link to one private logo file, only after the session user's whole ownership chain is checked. */
const params = { qrId: "q1", layoutId: "l1", assetId: "a1" };
const call = () => GET(new Request("http://localhost/api/qr/q1/layouts/l1/logo/a1"), { params: Promise.resolve(params) } as never);

beforeEach(() => {
  session.mockReset();
  authorized.mockReset();
  presign.mockReset();
  presign.mockImplementation(async (key: string) => `https://bucket.example/${key}?X-Amz-Signature=sig${presign.mock.calls.length}`);
});

describe("signed logo link (HEY-84)", () => {
  it("signed out: 401, nothing signed", async () => {
    session.mockResolvedValue(null);
    const res = await call();
    expect(res.status).toBe(401);
    expect(authorized).not.toHaveBeenCalled();
    expect(presign).not.toHaveBeenCalled();
  });

  it("a code, layout or file that isn't this user's (or doesn't belong together): 404 and no link", async () => {
    session.mockResolvedValue({ user: { id: "u2" } });
    authorized.mockResolvedValue(null);
    const res = await call();
    expect(res.status).toBe(404);
    expect(res.headers.get("location")).toBeNull();
    expect(await res.text()).not.toContain("bucket.example");
    expect(authorized).toHaveBeenCalledWith({}, "u2", { qrCodeId: "q1", layoutId: "l1", assetId: "a1" });
    expect(presign).not.toHaveBeenCalled();
  });

  it("the owner gets a short-lived link to that one object, uncached; each request signs a fresh one", async () => {
    session.mockResolvedValue({ user: { id: "u1" } });
    authorized.mockResolvedValue({ key: "logos/u1/a1.png", contentType: "image/png", layoutName: "Business card" });
    const first = await call();
    expect(first.status).toBe(302);
    expect(first.headers.get("location")).toContain("logos/u1/a1.png");
    expect(first.headers.get("cache-control")).toBe("private, no-store");
    expect(first.headers.get("x-link-expires-in")).toBe("120");
    expect(presign).toHaveBeenCalledWith("logos/u1/a1.png", "Business-card-logo.png");
    const second = await call();
    expect(second.headers.get("location")).not.toBe(first.headers.get("location"));
    expect(authorized).toHaveBeenCalledTimes(2);
  });
});
