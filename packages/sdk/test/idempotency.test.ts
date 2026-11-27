import { afterEach, describe, expect, it, vi } from "vitest";
import {
  HeyQrClient,
  HeyQrError,
  HeyQrTimeoutError,
  isIdempotencyConflict,
  newIdempotencyKey,
  type CreateQrError,
  type CreateQrRequest,
  type FetchLike,
} from "@simplex-packages/heyqr-sdk";

/* HEY-165: the SDK side of Idempotency-Key (the server side runs against PostgreSQL in db.integration.test.ts). */
const KEY = "hqk_AbCdEfGhIjKl_0123456789abcdefghijklmnopqrstuvwxyzABCDEFG";
const request: CreateQrRequest = {
  name: "Menu",
  mode: "static",
  content: { type: "website", url: "littlefern.cafe/menu" },
  layouts: [{ name: "Sticker", layout: {} }],
};
const created = { id: "Q8d3", status: "draft", layouts: [{ id: "L2k9" }] };
type Seen = { headers: Record<string, string>; body: string | undefined };
const recording = (answer: () => Promise<Awaited<ReturnType<FetchLike>>> | never) => {
  const seen: Seen[] = [];
  const fetch: FetchLike = async (_url, init) => {
    seen.push({ headers: init.headers, body: init.body });
    return answer();
  };
  return { fetch, seen };
};
const reply = (status: number, body: unknown) => async () => ({
  status,
  headers: { get: (n: string) => (n.toLowerCase() === "content-type" ? "application/json" : null) },
  text: async () => JSON.stringify(body),
  arrayBuffer: async () => new ArrayBuffer(0),
});
const client = (fetch: FetchLike) => new HeyQrClient({ apiKey: KEY, baseUrl: "http://localhost:3000", fetch });

afterEach(() => {
  vi.useRealTimers();
});

describe("createQr idempotencyKey (HEY-165)", () => {
  it("sends Idempotency-Key only when given; existing callers send exactly what they did", async () => {
    const a = recording(reply(201, created));
    expect(await client(a.fetch).createQr(request, { idempotencyKey: "menu-2026-11-25" })).toEqual(created);
    expect(a.seen[0]?.headers["idempotency-key"]).toBe("menu-2026-11-25");
    expect(a.seen[0]?.headers.authorization).toBe(`Bearer ${KEY}`);
    const b = recording(reply(201, created));
    await client(b.fetch).createQr(request);
    expect(Object.keys(b.seen[0]?.headers ?? {}).sort()).toEqual(["accept", "authorization", "content-type"]);
  });

  it("an invalid key is refused before anything is sent", async () => {
    const { fetch, seen } = recording(reply(201, created));
    for (const bad of ["", "has spaces", "ключ", "x".repeat(256)]) {
      await expect(client(fetch).createQr(request, { idempotencyKey: bad })).rejects.toMatchObject({
        name: "HeyQrError",
        kind: "invalid_options",
      });
    }
    expect(seen).toHaveLength(0);
  });

  it("409 idempotency_key_reused is a typed CreateQrError, told apart from a revision conflict", async () => {
    const body = { error: { code: "idempotency_key_reused", message: "This Idempotency-Key was already used with a different request." } };
    const { fetch } = recording(reply(409, body));
    const error = (await client(fetch)
      .createQr(request, { idempotencyKey: "k-1" })
      .catch((e: unknown) => e)) as CreateQrError;
    expect(isIdempotencyConflict(error)).toBe(true);
    expect(error.response.status === 409 ? error.response.body.error.code : null).toBe("idempotency_key_reused");
    expect(isIdempotencyConflict(new HeyQrError("x"))).toBe(false);
  });

  it("after a timeout, the caller's retry sends the same key and the same body", async () => {
    vi.useFakeTimers();
    let calls = 0;
    const { fetch, seen } = recording(() => (calls++ === 0 ? new Promise(() => undefined) : reply(201, created)()));
    const heyqr = client(fetch);
    const idempotencyKey = newIdempotencyKey();
    const first = heyqr.createQr(request, { idempotencyKey, timeoutMs: 1_000 }).catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(await first).toBeInstanceOf(HeyQrTimeoutError);
    // The caller keeps the key and the request, and decides to retry.
    expect(await heyqr.createQr(request, { idempotencyKey })).toEqual(created);
    expect(seen.map((s) => [s.headers["idempotency-key"], s.body])).toEqual([
      [idempotencyKey, JSON.stringify(request)],
      [idempotencyKey, JSON.stringify(request)],
    ]);
  });

  it("newIdempotencyKey: a fresh UUID each time", () => {
    const keys = new Set(Array.from({ length: 50 }, () => newIdempotencyKey()));
    expect(keys.size).toBe(50);
    for (const k of keys) expect(k).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});
