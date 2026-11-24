import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("../billing/checkout", () => ({ CatalogError: class extends Error {} }));
vi.mock("../db", () => ({ db: {} }));
const requireUser = vi.fn();
vi.mock("../auth", () => ({ requireUser: () => requireUser() }));
const createApiKey = vi.fn();
const revokeApiKey = vi.fn();
vi.mock("../api-keys/keys", () => ({
  createApiKey: (...a: unknown[]) => createApiKey(...a),
  revokeApiKey: (...a: unknown[]) => revokeApiKey(...a),
}));
const { issueApiKey, revokeApiKeyAction } = await import("./api-keys");

beforeEach(() => {
  requireUser.mockReset();
  createApiKey.mockReset();
  revokeApiKey.mockReset();
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

/* HEY-154: revoking needs a signed-in account and is scoped to it. */
describe("revokeApiKeyAction (HEY-154)", () => {
  it("signed out: refused; a bad id: invalid; nothing revoked", async () => {
    requireUser.mockRejectedValue(Object.assign(new Error("Sign in required"), { name: "UnauthorizedError" }));
    expect(await revokeApiKeyAction("k1")).toEqual({ ok: false, error: "unauthorized" });
    requireUser.mockResolvedValue({ id: "u1" });
    expect(await revokeApiKeyAction(42)).toEqual({ ok: false, error: "invalid" });
    expect(revokeApiKey).not.toHaveBeenCalled();
  });

  it("the session's account revokes its own key; another account's key reads as not found", async () => {
    requireUser.mockResolvedValue({ id: "u1" });
    revokeApiKey.mockResolvedValueOnce({ revokedAt: "2026-11-24T12:00:00.000Z" }).mockResolvedValueOnce(null);
    expect(await revokeApiKeyAction("k1")).toEqual({ ok: true, data: { revokedAt: "2026-11-24T12:00:00.000Z" } });
    expect(revokeApiKey).toHaveBeenLastCalledWith({}, "u1", "k1");
    expect(await revokeApiKeyAction("not-mine")).toEqual({ ok: false, error: "not_found" });
  });
});
