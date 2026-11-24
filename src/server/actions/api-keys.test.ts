import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("../billing/checkout", () => ({ CatalogError: class extends Error {} }));
vi.mock("../db", () => ({ db: {} }));
const requireUser = vi.fn();
vi.mock("../auth", () => ({ requireUser: () => requireUser() }));
const createApiKey = vi.fn();
vi.mock("../api-keys/keys", () => ({ createApiKey: (...a: unknown[]) => createApiKey(...a) }));
const { issueApiKey } = await import("./api-keys");

beforeEach(() => {
  requireUser.mockReset();
  createApiKey.mockReset();
});

/* HEY-153: issuing a key needs a signed-in account; the owner comes from the session. */
describe("issueApiKey (HEY-153)", () => {
  it("signed out: refused, nothing issued", async () => {
    requireUser.mockRejectedValue(Object.assign(new Error("Sign in required"), { name: "UnauthorizedError" }));
    expect(await issueApiKey()).toEqual({ ok: false, error: "unauthorized" });
    expect(createApiKey).not.toHaveBeenCalled();
  });

  it("signed in: the session's account owns the key; the response carries it once", async () => {
    requireUser.mockResolvedValue({ id: "u1" });
    createApiKey.mockResolvedValue({ id: "k1", key: "hqk_x", prefix: "hqk_aaaa", createdAt: "2026-11-24T00:00:00.000Z" });
    expect(await issueApiKey()).toEqual({ ok: true, data: { key: "hqk_x", prefix: "hqk_aaaa", createdAt: "2026-11-24T00:00:00.000Z" } });
    expect(createApiKey).toHaveBeenCalledWith({}, "u1");
  });
});
