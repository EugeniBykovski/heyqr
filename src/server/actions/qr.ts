"use server";

import type { QrContent } from "@heyqr/qr-core";
import { and, eq, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "../auth";
import { createCheckout, createPortalSession } from "../billing/checkout";
import { db, schema } from "../db";
import { restoreQrCodes, softDeleteQrCodes } from "../qr/delete-qr";
import { encodedValue } from "../qr/export";
import { saveQrWithLayouts } from "../qr/save-qr";
import { addLayoutFrom, updateLayoutDesign } from "../qr/update-layout";
import { newId, newShortCode } from "../db/ids";
import { activateTrialCode, startTrial } from "../billing/trial";
import { activeSubscription } from "../billing/entitlements";

export type ActionResult<T = undefined> =
  { ok: true; data: T } | { ok: false; error: "unauthorized" | "invalid" | "not_found" | "too_long" | "failed" };

const draftSchema = z.object({
  qrCodeId: z.string().optional(),
  name: z.string().trim().min(1).max(80),
  model: z.enum(["static", "dynamic"]),
  content: z.custom<QrContent>((v) => typeof v === "object" && v !== null && "type" in v),
  destination: z.url({ protocol: /^https?$/ }).optional(),
  layouts: z
    .array(
      z.object({
        id: z.string().optional(),
        name: z.string().trim().min(1).max(60),
        // Validated against the versioned design contract in saveQrWithLayouts.
        layout: z.unknown(),
        editor: z.unknown().optional(),
      }),
    )
    .min(1)
    .max(20),
});

export type DraftInput = z.infer<typeof draftSchema>;

/** Error name and database error code only; no message text, query or parameters. */
function describeError(error: unknown): string {
  if (!(error instanceof Error)) return "unknown error";
  const cause = error.cause as { code?: unknown } | undefined;
  return typeof cause?.code === "string" ? `${error.name} (database code ${cause.code})` : error.name;
}

async function guard<T>(fn: () => Promise<ActionResult<T>>): Promise<ActionResult<T>> {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof Error && error.name === "UnauthorizedError") return { ok: false, error: "unauthorized" };
    // Never log the error itself: a failed query's message carries its parameters, which can include QR content
    // such as a Wi-Fi password. Log only what identifies the failure.
    console.error(`[action] failed: ${describeError(error)}`);
    return { ok: false, error: "failed" };
  }
}

/** Saves the editor state (the guest draft is saved after Google sign-in). */
export async function saveDraft(input: DraftInput): Promise<ActionResult<{ qrCodeId: string; layoutIds: string[] }>> {
  return guard(async () => {
    const user = await requireUser();
    const parsed = draftSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: "invalid" };
    const result = await saveQrWithLayouts(db, user.id, parsed.data);
    if (result.ok) revalidatePath("/[locale]/dashboard", "page");
    return result;
  });
}

const layoutEditSchema = z.object({
  qrCodeId: z.string().min(1).max(64),
  layoutId: z.string().min(1).max(64),
  // Validated against the versioned design contract in updateLayoutDesign.
  layout: z.unknown(),
  editor: z.unknown(),
  name: z.string().max(60).optional(),
});

const addLayoutSchema = z.object({
  qrCodeId: z.string().min(1).max(64),
  name: z.string().trim().min(1).max(60),
  layout: z.unknown(),
  editor: z.unknown(),
});

/**
 * Edit design (HEY-45): saves one layout of the user's existing code. Only that layout's design changes; the code's
 * content, mode, payment, short link, destination and other layouts stay as they are.
 */
export async function saveLayoutEdit(
  input: z.input<typeof layoutEditSchema>,
): Promise<ActionResult<{ qrCodeId: string; layoutId: string }>> {
  return guard(async () => {
    const user = await requireUser();
    const parsed = layoutEditSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: "invalid" };
    const result = await updateLayoutDesign(db, user.id, parsed.data, (qr) => encodedValue(qr));
    if (result.ok) {
      revalidatePath("/[locale]/dashboard", "page");
      revalidatePath("/[locale]/dashboard/qr/[id]", "page");
    }
    return result;
  });
}

/** Design "New layout from this one": a new named layout of the user's code, from the current editor state. */
export async function addLayout(input: z.input<typeof addLayoutSchema>): Promise<ActionResult<{ layoutId: string }>> {
  return guard(async () => {
    const user = await requireUser();
    const parsed = addLayoutSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: "invalid" };
    const result = await addLayoutFrom(db, user.id, parsed.data, (qr) => encodedValue(qr), newId);
    if (result.ok) {
      revalidatePath("/[locale]/dashboard", "page");
      revalidatePath("/[locale]/dashboard/qr/[id]", "page");
    }
    return result;
  });
}

/** Design 9.1: starts the 7-day Starter trial (no card, no automatic charge); once per account. */
export async function startTrialAction(): Promise<ActionResult<{ endsAt: string }>> {
  return guard(async () => {
    const user = await requireUser();
    const result = await startTrial(db, user.id, Boolean(await activeSubscription(user.id)));
    if (!result.ok) return { ok: false, error: "invalid" };
    revalidatePath("/[locale]/dashboard", "layout");
    return { ok: true, data: { endsAt: result.endsAt.toISOString() } };
  });
}

/** Design 9.1: uses the trial's one Dynamic slot for this code (its short link goes live). */
export async function activateTrial(qrCodeId: string): Promise<ActionResult<{ shortCode: string }>> {
  return guard(async () => {
    const user = await requireUser();
    const result = await activateTrialCode(db, user.id, qrCodeId, newShortCode);
    if (!result.ok) return { ok: false, error: result.error === "not_found" ? "not_found" : "invalid" };
    revalidatePath("/[locale]/dashboard", "layout");
    return { ok: true, data: { shortCode: result.shortCode } };
  });
}

export async function renameQr(qrCodeId: string, name: string): Promise<ActionResult> {
  return guard(async () => {
    const user = await requireUser();
    const value = z.string().trim().min(1).max(80).safeParse(name);
    if (!value.success) return { ok: false, error: "invalid" };
    await db
      .update(schema.qrCode)
      .set({ name: value.data })
      .where(and(eq(schema.qrCode.id, qrCodeId), eq(schema.qrCode.userId, user.id), isNull(schema.qrCode.deletedAt)));
    revalidatePath("/[locale]/dashboard", "layout");
    return { ok: true, data: undefined };
  });
}

/** Dynamic codes: change where the printed code leads. The previous destination is kept for undo. */
export async function updateDestination(qrCodeId: string, destination: string): Promise<ActionResult> {
  return guard(async () => {
    const user = await requireUser();
    const url = z.url({ protocol: /^https?$/ }).safeParse(destination.trim());
    if (!url.success) return { ok: false, error: "invalid" };
    const qr = await db.query.qrCode.findFirst({
      where: and(eq(schema.qrCode.id, qrCodeId), eq(schema.qrCode.userId, user.id), isNull(schema.qrCode.deletedAt)),
    });
    if (!qr || qr.model !== "dynamic") return { ok: false, error: "not_found" };
    await db
      .update(schema.qrCode)
      .set({ destination: url.data, previousDestination: qr.destination })
      .where(eq(schema.qrCode.id, qrCodeId));
    revalidatePath("/[locale]/dashboard/qr/[id]", "page");
    return { ok: true, data: undefined };
  });
}

export async function startCheckout(input: {
  qrCodeId: string;
  layoutId: string;
  format: "png" | "svg" | "pdf";
  locale: string;
  resolution?: number;
  transparent?: boolean;
}): Promise<ActionResult<{ url: string }>> {
  return guard(async () => {
    const user = await requireUser();
    const resolution = z.number().int().min(1).max(1200).optional().safeParse(input.resolution);
    const url = await createCheckout({
      user,
      qrCodeId: input.qrCodeId,
      layoutId: input.layoutId,
      format: input.format,
      locale: input.locale,
      resolution: resolution.success ? resolution.data : undefined,
      transparent: input.transparent === true,
    });
    return { ok: true, data: { url } };
  });
}

export async function openBillingPortal(locale: string): Promise<ActionResult<{ url: string }>> {
  return guard(async () => {
    const user = await requireUser();
    if (!user.stripeCustomerId) return { ok: false, error: "not_found" };
    return { ok: true, data: { url: await createPortalSession(user.stripeCustomerId, locale) } };
  });
}

const idsSchema = z.array(z.string().min(1).max(64)).min(1).max(100);

/** My QR codes: delete one or several of the owner's codes. Undo is available for a short time (restoreQrs). */
export async function deleteQrs(ids: string[]): Promise<ActionResult<{ ids: string[] }>> {
  return guard(async () => {
    const user = await requireUser();
    const parsed = idsSchema.safeParse(ids);
    if (!parsed.success) return { ok: false, error: "invalid" };
    const deleted = await softDeleteQrCodes(db, user.id, parsed.data);
    if (deleted.length === 0) return { ok: false, error: "not_found" };
    revalidatePath("/[locale]/dashboard", "layout");
    revalidatePath("/[locale]", "page");
    return { ok: true, data: { ids: deleted } };
  });
}

/** Undo for deleteQrs. */
export async function restoreQrs(ids: string[]): Promise<ActionResult<{ ids: string[] }>> {
  return guard(async () => {
    const user = await requireUser();
    const parsed = idsSchema.safeParse(ids);
    if (!parsed.success) return { ok: false, error: "invalid" };
    const restored = await restoreQrCodes(db, user.id, parsed.data);
    if (restored.length === 0) return { ok: false, error: "not_found" };
    revalidatePath("/[locale]/dashboard", "layout");
    revalidatePath("/[locale]", "page");
    return { ok: true, data: { ids: restored } };
  });
}
