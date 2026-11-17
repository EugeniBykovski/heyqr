import "server-only";
import { Resend } from "resend";
import { env } from "@/env";
import { PurchaseReceiptEmail } from "./templates/purchase-receipt";

let client: Resend | null = null;
const resend = () => (client ??= new Resend(env.RESEND_API_KEY));

export async function sendPurchaseReceipt(input: { to: string; name: string; qrCodeId: string; amountTotal: number; currency: string }) {
  const amount = new Intl.NumberFormat("en", { style: "currency", currency: input.currency.toUpperCase() }).format(input.amountTotal / 100);
  const url = `${env.NEXT_PUBLIC_APP_URL}/dashboard/qr/${input.qrCodeId}`;
  const { error } = await resend().emails.send({
    from: env.EMAIL_FROM,
    to: input.to,
    subject: "Your Hey QR code is ready to download",
    react: PurchaseReceiptEmail({ name: input.name, amount, url }),
  });
  if (error) console.error("[email] purchase receipt failed", error);
}
