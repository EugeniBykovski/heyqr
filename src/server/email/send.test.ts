import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/* HEY-74: the Resend mailer reports sent / skipped / failed, never throws, and logs no secrets or contents. */
const KEY = "re_test_SECRET_never_logged";
const TO = "owner@example.test";
const state = { configured: true, appEnv: "dev" as "dev" | "production" };
const sendMock = vi.fn();
const constructed: string[] = [];

vi.mock("server-only", () => ({}));
vi.mock("@/env", () => ({ env: { NEXT_PUBLIC_APP_URL: "http://localhost:3000" } }));
vi.mock("@/server/config", () => ({
  get appEnv() {
    return state.appEnv;
  },
  isConfigured: () => state.configured,
  emailConfig: () => {
    if (!state.configured) throw Object.assign(new Error("Email (Resend) is not configured"), { name: "IntegrationNotConfiguredError" });
    return { RESEND_API_KEY: KEY, EMAIL_FROM: "HeyQR <onboarding@resend.dev>" };
  },
}));
vi.mock("resend", () => ({
  Resend: class {
    emails = { send: (...a: unknown[]) => sendMock(...a) };
    constructor(key: string) {
      constructed.push(key);
    }
  },
}));
const { sendPurchaseReceipt } = await import("./send");

const receipt = { to: TO, name: "Ana Reyes", qrCodeId: "qr_123", amountTotal: 499, currency: "usd" };
let logs: string[] = [];

beforeEach(() => {
  state.configured = true;
  state.appEnv = "dev";
  sendMock.mockReset();
  logs = [];
  for (const level of ["info", "error", "warn", "log"] as const)
    vi.spyOn(console, level).mockImplementation((...a: unknown[]) => void logs.push(a.map(String).join(" ")));
});
afterEach(() => vi.restoreAllMocks());

const leaked = () => logs.filter((l) => l.includes(KEY) || l.includes(TO) || l.includes("dashboard/qr") || l.includes("Ana"));

describe("Resend mailer (HEY-74)", () => {
  it("sends the receipt from EMAIL_FROM with the key from the server env, and returns Resend's id", async () => {
    sendMock.mockResolvedValue({ data: { id: "email_1" }, error: null });
    expect(await sendPurchaseReceipt(receipt)).toEqual({ status: "sent", id: "email_1" });
    expect(constructed).toContain(KEY);
    const [message] = sendMock.mock.calls[0] ?? [];
    expect(message).toMatchObject({ from: "HeyQR <onboarding@resend.dev>", to: TO, subject: "Your Hey QR code is ready to download" });
    expect(message.react).toBeTruthy();
    expect(logs).toEqual([]);
  });

  it("a Resend rejection is a failed send with a useful reason, and logs no key, recipient, contents or link", async () => {
    sendMock.mockResolvedValue({
      data: null,
      error: { name: "validation_error", statusCode: 403, message: `You can only send testing emails to your own email address (${TO}).` },
    });
    expect(await sendPurchaseReceipt(receipt)).toEqual({ status: "failed", reason: "validation_error (403)" });
    expect(logs).toEqual(["[email] purchase receipt failed: validation_error (403)"]);
    expect(leaked()).toEqual([]);
  });

  it("a request that throws (network) is a failed send, not an exception for the Stripe webhook", async () => {
    sendMock.mockRejectedValue(Object.assign(new Error(`fetch failed for ${KEY}`), { name: "TypeError" }));
    await expect(sendPurchaseReceipt(receipt)).resolves.toEqual({ status: "failed", reason: "TypeError" });
    expect(leaked()).toEqual([]);
  });

  it("dev without Resend credentials skips the email without calling Resend", async () => {
    state.configured = false;
    expect(await sendPurchaseReceipt(receipt)).toEqual({ status: "skipped" });
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("production without credentials is a failed send (never silently skipped)", async () => {
    state.configured = false;
    state.appEnv = "production";
    expect(await sendPurchaseReceipt(receipt)).toEqual({ status: "failed", reason: "IntegrationNotConfiguredError" });
    expect(sendMock).not.toHaveBeenCalled();
  });
});
