import "server-only";
import { Resend } from "resend";
import { env } from "@/env";
import { appEnv, emailConfig, isConfigured } from "@/server/config";
import { PurchaseReceiptEmail } from "./templates/purchase-receipt";

let client: Resend | null = null;
const resend = () => (client ??= new Resend(emailConfig().RESEND_API_KEY));

export async function sendPurchaseReceipt(input: { to: string; name: string; qrCodeId: string; amountTotal: number; currency: string }) {
  // Email is optional in dev: without Resend credentials the receipt is skipped, not failed.
  if (!isConfigured("email") && appEnv === "dev") {
    console.info("[email] Resend is not configured for dev; skipped the purchase receipt.");
    return;
  }
  const amount = new Intl.NumberFormat("en", { style: "currency", currency: input.currency.toUpperCase() }).format(input.amountTotal / 100);
  const url = `${env.NEXT_PUBLIC_APP_URL}/dashboard/qr/${input.qrCodeId}`;
  const { error } = await resend().emails.send({
    from: emailConfig().EMAIL_FROM,
    to: input.to,
    subject: "Your Hey QR code is ready to download",
    react: PurchaseReceiptEmail({ name: input.name, amount, url }),
  });
  if (error) console.error("[email] purchase receipt failed", error);
}
