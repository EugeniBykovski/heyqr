import { inspect } from "node:util";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HeyQrApiError, HeyQrClient, HeyQrError, isHeyQrApiError, type CreateQrError, type FetchLike } from "@heyqr/sdk";

/* HEY-161: the SDK client's one request path, its errors, and where the key may (and may not) appear. */
const KEY = "hqk_AbCdEfGhIjKl_0123456789abcdefghijklmnopqrstuvwxyzABCDEFG";
type Call = { url: string; init: Parameters<FetchLike>[1] };

function fakeFetch(status: number, body: unknown, contentType = "application/json") {
  const calls: Call[] = [];
  const fetch: FetchLike = async (url, init) => {
    calls.push({ url, init });
    return {
      status,
      headers: { get: (n) => (n.toLowerCase() === "content-type" ? contentType : null) },
      text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
    };
  };
  return { fetch, calls };
}
const client = (fetch: FetchLike, baseUrl = "http://localhost:3000") => new HeyQrClient({ apiKey: KEY, baseUrl, fetch });
const unauthorized = { error: { code: "unauthorized", message: "A valid API key is required: Authorization: Bearer <key>." } };
const notFound = { error: { code: "not_found", message: "No such QR code or layout for this API key." } };
/** Everything an error exposes, as text: message, stack, fields, JSON and inspection. */
const everything = (e: unknown) => [String(e), (e as Error).stack, JSON.stringify(e), inspect(e, { depth: 5 })].join("\n");

afterEach(() => {
  delete (globalThis as { document?: unknown }).document;
});

describe("HeyQrClient requests (HEY-161)", () => {
  it("createQr: POST <baseUrl>/api/v1/qr-codes with Bearer auth and a JSON body; returns the created ids", async () => {
    const created = { id: "Q8d3", status: "draft", layouts: [{ id: "L2k9" }, { id: "L7xa" }] };
    const { fetch, calls } = fakeFetch(201, created);
    const request = {
      name: "Menu",
      mode: "dynamic",
      content: { type: "website", url: "littlefern.cafe" },
      destination: "littlefern.cafe/menu",
      layouts: [{ name: "A", layout: {} }],
    } as const;
    const result = await client(fetch, "http://localhost:3000/").createQr({ ...request, layouts: [...request.layouts] });
    expect(result).toEqual(created);
    expect(calls).toEqual([
      {
        url: "http://localhost:3000/api/v1/qr-codes",
        init: {
          method: "POST",
          headers: { authorization: `Bearer ${KEY}`, accept: "application/json", "content-type": "application/json" },
          body: JSON.stringify(request),
          redirect: "manual",
        },
      },
    ]);
    expect(calls[0]?.url).not.toContain(KEY);
  });

  it("getLayout and getDestination: GET with encoded ids; the layout revision is a string, the destination revision a number", async () => {
    const layout = { id: "L/2", qrCodeId: "Q 1", name: "Sticker", revision: "1764061234567890", layout: {}, editor: null };
    const a = fakeFetch(200, layout);
    expect(await client(a.fetch).getLayout("Q 1", "L/2")).toEqual(layout);
    expect(a.calls[0]?.url).toBe("http://localhost:3000/api/v1/qr-codes/Q%201/layouts/L%2F2");
    expect([a.calls[0]?.init.method, a.calls[0]?.init.body, a.calls[0]?.init.headers["content-type"]]).toEqual([
      "GET",
      undefined,
      undefined,
    ]);

    const destination = {
      qrCodeId: "Q1",
      destination: "https://littlefern.cafe/menu",
      revision: 0,
      previousDestination: null,
      changedAt: null,
      shortLink: null,
    };
    const b = fakeFetch(200, destination);
    const got = await client(b.fetch).getDestination("Q1");
    expect(got).toEqual(destination);
    expect([typeof got.revision, b.calls[0]?.url]).toEqual(["number", "http://localhost:3000/api/v1/qr-codes/Q1/destination"]);
  });
});

describe("HeyQrClient errors (HEY-161)", () => {
  it("401: HeyQrApiError with the status and code; the key is nowhere in the error", async () => {
    const { fetch } = fakeFetch(401, unauthorized);
    const error = await client(fetch)
      .getLayout("Q1", "L1")
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(HeyQrApiError);
    expect(isHeyQrApiError(error)).toBe(true);
    expect(error).toMatchObject({
      name: "HeyQrApiError",
      status: 401,
      code: "unauthorized",
      response: { status: 401, body: unauthorized },
    });
    expect(everything(error)).not.toContain(KEY);
    expect(everything(error)).not.toContain(KEY.slice(17));
  });

  it("404: not_found, the same for a missing or another account's resource", async () => {
    const { fetch } = fakeFetch(404, notFound);
    await expect(client(fetch).getDestination("someone-elses")).rejects.toMatchObject({ status: 404, code: "not_found" });
  });

  it("422 validation: the details are on the narrowed response", async () => {
    const body = {
      error: {
        code: "invalid_request",
        message: "The request isn't valid.",
        details: [{ path: "content.url", message: "Invalid url (urlInvalid)" }],
      },
    };
    const { fetch } = fakeFetch(422, body);
    const error = (await client(fetch)
      .createQr({ name: "x", mode: "static", content: { type: "website", url: "not a url" }, layouts: [{ name: "A", layout: {} }] })
      .catch((e: unknown) => e)) as CreateQrError;
    expect([error.status, error.code]).toEqual([422, "invalid_request"]);
    const details =
      error.response.status === 422 && error.response.body.error.code === "invalid_request" ? error.response.body.error.details : [];
    expect(details).toEqual([{ path: "content.url", message: "Invalid url (urlInvalid)" }]);
    const notDynamic = fakeFetch(422, { error: { code: "not_dynamic", message: "Only Dynamic codes have a destination." } });
    await expect(client(notDynamic.fetch).getDestination("Q1")).rejects.toMatchObject({ status: 422, code: "not_dynamic" });
  });

  it("a non-JSON answer or a network failure is a HeyQrError; neither carries the key", async () => {
    const html = fakeFetch(502, "<html>Bad gateway</html>", "text/html");
    const e1 = await client(html.fetch)
      .getLayout("Q1", "L1")
      .catch((e: unknown) => e);
    expect(e1).toBeInstanceOf(HeyQrError);
    expect(e1).toMatchObject({ status: 502 });
    const failing: FetchLike = async (_url, init) => {
      throw new TypeError(`fetch failed: ${JSON.stringify(init.headers)}`);
    };
    const e2 = await client(failing)
      .createQr({ name: "x", mode: "static", content: { type: "text", text: "x" }, layouts: [{ name: "A", layout: {} }] })
      .catch((e: unknown) => e);
    expect(e2).toBeInstanceOf(HeyQrError);
    expect(String(e2)).toContain("TypeError");
    expect(everything(e2)).not.toContain(KEY);
  });

  it("the client itself never shows the key: inspection, JSON and string", () => {
    const c = client(fakeFetch(200, {}).fetch);
    expect([inspect(c, { depth: 5, showHidden: true }), JSON.stringify(c), String(c)].join("\n")).not.toContain(KEY);
    expect(JSON.stringify(c)).toBe('{"apiUrl":"http://localhost:3000/api/v1"}');
  });

  it("refuses bad options, and refuses to run in a browser", () => {
    const { fetch } = fakeFetch(200, {});
    expect(() => new HeyQrClient({ apiKey: "sk_live_x", baseUrl: "http://localhost:3000", fetch })).toThrow(HeyQrError);
    expect(() => new HeyQrClient({ apiKey: KEY, baseUrl: "localhost:3000", fetch })).toThrow(/baseUrl/);
    expect(() => new HeyQrClient({ apiKey: KEY, baseUrl: `http://localhost:3000/?key=${KEY}`, fetch })).toThrow(/baseUrl/);
    for (const bad of ["sk_live_x", `http://localhost:3000/?key=${KEY}`]) {
      const e = (() => {
        try {
          new HeyQrClient({
            apiKey: bad.startsWith("http") ? KEY : bad,
            baseUrl: bad.startsWith("http") ? bad : "http://localhost:3000",
            fetch,
          });
        } catch (error) {
          return error;
        }
      })();
      expect(String(e)).not.toContain(KEY);
    }
    (globalThis as { document?: unknown }).document = {};
    expect(() => new HeyQrClient({ apiKey: KEY, baseUrl: "http://localhost:3000", fetch })).toThrow(/server only/);
  });

  it("uses the global fetch by default", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify(notFound), { status: 404 }));
    await expect(new HeyQrClient({ apiKey: KEY, baseUrl: "http://localhost:3000" }).getLayout("Q1", "L1")).rejects.toMatchObject({
      code: "not_found",
    });
    expect(spy).toHaveBeenCalledOnce();
    spy.mockRestore();
  });
});
