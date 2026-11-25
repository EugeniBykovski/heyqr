import { inspect } from "node:util";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_TIMEOUT_MS,
  HeyQrAbortError,
  HeyQrApiError,
  HeyQrClient,
  HeyQrError,
  HeyQrRateLimitError,
  HeyQrTimeoutError,
  isPaymentRequired,
  isRevisionConflict,
  isTimeout,
  retryAfter,
  type CreateQrError,
  type FetchLike,
} from "@heyqr/sdk";

/*
 * HEY-164: deadlines, cancellation, limits and payment errors, deterministically (fake timers, scripted fetch). Every
 * stalled step must end at the deadline, with its timer cleared on success and failure alike.
 */
const KEY = "hqk_AbCdEfGhIjKl_0123456789abcdefghijklmnopqrstuvwxyzABCDEFG";
const SIGNED = "https://storage.example/paid/u/q/l/r/png-abc.png?X-Amz-Signature=deadbeef&X-Amz-Expires=120";
const never = <T>() => new Promise<T>(() => undefined);
type Answer = { status: number; headers?: Record<string, string>; body?: string | Uint8Array; stallBody?: boolean };
const signals: (Parameters<FetchLike>[1]["signal"] | undefined)[] = [];

/** Each call answers in turn; `"stall"` never answers (and honours no signal, like a careless custom fetch). */
const script = (...answers: (Answer | "stall")[]) => {
  let i = 0;
  const fetch: FetchLike = async (_url, init) => {
    signals.push(init.signal);
    const a = answers[i++];
    if (!a || a === "stall") return never();
    const bytes = typeof a.body === "string" ? new TextEncoder().encode(a.body) : (a.body ?? new Uint8Array());
    const headers = Object.fromEntries(Object.entries(a.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v]));
    return {
      status: a.status,
      headers: { get: (n) => headers[n.toLowerCase()] ?? null },
      text: async () => (a.stallBody ? never<string>() : new TextDecoder().decode(bytes)),
      arrayBuffer: async () => (a.stallBody ? never<ArrayBuffer>() : (bytes.slice().buffer as ArrayBuffer)),
    };
  };
  return fetch;
};
const client = (fetch: FetchLike, timeoutMs?: number) =>
  new HeyQrClient({ apiKey: KEY, baseUrl: "http://localhost:3000", fetch, ...(timeoutMs ? { timeoutMs } : {}) });
const json = (status: number, body: unknown, headers: Record<string, string> = {}): Answer => ({
  status,
  headers: { "content-type": "application/json", ...headers },
  body: JSON.stringify(body),
});
const settle = async <T>(p: Promise<T>) =>
  p.then(
    (value) => ({ value }),
    (error: unknown) => ({ error }),
  );
const secret = (e: unknown) => [String(e), (e as Error).stack, JSON.stringify(e), inspect(e, { depth: 5 })].join("\n");

beforeEach(() => {
  vi.useFakeTimers();
  signals.length = 0;
});
afterEach(() => {
  vi.useRealTimers();
});

describe("deadlines (HEY-164)", () => {
  it("a stalled response ends at the deadline with HeyQrTimeoutError; the fetch was told to abort; no timer is left", async () => {
    const pending = settle(client(script("stall"), 5_000).getLayout("Q1", "L1"));
    await vi.advanceTimersByTimeAsync(4_999);
    expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    const { error } = (await pending) as { error: unknown };
    expect(error).toBeInstanceOf(HeyQrTimeoutError);
    expect(error).toMatchObject({ name: "HeyQrTimeoutError", kind: "timeout", timeoutMs: 5_000, status: undefined });
    expect(isTimeout(error)).toBe(true);
    expect(error).toBeInstanceOf(HeyQrError);
    expect(signals[0]?.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("a stalled JSON body times out too (the deadline covers reading the body)", async () => {
    const pending = settle(client(script({ ...json(200, {}), stallBody: true }), 2_000).getDestination("Q1"));
    await vi.advanceTimersByTimeAsync(2_000);
    expect(((await pending) as { error: unknown }).error).toBeInstanceOf(HeyQrTimeoutError);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("a stalled signed download (request or body) times out within the same deadline; the link stays out of the error", async () => {
    const redirect: Answer = { status: 302, headers: { location: SIGNED } };
    for (const second of ["stall", { status: 200, headers: { "content-type": "image/png" }, stallBody: true }] as const) {
      const pending = settle(client(script(redirect, second), 3_000).downloadExport("Q1", "L1", { format: "png" }));
      await vi.advanceTimersByTimeAsync(3_000);
      const { error } = (await pending) as { error: unknown };
      expect(error).toBeInstanceOf(HeyQrTimeoutError);
      expect(secret(error)).not.toMatch(/X-Amz|storage\.example|deadbeef/);
      expect(secret(error)).not.toContain(KEY);
      expect(vi.getTimerCount()).toBe(0);
    }
  });

  it("success clears the timer too; per-call timeoutMs overrides the client's; the default is 30 s", async () => {
    const ok = script(
      json(200, { qrCodeId: "Q1", destination: "d", revision: 0, previousDestination: null, changedAt: null, shortLink: null }),
    );
    await client(ok).getDestination("Q1");
    expect(vi.getTimerCount()).toBe(0);
    expect(DEFAULT_TIMEOUT_MS).toBe(30_000);
    const defaulted = settle(client(script("stall")).getLayout("Q1", "L1"));
    await vi.advanceTimersByTimeAsync(29_999);
    expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(((await defaulted) as { error: HeyQrTimeoutError }).error.timeoutMs).toBe(30_000);
    const perCall = settle(client(script("stall"), 60_000).getLayout("Q1", "L1", { timeoutMs: 100 }));
    await vi.advanceTimersByTimeAsync(100);
    expect(((await perCall) as { error: HeyQrTimeoutError }).error.timeoutMs).toBe(100);
    expect(() => client(script(), -1)).toThrow(/timeoutMs/);
  });

  it("the caller's signal cancels a call (HeyQrAbortError), and an already-aborted signal sends nothing", async () => {
    const controller = new AbortController();
    const pending = settle(
      client(script("stall")).createQr(
        { name: "x", mode: "static", content: { type: "text", text: "x" }, layouts: [{ name: "A", layout: {} }] },
        { signal: controller.signal },
      ),
    );
    await vi.advanceTimersByTimeAsync(10);
    controller.abort();
    const { error } = (await pending) as { error: unknown };
    expect(error).toBeInstanceOf(HeyQrAbortError);
    expect(error).toMatchObject({ kind: "aborted" });
    expect(isTimeout(error)).toBe(false);
    expect(vi.getTimerCount()).toBe(0);

    const seen: string[] = [];
    const counting: FetchLike = async (url) => {
      seen.push(url);
      return never();
    };
    const aborted = AbortSignal.abort();
    await expect(client(counting).getLayout("Q1", "L1", { signal: aborted })).rejects.toBeInstanceOf(HeyQrAbortError);
    expect(seen).toEqual([]);
  });

  it("a network failure stays a network error, distinct from timeout and cancellation", async () => {
    const failing: FetchLike = async () => {
      throw new TypeError(`fetch failed for ${SIGNED} with ${KEY}`);
    };
    const error = await client(failing)
      .getLayout("Q1", "L1")
      .catch((e: unknown) => e);
    expect(error).toMatchObject({ name: "HeyQrError", kind: "network" });
    expect(error).not.toBeInstanceOf(HeyQrTimeoutError);
    expect(error).not.toBeInstanceOf(HeyQrAbortError);
    expect(secret(error)).not.toMatch(/X-Amz|hqk_/);
  });
});

describe("limits and payment errors (HEY-164)", () => {
  it("a domain limit keeps its status and API code: 403 draft_limit", async () => {
    const body = {
      error: { code: "draft_limit", message: "This account has the maximum number of draft codes. Activate or delete one first." },
    };
    const error = (await client(script(json(403, body)))
      .createQr({ name: "x", mode: "static", content: { type: "text", text: "x" }, layouts: [{ name: "A", layout: {} }] })
      .catch((e: unknown) => e)) as CreateQrError;
    expect(error).toBeInstanceOf(HeyQrApiError);
    expect([error.status, error.code, error.response.body]).toEqual([403, "draft_limit", body]);
  });

  it("429 with Retry-After: HeyQrRateLimitError with the seconds, for a JSON body, a plain-text body and an HTTP date", async () => {
    const asJson = await client(script(json(429, { error: { code: "rate_limited", message: "Slow down." } }, { "retry-after": "17" })))
      .getLayout("Q1", "L1")
      .catch((e: unknown) => e);
    expect(asJson).toBeInstanceOf(HeyQrRateLimitError);
    expect(asJson).toMatchObject({ status: 429, kind: "rate_limited", retryAfterSeconds: 17, code: "rate_limited" });
    const asText = await client(
      script({ status: 429, headers: { "content-type": "text/plain", "retry-after": "5" }, body: "Too Many Requests" }),
    )
      .getDestination("Q1")
      .catch((e: unknown) => e);
    expect(asText).toMatchObject({ status: 429, retryAfterSeconds: 5, code: null });
    const date = new Date(Date.now() + 90_000).toUTCString();
    const asDate = await client(script({ status: 429, headers: { "retry-after": date }, body: "" }))
      .getLayout("Q1", "L1")
      .catch((e: unknown) => e);
    expect((asDate as HeyQrRateLimitError).retryAfterSeconds).toBeGreaterThanOrEqual(89);
    const none = await client(script({ status: 429, body: "" }))
      .getLayout("Q1", "L1")
      .catch((e: unknown) => e);
    expect(none).toMatchObject({ retryAfterSeconds: null });
    expect(retryAfter("not a date")).toBeNull();
    expect(retryAfter(new Date(Date.now() - 5_000).toUTCString())).toBe(0);
  });

  it("402 payment_required: typed, with the API's payment URL; nothing opened or retried", async () => {
    const body = {
      error: {
        code: "payment_required",
        message: "Open paymentUrl…",
        paymentUrl: "https://heyqr.example/create/export?qr=Q1&layout=L1&format=svg",
        qrCodeId: "Q1",
        layoutId: "L1",
        format: "svg",
      },
    };
    let calls = 0;
    const once: FetchLike = async (url, init) => {
      calls++;
      return script(json(402, body))(url, init);
    };
    const error = await client(once)
      .downloadExport("Q1", "L1", { format: "svg" })
      .catch((e: unknown) => e);
    expect(isPaymentRequired(error)).toBe(true);
    if (!isPaymentRequired(error)) throw new Error("narrowing");
    expect(error.response.body.error.paymentUrl).toBe("https://heyqr.example/create/export?qr=Q1&layout=L1&format=svg");
    expect(calls).toBe(1);
  });

  it("401, 404 and 409 behave as before", async () => {
    await expect(client(script(json(401, { error: { code: "unauthorized", message: "m" } }))).getLayout("Q1", "L1")).rejects.toMatchObject({
      status: 401,
      code: "unauthorized",
    });
    await expect(client(script(json(404, { error: { code: "not_found", message: "m" } }))).getDestination("Q1")).rejects.toMatchObject({
      status: 404,
      code: "not_found",
    });
    const conflict = await client(
      script(json(409, { error: { code: "revision_conflict", message: "m", current: { destination: "d", revision: 2 } } })),
    )
      .updateDestination("Q1", { destination: "x.test", revision: 1 })
      .catch((e: unknown) => e);
    expect(isRevisionConflict(conflict)).toBe(true);
    expect(isPaymentRequired(conflict)).toBe(false);
  });
});
