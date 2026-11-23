import "server-only";
import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { isConfigured } from "@/server/config";
import { headObject, putObject, signedFileUrl } from "@/server/storage/s3";

/** Where a paid file is stored, derived on the server only (never from the request). */
export type PaidFileKey = {
  userId: string;
  qrCodeId: string;
  /** The layout, or "all" for a code's Download all. */
  scope: string;
  /** The saved layout revision(s) the file was rendered from. */
  revision: string;
  /** What the file is (e.g. "png", "print-pdf", "all-png"), also its extension source. */
  kind: string;
  ext: string;
  /** Everything else that changes the bytes: normalized settings, design, content, names in the file. */
  facts: unknown;
};

const safe = (s: string) => s.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 80);

/** HEY-102: paid/<user>/<code>/<layout|all>/<revision>/<kind>-<digest>.<ext>; one object per distinct file. */
export function paidFileKey(k: PaidFileKey): string {
  const digest = createHash("sha256")
    .update(JSON.stringify({ kind: k.kind, facts: k.facts }))
    .digest("hex")
    .slice(0, 32);
  return `paid/${safe(k.userId)}/${safe(k.qrCodeId)}/${safe(k.scope)}/${safe(k.revision)}/${safe(k.kind)}-${digest}.${safe(k.ext)}`;
}

/** The download name from a Content-Disposition header (the UTF-8 one when present). */
export function dispositionName(header: string | null, fallback: string): string {
  if (!header) return fallback;
  const utf8 = /filename\*=UTF-8''([^;]+)/i.exec(header)?.[1];
  if (utf8) {
    try {
      return decodeURIComponent(utf8);
    } catch {
      /* fall through to the plain name */
    }
  }
  return /filename="([^"]+)"/i.exec(header)?.[1] ?? fallback;
}

/**
 * HEY-102: delivers one paid file the caller has already authorized (signed-in owner, exact code and layout, not
 * deleted, entitled to this file). Called on every request, so every link issued rechecks the entitlement, cache
 * hits included (HEY-100 refunds take effect on the next request).
 *
 * With private storage (R2): the file is stored once under its server-derived key (rendered by the route's own
 * renderer when missing or expired, never charged again), then
 * - `?prepare=1` answers `{ ready, name }` without bytes (Export's "Preparing…" step);
 * - otherwise a 302 to a short-lived signed GET for that one object (SIGNED_URL_TTL_SECONDS), `no-store`, no referrer.
 * Links issued earlier keep their own expiry. Without storage configured (local dev), the file is streamed as before.
 */
export async function deliverPaidFile(request: Request, key: PaidFileKey, render: () => Promise<NextResponse>): Promise<NextResponse> {
  const prepare = new URL(request.url).searchParams.get("prepare") === "1";
  const fallbackName = `qr-code.${key.ext}`;
  if (!isConfigured("storage")) {
    const res = await render();
    if (!prepare || !res.ok) return res;
    return ready(dispositionName(res.headers.get("Content-Disposition"), fallbackName));
  }

  const objectKey = paidFileKey(key);
  let disposition = (await headObject(objectKey))?.contentDisposition ?? null;
  if (!disposition) {
    const res = await render();
    if (!res.ok) return res; // 402 / 422 etc. from the renderer: nothing stored
    disposition = res.headers.get("Content-Disposition") ?? `attachment; filename="${fallbackName}"`;
    const type = res.headers.get("Content-Type") ?? "application/octet-stream";
    await putObject(objectKey, Buffer.from(await res.arrayBuffer()), type, disposition);
  }
  if (prepare) return ready(dispositionName(disposition, fallbackName));
  const url = await signedFileUrl(objectKey, disposition);
  return new NextResponse(null, {
    status: 302,
    headers: { Location: url, "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer" },
  });
}

const ready = (name: string) => NextResponse.json({ ready: true, name }, { headers: { "Cache-Control": "private, no-store" } });
