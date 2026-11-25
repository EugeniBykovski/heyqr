import "server-only";
import type { PublicFile } from "./hosted-public";

/**
 * A hosted-page file as an HTTP response. Images are shown inline; a PDF opens in the browser (Open PDF) or, with
 * ?download=1, is saved under its name (Download). `nosniff` and a locked-down CSP keep an uploaded file from ever
 * running as a page.
 */
export function fileResponse(file: PublicFile, opts: { cache: string; download?: boolean; name?: string }) {
  const name = (opts.name ?? "document.pdf").replace(/[^\w.() -]+/g, "-").slice(0, 120) || "document.pdf";
  const disposition = file.contentType === "application/pdf" ? `${opts.download ? "attachment" : "inline"}; filename="${name}"` : "inline";
  return new Response(Buffer.from(file.bytes), {
    status: 200,
    headers: {
      "content-type": file.contentType,
      "content-length": String(file.bytes.byteLength),
      "content-disposition": disposition,
      "cache-control": opts.cache,
      "x-content-type-options": "nosniff",
      "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
      "referrer-policy": "no-referrer",
    },
  });
}
