import { and, eq, isNull } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { z } from "zod";
import { canDownloadCode } from "../../billing/access";
import * as schema from "../../db/schema";
import type { Problem } from "./create-qr";

/*
 * HEY-158 / QR-21.06: GET /api/v1/qr-codes/{qrCodeId}/layouts/{layoutId}/export?format=png|svg|pdf
 * Decides, on every request and before anything is rendered, signed or offered:
 *   1. the request's options are valid (strict query: format, dpi, scale, transparent);
 *   2. the code is the verified key owner's, not deleted, and the layout belongs to it (otherwise one "not found");
 *   3. the owner may download this code's files now: the dashboard's own rule (access.ts canDownloadCode). A Static code
 *      needs its purchase; a Dynamic code must be live under a plan or be the running trial's test code.
 * Not entitled: a HeyQR payment URL for the same code, layout and format (the Export screen, where the signed-in owner
 * chooses to pay or activate). Nothing here creates a charge, a Checkout Session or an order, and no URL carries the key.
 * Plain module (no "server-only") so the PostgreSQL tests run it.
 */
type Db = NodePgDatabase<typeof schema>;

export const exportQuerySchema = z.strictObject({
  format: z.enum(["png", "svg", "pdf"], { error: 'format must be "png", "svg" or "pdf"' }),
  dpi: z.coerce.number().int().min(72).max(1200).optional(),
  scale: z.coerce.number().int().min(1).max(8).optional(),
  transparent: z.enum(["0", "1"]).optional(),
});

export type ExportOptions = { format: "png" | "svg" | "pdf"; dpi?: number; scale?: number; transparent: boolean };

export type ExportDecision =
  | { ok: true; options: ExportOptions }
  | { ok: false; error: "invalid_request"; details: Problem[] }
  | { ok: false; error: "not_found" }
  | {
      ok: false;
      error: "payment_required";
      paymentUrl: string;
      qrCodeId: string;
      layoutId: string;
      format: ExportOptions["format"];
      mode: "static" | "dynamic";
    };

const ID = /^[A-Za-z0-9_-]{1,64}$/;

/** The Export screen for this code, layout and file (it signs the owner in first and keeps these settings). */
export function paymentUrl(appUrl: string, qrCodeId: string, layoutId: string, options: ExportOptions): string {
  const url = new URL("/create/export", appUrl);
  url.searchParams.set("qr", qrCodeId);
  url.searchParams.set("layout", layoutId);
  url.searchParams.set("format", options.format);
  const res = options.dpi ?? options.scale;
  if (options.format === "png" && res !== undefined) url.searchParams.set("res", String(res));
  if (options.transparent) url.searchParams.set("transparent", "1");
  return url.toString();
}

export async function authorizeApiExport(
  db: Db,
  userId: string,
  input: { qrCodeId: string; layoutId: string; query: Record<string, string> },
  deps: { appUrl: string; now?: Date },
): Promise<ExportDecision> {
  const parsed = exportQuerySchema.safeParse(input.query);
  if (!parsed.success) {
    const details = parsed.error.issues.flatMap((issue): Problem[] =>
      issue.code === "unrecognized_keys"
        ? issue.keys.map((key) => ({ path: key, message: "Unknown parameter" }))
        : [{ path: issue.path.map(String).join(".") || "(query)", message: issue.message }],
    );
    return { ok: false, error: "invalid_request", details: details.slice(0, 20) };
  }
  const { format, dpi, scale, transparent } = parsed.data;
  const options: ExportOptions = {
    format,
    ...(dpi === undefined ? {} : { dpi }),
    ...(scale === undefined ? {} : { scale }),
    transparent: transparent === "1",
  };

  if (!ID.test(input.qrCodeId) || !ID.test(input.layoutId)) return { ok: false, error: "not_found" };
  const [owned] = await db
    .select({ qr: schema.qrCode })
    .from(schema.qrLayout)
    .innerJoin(schema.qrCode, eq(schema.qrCode.id, schema.qrLayout.qrCodeId))
    .where(
      and(
        eq(schema.qrLayout.id, input.layoutId),
        eq(schema.qrLayout.qrCodeId, input.qrCodeId),
        eq(schema.qrCode.userId, userId),
        isNull(schema.qrCode.deletedAt),
      ),
    );
  if (!owned) return { ok: false, error: "not_found" };

  if (!(await canDownloadCode(db, userId, owned.qr, deps.now)))
    return {
      ok: false,
      error: "payment_required",
      paymentUrl: paymentUrl(deps.appUrl, input.qrCodeId, input.layoutId, options),
      qrCodeId: input.qrCodeId,
      layoutId: input.layoutId,
      format,
      mode: owned.qr.model,
    };
  return { ok: true, options };
}
