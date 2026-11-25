"use server";

import type { AnyQrContent } from "@/entities/qr/model/hosted";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "../auth";
import { createCheckout, createPrintPackCheckout } from "../billing/checkout";
import { createPortalSession, isPortalIntent, portalFeatures } from "../billing/portal";
import { currentPlan, overdueSubscription } from "../billing/allowances";
import { getCurrency } from "../currency";
import { guard, type ActionResult } from "./result";

export type { ActionResult } from "./result";
import { db } from "../db";
import { restoreQrCodes, softDeleteQrCodes } from "../qr/delete-qr";
import { encodedValue } from "../qr/export";
import { readLayoutRecord } from "../../entities/qr/model/design-schema";
import { ownedLayout } from "../qr/file-access";
import { hostedContentFor, logosFor } from "../qr/logos-for";
import { renameQrCode } from "../qr/rename-qr";
import { saveQrWithLayouts } from "../qr/save-qr";
import { changeDestination, isRevision, type DestinationConflict, type DestinationState } from "../qr/destination";
import { addLayoutFrom, copyLayout, removeLayout, updateLayoutDesign } from "../qr/update-layout";
import { newId, newShortCode } from "../db/ids";
import { activateTrialCode, startTrial } from "../billing/trial";
import { activeSubscription, canDownload, printPackForSale } from "../billing/entitlements";
import { storedCustomer } from "../billing/customer";

const draftSchema = z.object({
  qrCodeId: z.string().optional(),
  // HEY-77: the browser draft's random key (see saveQrWithLayouts). The owner always comes from the session.
  claimKey: z
    .string()
    .regex(/^[A-Za-z0-9_-]{16,64}$/)
    .optional(),
  name: z.string().trim().min(1).max(80),
  model: z.enum(["static", "dynamic"]),
  // Direct content is checked by its encoder; hosted content against its stored shape (saveQrWithLayouts).
  content: z.custom<AnyQrContent>((v) => typeof v === "object" && v !== null && "type" in v),
  // HEY-119: checked by parseDestination in saveQrWithLayouts, the same check as Change destination.
  destination: z.string().max(2048).optional(),
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

/** Saves the editor state (the guest draft is saved after Google sign-in). */
export async function saveDraft(input: DraftInput): Promise<ActionResult<{ qrCodeId: string; layoutIds: string[] }>> {
  return guard(async () => {
    const user = await requireUser();
    const parsed = draftSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: "invalid" };
    const result = await saveQrWithLayouts(db, user.id, parsed.data, logosFor(user.id), hostedContentFor(user.id));
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
  // HEY-85: the revision the editor opened; a newer save in the meantime makes this one a conflict.
  revision: z.string().regex(/^\d{1,20}$/),
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
): Promise<ActionResult<{ qrCodeId: string; layoutId: string; revision: string }>> {
  return guard(async () => {
    const user = await requireUser();
    const parsed = layoutEditSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: "invalid" };
    const result = await updateLayoutDesign(db, user.id, parsed.data, (qr) => encodedValue(qr), logosFor(user.id));
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
    const result = await addLayoutFrom(db, user.id, parsed.data, (qr) => encodedValue(qr), newId, logosFor(user.id));
    if (result.ok) {
      revalidatePath("/[locale]/dashboard", "page");
      revalidatePath("/[locale]/dashboard/qr/[id]", "page");
    }
    return result;
  });
}

/** HEY-82 QR details "New layout": a copy of one of the owner's saved layouts, under the same code. */
export async function duplicateLayout(input: {
  qrCodeId: string;
  sourceLayoutId: string;
  name: string;
}): Promise<ActionResult<{ layoutId: string }>> {
  return guard(async () => {
    const user = await requireUser();
    const parsed = z
      .object({ qrCodeId: z.string().min(1).max(64), sourceLayoutId: z.string().min(1).max(64), name: z.string().trim().min(1).max(60) })
      .safeParse(input);
    if (!parsed.success) return { ok: false, error: "invalid" };
    const result = await copyLayout(db, user.id, parsed.data, newId);
    if (result.ok) {
      revalidatePath("/[locale]/dashboard", "page");
      revalidatePath("/[locale]/dashboard/qr/[id]", "page");
    }
    return result;
  });
}

/** QR details "Delete layout": one layout of the owner's code; the code keeps at least one (server-enforced). */
export async function deleteLayout(input: { qrCodeId: string; layoutId: string }): Promise<ActionResult<{ remaining: number }>> {
  return guard(async () => {
    const user = await requireUser();
    const parsed = z.object({ qrCodeId: z.string().min(1).max(64), layoutId: z.string().min(1).max(64) }).safeParse(input);
    if (!parsed.success) return { ok: false, error: "invalid" };
    const result = await removeLayout(db, user.id, parsed.data);
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

/** Design 8.2: Stripe Checkout for this code's Print Pack (only when the code is unlocked and the add-on is for sale). */
export async function startPrintPackCheckout(input: {
  qrCodeId: string;
  layoutId: string;
  settings: string;
  locale: string;
}): Promise<ActionResult<{ url: string }>> {
  return guard(async () => {
    const user = await requireUser();
    if (!printPackForSale(await getCurrency())) return { ok: false, error: "not_offered" };
    // HEY-84: the user's unlocked code and one of its print (mm) layouts; a Print Pack is bought once per code.
    const owned = await ownedLayout(db, user.id, input.qrCodeId, input.layoutId);
    if (!owned || !(await canDownload(user.id, owned.qr))) return { ok: false, error: "not_found" };
    const qr = owned.qr;
    if (qr.printPackAt) return { ok: false, error: "owned" };
    const read = readLayoutRecord(owned.layout.design);
    if (!read.ok || read.value.layout.unit !== "mm") return { ok: false, error: "invalid" };
    const settings = z
      .string()
      .max(200)
      .regex(/^[\w=&.%-]*$/)
      .safeParse(input.settings);
    if (!settings.success) return { ok: false, error: "invalid" };
    const url = await createPrintPackCheckout({
      user,
      currency: await getCurrency(),
      qrCodeId: qr.id,
      layoutId: input.layoutId,
      settings: settings.data,
      locale: input.locale,
    });
    return { ok: true, data: { url } };
  }, "checkout.create_print_pack");
}

export async function renameQr(qrCodeId: string, name: string): Promise<ActionResult> {
  return guard(async () => {
    const user = await requireUser();
    if (typeof name !== "string" || typeof qrCodeId !== "string") return { ok: false, error: "invalid" };
    const result = await renameQrCode(db, user.id, qrCodeId, name);
    if (!result.ok) return result;
    revalidatePath("/[locale]/dashboard", "layout");
    return { ok: true, data: undefined };
  });
}

/**
 * Dynamic codes: change where the printed code leads. The previous destination is kept for undo. HEY-119: the address
 * is checked by parseDestination (the editor's parser); the result carries the URL stored, or the field error.
 * HEY-128: a save from an older destination revision is a conflict carrying the latest published state.
 */
export async function updateDestination(
  qrCodeId: string,
  destination: string,
  revision: number,
): Promise<ActionResult<DestinationState> | DestinationConflict> {
  return guard<DestinationState, DestinationConflict>(async () => {
    const user = await requireUser();
    // HEY-128: every save names the destination revision its edit was opened with.
    if (typeof qrCodeId !== "string" || !isRevision(revision)) return { ok: false, error: "invalid" };
    const result = await changeDestination(db, user.id, qrCodeId, destination, revision);
    if (result.ok) revalidatePath("/[locale]/dashboard/qr/[id]", "page");
    return result;
  });
}

export async function startCheckout(input: {
  qrCodeId: string;
  layoutId: string;
  format: "png" | "svg" | "pdf";
  locale: string;
  resolution?: number;
  transparent?: boolean;
  /** Design 7.2: add this code's Print Pack to the same order (mm layouts only; the server checks). */
  printPack?: boolean;
  plan?: "starter" | "studio";
}): Promise<ActionResult<{ url: string }>> {
  return guard(async () => {
    const user = await requireUser();
    // HEY-84: the user's code and a layout of that code, before anything goes to Stripe (metadata, return URL).
    const owned = await ownedLayout(db, user.id, input.qrCodeId, input.layoutId);
    if (!owned) return { ok: false, error: "not_found" };
    // HEY-87: a static code that is already unlocked is never sold again (no order, no Checkout Session).
    if (owned.qr.model === "static" && (await canDownload(user.id, owned.qr))) return { ok: false, error: "owned" };
    const resolution = z.number().int().min(1).max(1200).optional().safeParse(input.resolution);
    const checkout = await createCheckout({
      user,
      currency: await getCurrency(),
      printPack: input.printPack === true,
      plan: input.plan === "studio" ? "studio" : "starter",
      qrCodeId: input.qrCodeId,
      layoutId: input.layoutId,
      format: input.format,
      locale: input.locale,
      resolution: resolution.success ? resolution.data : undefined,
      transparent: input.transparent === true,
    });
    // HEY-88: the code went away or was unlocked meanwhile, or its order's last session is being paid.
    // HEY-133: an account with a plan activates Dynamic codes under it instead of a second subscription.
    if ("error" in checkout) return { ok: false, error: checkout.error === "has_plan" ? "invalid" : checkout.error };
    return { ok: true, data: { url: checkout.url } };
  }, "checkout.create");
}

/**
 * HEY-139: Stripe's Customer Portal for the signed-in account's stored Customer: its home ("manage"), the payment
 * method update ("payment") or the switch to Studio ("upgrade"), each only when the Portal configuration allows it and
 * the account's state fits. The return URL is built on the server. No Customer yet: "not_found"; Stripe failing: "failed".
 */
export async function openBillingPortal(locale: string, intent: unknown = "manage"): Promise<ActionResult<{ url: string }>> {
  return guard(async () => {
    const user = await requireUser();
    if (typeof locale !== "string" || !isPortalIntent(intent)) return { ok: false, error: "invalid" };
    // HEY-132: the account's stored Customer (the same one its Checkouts use), read from the database.
    const customer = await storedCustomer(db, user.id);
    if (!customer) return { ok: false, error: "not_found" };
    let subscriptionId: string | null = null;
    if (intent === "recover") {
      // HEY-141: only while a renewal is overdue or unpaid. The Portal's home offers the payment method update and
      // "Pay failed amount" for the open invoice. Access changes only when Stripe's webhook reports the payment.
      const overdue = await overdueSubscription(db, user.id);
      if (!overdue) return { ok: false, error: "invalid" };
      subscriptionId = overdue.stripeSubscriptionId;
    } else if (intent !== "manage") {
      const [features, plan, subscription] = await Promise.all([portalFeatures(), currentPlan(db, user.id), activeSubscription(user.id)]);
      const allowed =
        intent === "payment" ? features.paymentMethodUpdate && Boolean(subscription) : features.upgrade && plan?.id === "starter";
      if (!allowed || !subscription) return { ok: false, error: "invalid" };
      subscriptionId = subscription.stripeSubscriptionId;
    }
    return { ok: true, data: { url: await createPortalSession(customer, locale, intent, subscriptionId) } };
  }, "billing.portal");
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
