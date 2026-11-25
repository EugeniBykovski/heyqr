import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { TEST_TRAFFIC_HEADER as SERVER_HEADER } from "../src/server/qr/scans";
import { alertFailure, judge, main, probe, readConfig, TEST_TRAFFIC_HEADER, type ProbeConfig } from "./short-link-probe";

/* HEY-176: the probe against a local fixture over real HTTP. Not an external check. */
const DEST = "https://probe-target.example/ok?v=1";
type Answer = { status: number; headers?: Record<string, string>; hang?: boolean };
let answer: Answer;
const seen: { method?: string; url?: string; headers: IncomingMessage["headers"]; body: string }[] = [];
let server: Server;
let base = "";

beforeAll(async () => {
  server = createServer((req, res) => {
    let body = "";
    req.on("data", (d) => (body += d));
    req.on("end", () => {
      seen.push({ method: req.method, url: req.url, headers: req.headers, body });
      if (req.url?.includes("/envelope/")) return res.end("{}");
      if (!answer.hang) res.writeHead(answer.status, answer.headers).end();
    });
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => {
  server.closeAllConnections();
  server.close();
});
const good = (): Answer => ({ status: 302, headers: { location: DEST, "cache-control": "no-store" } });
beforeEach(() => {
  seen.length = 0;
  answer = good();
});

const config = (over: Partial<ProbeConfig> = {}): ProbeConfig => ({
  url: `${base}/r/probe`,
  destination: DEST,
  environment: "test",
  timeoutMs: 2000,
  local: true,
  ...over,
});
const kind = async (a: Answer, over: Partial<ProbeConfig> = {}) => {
  answer = a;
  const r = await probe(config(over));
  return r.ok ? "passed" : r.kind;
};
const env = (over: Record<string, string> = {}) => ({
  SHORT_LINK_PROBE_URL: `${base}/r/probe`,
  SHORT_LINK_PROBE_DESTINATION: DEST,
  SHORT_LINK_PROBE_ENVIRONMENT: "test",
  ...over,
});
const run = async (over: Record<string, string> = {}) => {
  const lines: string[] = [];
  return { code: await main(env(over), ["--local"], (l) => lines.push(l)), out: lines.join("\n") };
};

describe("short link probe (HEY-176)", () => {
  it("one marked GET without credentials; the redirect isn't followed", async () => {
    expect(await kind(good())).toBe("passed");
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ method: "GET", url: "/r/probe", headers: { [TEST_TRAFFIC_HEADER]: "1" } });
    expect(seen[0]?.headers.cookie ?? seen[0]?.headers.authorization).toBeUndefined();
  });

  it("uses the marker the app filters on", () => expect(TEST_TRAFFIC_HEADER).toBe(SERVER_HEADER));

  it("fails on anything but 302, the exact Location and no-store", async () => {
    const at = (location: string, status = 302, cache = "no-store") => ({ status, headers: { location, "cache-control": cache } });
    for (const status of [301, 307, 308]) expect(await kind(at(DEST, status))).toBe("status");
    for (const status of [200, 404, 500, 503]) expect(await kind({ status })).toBe("status");
    expect(await kind({ status: 302, headers: { "cache-control": "no-store" } })).toBe("missing_location");
    for (const other of ["https://evil.example/", `${DEST}&x=1`, DEST.replace("/ok", "/OK"), "/ok?v=1"])
      expect(await kind(at(other))).toBe("unexpected_target");
    for (const cache of ["", "no-cache", "public, max-age=60", "x-no-store"])
      expect(await kind(at(DEST, 302, cache)), cache).toBe("cacheable");
    expect(await kind(at(DEST, 302, "private, No-Store"))).toBe("passed");
  });

  it("an unavailable-page redirect is its own failure, in any language", async () => {
    for (const path of [`${base}/link-unavailable`, "/de/link-unavailable", "https://app.example/link-unavailable?reason=inactive"])
      expect(await kind({ status: 302, headers: { location: path, "cache-control": "no-store" } })).toBe("unavailable_page");
    const headers = new Headers({ location: "https://app.example/link-unavailable?reason=inactive" });
    expect(judge({ status: 302, headers }, config())?.detail).toContain("inactive");
  });

  it("no answer in time and no server are failures", async () => {
    expect(await kind({ status: 302, hang: true }, { timeoutMs: 150 })).toBe("timeout");
    expect(await kind(good(), { url: "http://127.0.0.1:1/r/probe" })).toBe("network");
  });

  it("configuration: https and public only; --local takes loopback only; nothing is requested when it's wrong", async () => {
    const ok = { SHORT_LINK_PROBE_URL: "https://s.example/r/a", SHORT_LINK_PROBE_DESTINATION: DEST };
    expect(readConfig(ok)).toHaveProperty("config");
    for (const bad of [
      {},
      { SHORT_LINK_PROBE_URL: "http://s.example/r/a" },
      { SHORT_LINK_PROBE_URL: "https://localhost/r/a" },
      { SHORT_LINK_PROBE_URL: "https://u:p@s.example/r/a" },
      { SHORT_LINK_PROBE_URL: "https://s.example/r/a?x=1" },
      { SHORT_LINK_PROBE_DESTINATION: "http://plain.example/" },
      { SHORT_LINK_PROBE_DESTINATION: "https://s.example/link-unavailable" },
      { SHORT_LINK_PROBE_TIMEOUT_MS: "0" },
      { SHORT_LINK_PROBE_ENVIRONMENT: "x\n::error::" },
    ])
      expect(readConfig(Object.keys(bad).length ? { ...ok, ...bad } : {}), JSON.stringify(bad)).toHaveProperty("problems");
    expect(readConfig(ok, true)).toHaveProperty("problems");
    expect(await main({ SHORT_LINK_PROBE_URL: `${base}/r/probe`, SHORT_LINK_PROBE_DESTINATION: DEST }, [], () => undefined)).toBe(2);
    expect(seen).toEqual([]);
  });

  it("success is one line and sends nothing; a wrong expected destination exits 1 and alerts once, without addresses", async () => {
    const dsn = `${base.replace("http://", "http://pub@")}/7`;
    const pass = await run({ SHORT_LINK_PROBE_SENTRY_DSN: dsn });
    expect(pass.code).toBe(0);
    expect(pass.out).toMatch(/^short link probe \[test\] LOCAL FIXTURE, not an external check: passed in \d+ ms$/);
    expect(seen).toHaveLength(1);
    const fail = await run({
      SHORT_LINK_PROBE_SENTRY_DSN: dsn,
      SHORT_LINK_PROBE_DESTINATION: "https://wrong.example/",
      GITHUB_RUN_ID: "42",
    });
    expect(fail.code).toBe(1);
    expect(fail.out).toContain("FAILED unexpected_target");
    expect(fail.out).toContain("sent to Sentry");
    const sent = seen.filter((s) => s.url === "/api/7/envelope/");
    expect(sent).toHaveLength(1);
    const event = JSON.parse(sent[0]?.body.split("\n")[2] ?? "{}");
    expect(event).toMatchObject({
      level: "error",
      environment: "test",
      tags: { operation: "probe.short_link", alert: "high", step: "unexpected_target", correlation_id: "probe-42", drill: "false" },
    });
    for (const text of [fail.out, sent[0]?.body ?? ""]) expect(text).not.toMatch(/probe-target|wrong\.example|r\/probe|127\.0\.0\.1/);
  });

  it("a drill fails a healthy link and is marked; a broken alert path never turns a failure into a pass", async () => {
    const drill = await run({ SHORT_LINK_PROBE_DRILL: "true" });
    expect([drill.code, drill.out.includes("DRILL")]).toEqual([1, true]);
    expect((await run({ SHORT_LINK_PROBE_DRILL: "true", SHORT_LINK_PROBE_SENTRY_DSN: "http://pub@127.0.0.1:1/7" })).code).toBe(1);
    const failure = { ok: false, kind: "timeout", detail: "x", ms: 1 } as const;
    expect(await alertFailure(failure, { dsn: "nonsense", environment: "test" })).toBe("failed");
    expect(await alertFailure(failure, { dsn: undefined, environment: "test" })).toBe("off");
  });
});
