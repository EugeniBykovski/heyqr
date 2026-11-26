/*
 * HEY-182 QA only: a minimal path-style S3 in memory (PUT / HEAD / GET / DELETE), so a test run of the app can use its
 * real private-storage path (S3_ENDPOINT=http://localhost:9182) and a storage failure can be caused on purpose, at the
 * storage boundary, with no switch in the app. Never part of the app or a deployment.
 *
 *   PORT=9182 node scripts/qa/fake-s3.mjs
 *   GET /__fail?op=put&n=3     the next 3 PUTs answer 500 (the S3 client makes 3 attempts per request)
 *   GET /__fail?op=delay&n=5000  the next PUT waits 5 s (makes "Preparing your file…" observable)
 *   GET /__log                 every request so far (method, key, status) and the stored keys
 * No signature is checked: the app signs its requests, this only stores.
 */
import http from "node:http";
const store = new Map();
const fail = { put: 0 };
const log = [];
function dechunk(buf) {
  // aws-chunked: "<hex>;chunk-signature=...\r\n<data>\r\n...0;...\r\n(trailers)"
  const out = [];
  let i = 0;
  for (;;) {
    const nl = buf.indexOf("\r\n", i);
    if (nl < 0) break;
    const size = parseInt(buf.subarray(i, nl).toString().split(";")[0], 16);
    if (!size) break;
    out.push(buf.subarray(nl + 2, nl + 2 + size));
    i = nl + 2 + size + 2;
  }
  return Buffer.concat(out);
}
http
  .createServer((req, res) => {
    const u = new URL(req.url, "http://x");
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const done = (status, headers = {}, body) => {
        log.push({ at: new Date().toISOString(), method: req.method, key: u.pathname, status });
        res.writeHead(status, headers);
        res.end(body);
      };
      if (u.pathname === "/__fail") {
        fail[u.searchParams.get("op") ?? "put"] = Number(u.searchParams.get("n") ?? 1);
        return done(200, {}, JSON.stringify(fail));
      }
      if (u.pathname === "/__log")
        return done(200, { "content-type": "application/json" }, JSON.stringify({ log, keys: [...store.keys()] }));
      const key = decodeURIComponent(u.pathname);
      if (req.method === "PUT" && fail.delay > 0) {
        // Holds the next PUT for `delay` ms (makes "Preparing…" observable), then handles it normally.
        const ms = fail.delay;
        fail.delay = 0;
        setTimeout(() => req.emit("end"), ms);
        return;
      }
      if (req.method === "PUT") {
        if (fail.put > 0) {
          fail.put--;
          return done(
            500,
            { "content-type": "application/xml" },
            "<Error><Code>InternalError</Code><Message>QA injected failure</Message></Error>",
          );
        }
        let body = Buffer.concat(chunks);
        if (
          String(req.headers["content-encoding"] ?? "").includes("aws-chunked") ||
          String(req.headers["x-amz-content-sha256"] ?? "").startsWith("STREAMING")
        )
          body = dechunk(body);
        store.set(key, {
          body,
          type: req.headers["content-type"] ?? "application/octet-stream",
          disposition: req.headers["content-disposition"] ?? "",
        });
        return done(200, { ETag: '"qa"' });
      }
      const o = store.get(key);
      if (req.method === "HEAD")
        return o
          ? done(200, { "Content-Type": o.type, "Content-Length": o.body.length, "Content-Disposition": o.disposition, ETag: '"qa"' })
          : done(404);
      if (req.method === "GET") {
        if (!o) return done(404, { "content-type": "application/xml" }, "<Error><Code>NoSuchKey</Code></Error>");
        return done(
          200,
          {
            "Content-Type": o.type,
            "Content-Disposition": u.searchParams.get("response-content-disposition") ?? o.disposition,
            ETag: '"qa"',
          },
          o.body,
        );
      }
      if (req.method === "DELETE") {
        store.delete(key);
        return done(204);
      }
      done(405);
    });
  })
  .listen(Number(process.env.PORT ?? 9182), () => console.log("fake s3 ready"));
