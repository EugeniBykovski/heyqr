"use server";
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { z } from "zod";
import { CURRENCIES, CURRENCY_COOKIE } from "@/shared/config/catalog";
import { requireUser } from "../auth";
import { accountUsage, activateDynamicCode, applyPrintPackAllowance, convertToStatic, unlockStatic } from "../billing/allowances";
import { createPackCheckout, createPlanCheckout } from "../billing/checkout";
import { trialCode } from "../billing/trial";
import { getCurrency } from "../currency";
import { db } from "../db";
import { newShortCode } from "../db/ids";
import { guard, type ActionResult } from "./result";

/** Design 7.1 "Show prices in": stores the viewer's currency (independent of the language), for a year. */
export async function setCurrency(currency: string): Promise<ActionResult> {
  const parsed = z.enum(CURRENCIES).safeParse(currency);
  if (!parsed.success) return { ok: false, error: "invalid" };
  (await cookies()).set(CURRENCY_COOKIE, parsed.data, { path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax" });
  return { ok: true, data: undefined };
}

/** Design 4.8 "Buy 3 credits" / "Buy 10 credits": Stripe Checkout for a Static Pack in the viewer's currency. */
export async function startPackCheckout(input: { pack: "pack3" | "pack10"; locale: string }): Promise<ActionResult<{ url: string }>> {
  return guard(async () => {
    const user = await requireUser();
    const pack = z.enum(["pack3", "pack10"]).safeParse(input.pack);
    if (!pack.success) return { ok: false, error: "invalid" };
    return {
      ok: true,
      data: { url: await createPackCheckout({ user, currency: await getCurrency(), pack: pack.data, locale: input.locale }) },
    };
  });
}

/**
 * Design 4.8 "Choose Studio" / "Subscribe" and 9.1 "Activate Starter": the plan's Checkout. From the trial, the test
 * code goes with it and keeps its short link.
 */
export async function startPlanCheckout(input: {
  plan: "starter" | "studio";
  locale: string;
  returnTo: "billing" | "trial";
}): Promise<ActionResult<{ url: string }>> {
  return guard(async () => {
    const user = await requireUser();
    const plan = z.enum(["starter", "studio"]).safeParse(input.plan);
    if (!plan.success) return { ok: false, error: "invalid" };
    const usage = await accountUsage(db, user.id);
    if (usage.plan) return { ok: false, error: "invalid" };
    const test = input.returnTo === "trial" ? await trialCode(db, user.id) : null;
    const url = await createPlanCheckout({
      user,
      currency: await getCurrency(),
      plan: plan.data,
      locale: input.locale,
      returnTo: input.returnTo,
      qrCodeId: test?.id,
    });
    return { ok: true, data: { url } };
  });
}

/** Design 7.5 "Use 1 included unlock" (plan) / "Use 1 static credit": unlocks a static code without paying. */
export async function unlockWithAllowance(input: { qrCodeId: string; via: "plan" | "credit" }): Promise<ActionResult> {
  return guard(async () => {
    const user = await requireUser();
    const via = z.enum(["plan", "credit"]).safeParse(input.via);
    if (!via.success) return { ok: false, error: "invalid" };
    const result = await unlockStatic(db, user.id, input.qrCodeId, via.data);
    if (!result.ok)
      return {
        ok: false,
        error:
          result.error === "no_allowance" || result.error === "no_credits"
            ? result.error
            : result.error === "owned"
              ? "invalid"
              : "not_found",
      };
    revalidatePath("/[locale]/dashboard", "layout");
    return { ok: true, data: undefined };
  });
}

/** Design 8.4 "Use 1 included Print Pack" (Studio). */
export async function takeIncludedPrintPack(qrCodeId: string): Promise<ActionResult> {
  return guard(async () => {
    const user = await requireUser();
    const result = await applyPrintPackAllowance(db, user.id, qrCodeId);
    if (!result.ok)
      return { ok: false, error: result.error === "no_allowance" ? "no_allowance" : result.error === "owned" ? "invalid" : "not_found" };
    revalidatePath("/[locale]/dashboard", "layout");
    return { ok: true, data: undefined };
  });
}

/** Design 7.7: the plan has a free live slot: this Dynamic code goes live (short link) without another payment. */
export async function activateDynamic(qrCodeId: string): Promise<ActionResult<{ shortCode: string }>> {
  return guard(async () => {
    const user = await requireUser();
    const result = await activateDynamicCode(db, user.id, qrCodeId, newShortCode);
    if (!result.ok) return { ok: false, error: result.error === "limit" ? "limit" : result.error === "no_plan" ? "invalid" : "not_found" };
    revalidatePath("/[locale]/dashboard", "layout");
    return { ok: true, data: { shortCode: result.shortCode } };
  });
}

/** Design 7.7 "Make it a static QR instead". */
export async function makeStatic(qrCodeId: string): Promise<ActionResult> {
  return guard(async () => {
    const user = await requireUser();
    const result = await convertToStatic(db, user.id, qrCodeId);
    if (!result.ok) return { ok: false, error: "invalid" };
    revalidatePath("/[locale]/dashboard", "layout");
    return { ok: true, data: undefined };
  });
}
