/*
 * HEY-160: a clean consumer of @simplex-packages/heyqr-sdk. Compiled on its own (tsconfig here: no DOM, no Node types, no path
 * aliases), importing only the package's public entry point. Each `@ts-expect-error` is a compile-time check: the line
 * must fail to compile, or this file fails.
 */
import {
  type AbortSignalLike,
  HeyQrAbortError,
  HeyQrClient,
  HeyQrError,
  HeyQrRateLimitError,
  HeyQrTimeoutError,
  isHeyQrApiError,
  isIdempotencyConflict,
  isPaymentRequired,
  newIdempotencyKey,
  isTimeout,
  type CreateQrError,
  type CreateQrOptions,
  type DownloadExportError,
  type ExportedFile,
  type GetDestinationError,
  type UpdateDestinationError,
  type UpdateLayoutError,
} from "@simplex-packages/heyqr-sdk";
import type {
  CreateQrRequest,
  CreateQrResponse,
  CreateQrResult,
  Destination,
  DestinationRevision,
  ExportQuery,
  ExportResult,
  Layout,
  LayoutRevision,
  UpdateDestinationRequest,
  UpdateDestinationResult,
  UpdateLayoutRequest,
  UpdateLayoutResult,
} from "@simplex-packages/heyqr-sdk";

// @ts-expect-error only the public entry point is exported
import type { QrMode } from "@simplex-packages/heyqr-sdk/src/qr-codes";

/* ── Create a QR ─────────────────────────────────────────────────────────────────────────────────────────────── */

/** A layout as HeyQR's editor produces it (abridged here; any JSON object is accepted and checked by the server). */
declare const stickerLayout: { schemaVersion: 1; unit: "px"; colors: { fg: string; bg: string } };

export const createMenu: CreateQrRequest = {
  name: "Menu",
  mode: "static",
  content: { type: "website", url: "littlefern.cafe/menu" },
  layouts: [{ name: "Sticker", layout: stickerLayout }],
};

export const createDynamic = {
  name: "Today's specials",
  mode: "dynamic",
  content: { type: "website", url: "littlefern.cafe" },
  destination: "littlefern.cafe/today",
  layouts: [{ name: "Poster", layout: stickerLayout, editor: { preset: "frame" } }],
} satisfies CreateQrRequest;

export const wifi: CreateQrRequest = {
  name: "Guest Wi-Fi",
  mode: "static",
  content: { type: "wifi", ssid: "Cafe", security: "WPA", password: "espresso42", hidden: false },
  layouts: [{ name: "Card", layout: stickerLayout }],
};

export function createdIds(result: CreateQrResult): { qr: string; layouts: string[] } | string {
  switch (result.status) {
    case 201: {
      const created: CreateQrResponse = result.body;
      return { qr: created.id, layouts: created.layouts.map((l) => l.id) };
    }
    case 400:
      return result.body.error.code; // "malformed_json"
    case 401:
      return result.body.error.code; // "unauthorized"
    case 403:
      return result.body.error.code; // "draft_limit"
    case 409:
      return result.body.error.code; // "idempotency_key_reused" (HEY-165)
    case 422:
      // Two 422s, told apart by code; only invalid_request has details.
      return result.body.error.code === "invalid_request"
        ? result.body.error.details.map((d) => `${d.path}: ${d.message}`).join("; ")
        : result.body.error.code; // "content_too_long"
    case 500:
      return result.body.error.code;
    default:
      return unreachable(result);
  }
}

/* ── Read a revision, prepare an update ──────────────────────────────────────────────────────────────────────── */

export function renameLayout(current: Layout, name: string): UpdateLayoutRequest {
  const revision: LayoutRevision = current.revision;
  return { revision, name };
}

export function redesignLayout(current: Layout, layout: object, editor: object): UpdateLayoutRequest {
  return { revision: current.revision, layout, editor };
}

export function moveDestination(current: Destination, destination: string): UpdateDestinationRequest {
  const revision: DestinationRevision = current.revision;
  return { destination, revision };
}

export function afterLayoutUpdate(result: UpdateLayoutResult): LayoutRevision | "retry" | null {
  if (result.status === 200) return result.body.revision;
  // A stale revision: read the layout again and reapply.
  if (result.status === 409) return result.body.error.code === "revision_conflict" ? "retry" : null;
  return null;
}

export function afterDestinationUpdate(result: UpdateDestinationResult): DestinationRevision | null {
  if (result.status === 200) return result.body.changed ? result.body.revision : result.body.revision;
  // The destination conflict carries what's stored now (the layout conflict doesn't).
  if (result.status === 409) return result.body.error.current.revision;
  if (result.status === 422 && result.body.error.code === "not_dynamic") return null;
  return null;
}

/* ── Export ──────────────────────────────────────────────────────────────────────────────────────────────────── */

export const pngForPrint: ExportQuery = { format: "png", dpi: 600, transparent: "1" };

export function exportOutcome(result: ExportResult): { download: string } | { pay: string } | { error: string } {
  switch (result.status) {
    case 302:
      return { download: result.headers.location };
    case 200:
      return { download: "(file in the response body: a local development server)" };
    case 402:
      return { pay: result.body.error.paymentUrl };
    case 401:
    case 404:
    case 500:
      return { error: result.body.error.code };
    case 422:
      if (result.body.error.code === "too_long") return { error: `${result.body.error.bytes} > ${result.body.error.maxBytes} bytes` };
      if (result.body.error.code === "too_large") return { error: `${result.body.error.width} × ${result.body.error.height} px` };
      if (result.body.error.code === "scan_check_failed") return { error: (result.body.error.issues ?? []).map((i) => i.code).join(",") };
      return { error: result.body.error.details.map((d) => d.path).join(",") };
    default:
      return unreachable(result);
  }
}

function unreachable(value: never): never {
  throw new Error(`Unexpected response: ${JSON.stringify(value)}`);
}

/* ── Compile-time checks: invalid input and missing narrowing ────────────────────────────────────────────────── */

declare const layout: Layout;
declare const destination: Destination;
declare const anyExport: ExportResult;
declare const anyCreate: CreateQrResult;

export const invalid: unknown[] = [
  // @ts-expect-error the owner comes from the key, never the request
  { ...createMenu, userId: "someone-else" } satisfies CreateQrRequest,
  // @ts-expect-error create-only: no existing code id
  { ...createMenu, qrCodeId: "Q8d3" } satisfies CreateQrRequest,
  // @ts-expect-error mode is "static" or "dynamic"
  { ...createMenu, mode: "live" } satisfies CreateQrRequest,
  // @ts-expect-error a website needs its url
  { ...createMenu, content: { type: "website" } } satisfies CreateQrRequest,
  // @ts-expect-error a field of another content type
  { ...createMenu, content: { type: "text", text: "hi", url: "x" } } satisfies CreateQrRequest,
  // @ts-expect-error wifi security is WPA, WEP or nopass
  { ...wifi, content: { type: "wifi", ssid: "Cafe", security: "WPA3" } } satisfies CreateQrRequest,
  // @ts-expect-error a layout update starts from the layout's revision (a string), not the destination's (a number)
  { revision: destination.revision, name: "Sticker v2" } satisfies UpdateLayoutRequest,
  // @ts-expect-error a destination update starts from the destination's revision (a number), not a layout's (a string)
  { revision: layout.revision, destination: "https://littlefern.cafe" } satisfies UpdateDestinationRequest,
  // @ts-expect-error the revision is required
  { name: "Sticker v2" } satisfies UpdateLayoutRequest,
  // @ts-expect-error nothing to update: send name, layout or editor
  { revision: layout.revision } satisfies UpdateLayoutRequest,
  // @ts-expect-error a layout update can't change the code's content
  { revision: layout.revision, name: "x", content: { type: "text", text: "x" } } satisfies UpdateLayoutRequest,
  // @ts-expect-error the format is png, svg or pdf
  { format: "gif" } satisfies ExportQuery,
  // @ts-expect-error transparent is "0" or "1" in the query
  { format: "png", transparent: true } satisfies ExportQuery,
];

export function withoutNarrowing(): unknown[] {
  return [
    // @ts-expect-error the payment URL exists only on the 402 response
    anyExport.body.error.paymentUrl,
    // @ts-expect-error only a 302 has a download location
    anyExport.headers.location,
    // @ts-expect-error validation details exist only on invalid_request
    anyCreate.body.error.details,
    // @ts-expect-error the layout conflict carries no current state (only the destination conflict does)
    ({} as UpdateLayoutResult & { status: 409 }).body.error.current,
  ];
}

/* ── HEY-161: the client ─────────────────────────────────────────────────────────────────────────────────────── */

declare const apiKey: string;
const heyqr = new HeyQrClient({ apiKey, baseUrl: "https://heyqr.example" });

export async function createAndRead(): Promise<{ qr: string; layoutRevision: LayoutRevision; destinationRevision: DestinationRevision }> {
  const created: CreateQrResponse = await heyqr.createQr(createDynamic);
  const first = created.layouts[0];
  if (!first) throw new Error("no layout");
  const layout: Layout = await heyqr.getLayout(created.id, first.id);
  const destination: Destination = await heyqr.getDestination(created.id);
  return { qr: created.id, layoutRevision: layout.revision, destinationRevision: destination.revision };
}

export function explain(error: unknown): string {
  if (!isHeyQrApiError(error)) return "not an API error";
  // Every API error has the HTTP status and the API's error code.
  return `${error.status} ${error.code}`;
}

export function creationProblems(error: CreateQrError): string[] {
  const r = error.response;
  if (r.status === 422 && r.body.error.code === "invalid_request") return r.body.error.details.map((d) => d.path);
  if (r.status === 403) return [r.body.error.code]; // "draft_limit"
  return [];
}

export function destinationMissing(error: GetDestinationError): boolean {
  return error.code === "not_found" || error.code === "not_dynamic";
}

export async function clientMisuse(): Promise<unknown[]> {
  return [
    // @ts-expect-error the base URL is required
    new HeyQrClient({ apiKey }),
    // @ts-expect-error createQr takes a CreateQrRequest: no owner field
    await heyqr.createQr({ ...createMenu, userId: "x" }),
    // @ts-expect-error getLayout needs the code and the layout id
    await heyqr.getLayout("Q8d3"),
    // @ts-expect-error a layout's revision is a string, not a DestinationRevision
    (await heyqr.getLayout("Q8d3", "L2k9")).revision satisfies DestinationRevision,
    // @ts-expect-error HEY-162: a layout update needs the layout's revision (a string), not the destination's
    await heyqr.updateLayout("Q8d3", "L2k9", { revision: 3, name: "x" }),
    // @ts-expect-error HEY-162: a destination change needs the destination's revision (a number), not a layout's
    await heyqr.updateDestination("Q8d3", { destination: "https://x.test", revision: "1764061234567890" }),
    // @ts-expect-error HEY-162: the destination route takes only destination and revision
    await heyqr.updateDestination("Q8d3", { destination: "https://x.test", revision: 3, shortLink: "x" }),
    // @ts-expect-error HEY-162: a layout update can't change the code's destination
    await heyqr.updateLayout("Q8d3", "L2k9", { revision: "1", destination: "https://x.test" }),
    // @ts-expect-error the key is private
    heyqr.apiKey,
    // @ts-expect-error get-destination errors have no draft_limit code
    ((e: GetDestinationError) => e.code === "draft_limit")(undefined as never),
  ];
}

/* ── HEY-162: read, then update from that revision; a 409 is the caller's to handle ─────────────────────────── */

export async function renameFromRead(qrCodeId: string, layoutId: string, name: string): Promise<LayoutRevision> {
  const current = await heyqr.getLayout(qrCodeId, layoutId);
  const updated: Layout = await heyqr.updateLayout(qrCodeId, layoutId, { revision: current.revision, name });
  return updated.revision;
}

export async function moveFromRead(qrCodeId: string, to: string): Promise<{ revision: DestinationRevision; changed: boolean } | "reload"> {
  const current = await heyqr.getDestination(qrCodeId);
  try {
    const next = await heyqr.updateDestination(qrCodeId, { destination: to, revision: current.revision });
    return { revision: next.revision, changed: next.changed };
  } catch (error) {
    if (isHeyQrApiError(error) && error.status === 409) return "reload";
    throw error;
  }
}

export function conflictCurrent(error: UpdateDestinationError): { destination: string; revision: DestinationRevision } | null {
  const r = error.response;
  return r.status === 409 ? r.body.error.current : null;
}

export function layoutConflict(error: UpdateLayoutError): boolean {
  const r = error.response;
  // @ts-expect-error HEY-162: the layout conflict has no current state (only the destination conflict does)
  return r.status === 409 && r.body.error.current !== undefined;
}

/* ── HEY-163: download a PNG or SVG; a 402 hands the caller the payment URL ─────────────────────────────────── */

export async function download(qrCodeId: string, layoutId: string): Promise<ExportedFile | { pay: string }> {
  try {
    return await heyqr.downloadExport(qrCodeId, layoutId, { format: "png", scale: 4 });
  } catch (error) {
    const r = (error as DownloadExportError).response;
    if (isHeyQrApiError(error) && r.status === 402) return { pay: r.body.error.paymentUrl };
    throw error;
  }
}

export async function downloadMisuse(e: DownloadExportError): Promise<unknown[]> {
  return [
    // @ts-expect-error HEY-163: downloadExport is for PNG and SVG
    await heyqr.downloadExport("Q8d3", "L2k9", { format: "pdf" }),
    // @ts-expect-error HEY-163: the API's option is "transparent": "1", not a boolean
    await heyqr.downloadExport("Q8d3", "L2k9", { format: "png", transparent: true }),
    // @ts-expect-error HEY-163: the payment URL is only on the 402 response
    e.response.body.error.paymentUrl,
    // @ts-expect-error HEY-163: the file's bytes are a Uint8Array, not a string
    (await heyqr.downloadExport("Q8d3", "L2k9", { format: "svg" })).bytes satisfies string,
  ];
}

/* ── HEY-164: telling outcomes apart with the public exports only ───────────────────────────────────────────── */

export type Outcome =
  | { kind: "ok" }
  | { kind: "timeout"; afterMs: number; mayHaveApplied: boolean }
  | { kind: "cancelled" }
  | { kind: "network" }
  | { kind: "rate_limited"; retryAfterSeconds: number | null }
  | { kind: "pay"; url: string }
  | { kind: "limit"; code: string }
  | { kind: "api"; status: number; code: string }
  | { kind: "other"; message: string };

export function classify(error: unknown, wasWrite: boolean): Outcome {
  if (error instanceof HeyQrTimeoutError) return { kind: "timeout", afterMs: error.timeoutMs, mayHaveApplied: wasWrite };
  if (error instanceof HeyQrAbortError) return { kind: "cancelled" };
  if (error instanceof HeyQrRateLimitError) return { kind: "rate_limited", retryAfterSeconds: error.retryAfterSeconds };
  if (isPaymentRequired(error)) return { kind: "pay", url: error.response.body.error.paymentUrl };
  if (isHeyQrApiError(error) && error.status === 403 && error.code === "draft_limit") return { kind: "limit", code: error.code };
  if (isHeyQrApiError(error)) return { kind: "api", status: error.status, code: error.code };
  if (error instanceof HeyQrError) return error.kind === "network" ? { kind: "network" } : { kind: "other", message: error.message };
  return { kind: "other", message: String(error) };
}

export async function withTimeouts(signal: AbortSignalLike): Promise<Outcome> {
  const slow = new HeyQrClient({ apiKey, baseUrl: "https://heyqr.example", timeoutMs: 10_000 });
  try {
    await slow.getLayout("Q8d3", "L2k9", { timeoutMs: 2_000, signal });
    return { kind: "ok" };
  } catch (error) {
    return classify(error, false);
  }
}

export function timeoutMisuse(e: HeyQrRateLimitError, t: HeyQrTimeoutError): unknown[] {
  return [
    // @ts-expect-error HEY-164: timeoutMs is a number of milliseconds
    new HeyQrClient({ apiKey, baseUrl: "https://heyqr.example", timeoutMs: "30s" }),
    // @ts-expect-error HEY-164: Retry-After may be absent: a number or null
    e.retryAfterSeconds satisfies number,
    // @ts-expect-error HEY-164: a timeout has no API error code
    t.code,
    // @ts-expect-error HEY-164: isTimeout narrows to HeyQrTimeoutError, not to an API error with a response
    ((x: unknown) => (isTimeout(x) ? x.response : null))(null),
  ];
}

/* ── HEY-165: idempotent create retries, under the caller's control ───────────────────────────────────────── */

/** Create once, retrying with the same key and request after a timeout or a lost response. */
export async function createOnce(request: CreateQrRequest, attempts = 3): Promise<CreateQrResponse> {
  const options: CreateQrOptions = { idempotencyKey: newIdempotencyKey(), timeoutMs: 10_000 };
  for (let attempt = 1; ; attempt++) {
    try {
      return await heyqr.createQr(request, options);
    } catch (error) {
      const unknownOutcome = error instanceof HeyQrTimeoutError || (error instanceof HeyQrError && error.kind === "network");
      if (!unknownOutcome || attempt >= attempts) throw error;
      // Same key, same request: the API answers with the code it created the first time, or creates it now.
    }
  }
}

export function reusedKey(error: CreateQrError): boolean {
  return isIdempotencyConflict(error) && error.response.status === 409 && error.response.body.error.code === "idempotency_key_reused";
}

export async function idempotencyMisuse(): Promise<unknown[]> {
  return [
    // @ts-expect-error HEY-165: the key is a string
    await heyqr.createQr(createMenu, { idempotencyKey: 42 }),
    // @ts-expect-error HEY-165: only createQr takes an idempotency key
    await heyqr.getLayout("Q8d3", "L2k9", { idempotencyKey: "k" }),
    // @ts-expect-error HEY-165: a create's 409 is idempotency_key_reused, never a revision conflict
    ((e: CreateQrError) => e.response.status === 409 && e.response.body.error.code === "revision_conflict")(undefined as never),
  ];
}

export type { QrMode };
