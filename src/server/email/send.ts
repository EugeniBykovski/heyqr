import "server-only";
import type { ReactElement } from "react";
import { Resend } from "resend";
import { env } from "@/env";
import { appEnv, emailConfig, isConfigured } from "@/server/config";
import { PurchaseReceiptEmail } from "./templates/purchase-receipt";

let client: Resend | null = null;
const resend = () => (client ??= new Resend(emailConfig().RESEND_API_KEY));

/**
 * HEY-74: what happened to a transactional email. "failed" covers both a Resend rejection (its error object) and a
 * request that threw (network, configuration); the reason is the error name and HTTP status only.
 */
export type EmailResult = { status: "sent"; id: string } | { status: "skipped" } | { status: "failed"; reason: string };

/**
 * Sends one email and never throws: a receipt must not fail the Stripe webhook that already recorded the payment
 * (a thrown error would make Stripe retry it). Logs carry the email kind and the failure reason, never the API key,
 * the recipient, the contents or links, or Resend's message text (it can include account addresses).
 */
type Message = { to: string; subject: string; react: ReactElement };

async function send(kind: string, message: Message): Promise<EmailResult> {
  // Email is optional in dev: without Resend credentials it is skipped, not failed.
  if (!isConfigured("email") && appEnv === "dev") {
    console.info(`[email] ${kind}: Resend is not configured for dev; skipped.`);
    return { status: "skipped" };
  }
  try {
    // The sender comes from EMAIL_FROM (dev: "HeyQR <onboarding@resend.dev>" until a domain is verified).
    const { data, error } = await resend().emails.send({ from: emailConfig().EMAIL_FROM, ...message });
    if (error || !data) {
      const reason = error ? `${error.name}${"statusCode" in error && error.statusCode ? ` (${error.statusCode})` : ""}` : "no_response";
      console.error(`[email] ${kind} failed: ${reason}`);
      return { status: "failed", reason };
    }
    return { status: "sent", id: data.id };
  } catch (e) {
    const reason = e instanceof Error ? e.name : "unknown_error";
    console.error(`[email] ${kind} failed: ${reason}`);
    return { status: "failed", reason };
  }
}

export async function sendPurchaseReceipt(input: {
  to: string;
  name: string;
  qrCodeId: string;
  amountTotal: number;
  currency: string;
}): Promise<EmailResult> {
  const amount = new Intl.NumberFormat("en", { style: "currency", currency: input.currency.toUpperCase() }).format(input.amountTotal / 100);
  const url = `${env.NEXT_PUBLIC_APP_URL}/dashboard/qr/${input.qrCodeId}`;
  return send("purchase receipt", {
    to: input.to,
    subject: "Your Hey QR code is ready to download",
    react: PurchaseReceiptEmail({ name: input.name, amount, url }),
  });
}
