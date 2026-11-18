"use server";

import type { QrContent } from "@heyqr/qr-core";
import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "../auth";
import { createCheckout, createPortalSession } from "../billing/checkout";
import { db, schema } from "../db";
import { saveQrWithLayouts } from "../qr/save-qr";

export type ActionResult<T = undefined> = { ok: true; data: T } | { ok: false; error: "unauthorized" | "invalid" | "not_found" | "failed" };

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

async function guard<T>(fn: () => Promise<ActionResult<T>>): Promise<ActionResult<T>> {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof Error && error.name === "UnauthorizedError") return { ok: false, error: "unauthorized" };
    console.error(error);
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

export async function renameQr(qrCodeId: string, name: string): Promise<ActionResult> {
  return guard(async () => {
    const user = await requireUser();
    const value = z.string().trim().min(1).max(80).safeParse(name);
    if (!value.success) return { ok: false, error: "invalid" };
    await db
      .update(schema.qrCode)
      .set({ name: value.data })
      .where(and(eq(schema.qrCode.id, qrCodeId), eq(schema.qrCode.userId, user.id)));
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
    const qr = await db.query.qrCode.findFirst({ where: and(eq(schema.qrCode.id, qrCodeId), eq(schema.qrCode.userId, user.id)) });
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
}): Promise<ActionResult<{ url: string }>> {
  return guard(async () => {
    const user = await requireUser();
    const url = await createCheckout({ user, ...input });
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
