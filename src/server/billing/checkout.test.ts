import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * HEY-60: new checkout charges the authoritative catalog in the chosen currency (USD or PLN): the Stripe Prices of
 * the offers, verified against the shown amount and interval, as itemized line items; the purchase records the same
 * lines and currency. Stripe and the database are stubbed; the catalog rules are the real ones.
 */
vi.mock("server-only", () => ({}));
vi.mock("@/env", () => ({
  env: {
    NEXT_PUBLIC_APP_URL: "https://heyqr.test",
    STRIPE_PRICE_STATIC: "price_usd_single",
    STRIPE_PRICE_DYNAMIC_MONTHLY: "price_usd_starter",
    STRIPE_PRICE_PRINT_PACK: "price_usd_pp",
    STRIPE_PRICES: JSON.stringify({ PLN: { single: "price_pln_single", printPack: "price_pln_pp", starter: "price_pln_starter" } }),
  },
}));

/** What each test Price is in Stripe (currency, amount, interval); tests change one to check the refusal. */
const PRICES: Record<string, { currency: string; unit_amount: number; recurring: { interval: string } | null; active: boolean }> = {};
const resetPrices = () =>
  Object.assign(PRICES, {
    price_usd_single: { currency: "usd", unit_amount: 499, recurring: null, active: true },
    price_usd_pp: { currency: "usd", unit_amount: 299, recurring: null, active: true },
    price_usd_starter: { currency: "usd", unit_amount: 900, recurring: { interval: "month" }, active: true },
    price_pln_single: { currency: "pln", unit_amount: 1999, recurring: null, active: true },
    price_pln_pp: { currency: "pln", unit_amount: 1199, recurring: null, active: true },
    price_pln_starter: { currency: "pln", unit_amount: 3500, recurring: { interval: "month" }, active: true },
  });
const create = vi.fn();
vi.mock("./stripe", () => ({
  stripe: () => ({
    prices: { retrieve: async (id: string) => PRICES[id] },
    customers: { create: async () => ({ id: "cus_test" }) },
    checkout: { sessions: { create } },
  }),
}));

let qr: {
  id: string;
  model: "static" | "dynamic";
  printPackAt: Date | null;
  layouts: { id: string; design: { layout: { unit: "mm" | "px" } } }[];
};
const inserted: unknown[] = [];
vi.mock("../db", () => ({
  schema: { qrCode: { id: "id", userId: "user_id", deletedAt: "deleted_at" }, user: { id: "id" }, purchase: {} },
  db: {
    query: { qrCode: { findFirst: async () => qr } },
    update: () => ({ set: () => ({ where: async () => undefined }) }),
    insert: () => ({ values: async (v: unknown) => void inserted.push(v) }),
  },
}));

/* HEY-88: the Single QR order itself (create or reuse, attach) is covered against PostgreSQL; here, what it charges. */
const orders: { charge: { item: string; currency: string; lines: unknown[] }; layoutId?: string }[] = [];
vi.mock("./single-order", () => ({
  singleQrCheckout: async (
    _db: unknown,
    port: { create: (i: { orderId: string; previous: string | null }) => Promise<{ url: string | null }> },
    input: (typeof orders)[number],
  ) => {
    orders.push(input);
    const s = await port.create({ orderId: "order_1", previous: null });
    return { ok: true, url: s.url, orderId: "order_1", reused: false };
  },
}));

const { createCheckout, CatalogError } = await import("./checkout");
const user = { id: "u1", email: "ana@example.test", name: "Ana", stripeCustomerId: "cus_test" };
const base = { user, qrCodeId: "q1", layoutId: "l1", format: "png" as const, locale: "en" };

describe("checkout (HEY-60)", () => {
  beforeEach(() => {
    resetPrices();
    create.mockReset();
    create.mockImplementation(async (p: { line_items: { price: string }[] }) => ({
      id: "cs_test",
      url: "https://checkout.stripe.test/cs_test",
      currency: p.line_items[0]?.price.startsWith("price_pln") ? "pln" : "usd",
      amount_total: p.line_items.reduce((s, l) => s + (PRICES[l.price]?.unit_amount ?? 0), 0),
    }));
    inserted.length = 0;
    orders.length = 0;
    qr = { id: "q1", model: "static", printPackAt: null, layouts: [{ id: "l1", design: { layout: { unit: "mm" } } }] };
  });

  it("Print Pack on, PLN: Single QR + Print Pack PLN Prices, purchase 19,99 + 11,99 zł in PLN", async () => {
    await createCheckout({ ...base, currency: "PLN", printPack: true });
    const params = create.mock.calls[0]?.[0];
    expect(params.mode).toBe("payment");
    expect(params.line_items).toEqual([
      { price: "price_pln_single", quantity: 1 },
      { price: "price_pln_pp", quantity: 1 },
    ]);
    expect(params.metadata).toMatchObject({ currency: "PLN", printPack: "1", orderId: "order_1" });
    expect(params.client_reference_id).toBe("order_1");
    expect(create.mock.calls[0]?.[1]).toEqual({ idempotencyKey: expect.stringMatching(/^heyqr-order-order_1-first-[0-9a-f]{16}$/) });
    expect(orders[0]).toMatchObject({
      layoutId: "l1",
      charge: {
        item: "single_qr_print_pack",
        currency: "PLN",
        lines: [
          { offer: "single", amount: 1999 },
          { offer: "printPack", amount: 1199 },
        ],
      },
    });
    expect(inserted).toEqual([]);
  });

  it("Print Pack off by default, USD: Single QR only; a px layout never adds a Print Pack", async () => {
    await createCheckout({ ...base, currency: "USD" });
    expect(create.mock.calls[0]?.[0].line_items).toEqual([{ price: "price_usd_single", quantity: 1 }]);
    expect(orders[0]?.charge).toMatchObject({ item: "single_qr", currency: "USD", lines: [{ offer: "single", amount: 499 }] });
    qr.layouts = [{ id: "l1", design: { layout: { unit: "px" } } }];
    await createCheckout({ ...base, currency: "USD", printPack: true });
    expect(create.mock.calls[1]?.[0].line_items).toEqual([{ price: "price_usd_single", quantity: 1 }]);
  });

  it("Dynamic: the monthly Starter Price in the same currency, Print Pack on the first invoice", async () => {
    qr.model = "dynamic";
    await createCheckout({ ...base, currency: "PLN", printPack: true });
    const params = create.mock.calls[0]?.[0];
    expect(params.mode).toBe("subscription");
    expect(params.line_items.map((l: { price: string }) => l.price)).toEqual(["price_pln_starter", "price_pln_pp"]);
  });

  it("refuses a Stripe Price that differs from the catalog, and an offer without one; nothing is created", async () => {
    PRICES.price_pln_pp = { currency: "pln", unit_amount: 999, recurring: null, active: true };
    await expect(createCheckout({ ...base, currency: "PLN", printPack: true })).rejects.toMatchObject({ code: "price_mismatch" });
    PRICES.price_usd_single = { currency: "eur", unit_amount: 499, recurring: null, active: true };
    await expect(createCheckout({ ...base, currency: "USD" })).rejects.toBeInstanceOf(CatalogError);
    qr.model = "dynamic";
    await expect(createCheckout({ ...base, currency: "PLN", plan: "studio" })).rejects.toMatchObject({ code: "not_offered" });
    expect(create).not.toHaveBeenCalled();
    expect(inserted).toEqual([]);
    expect(orders).toEqual([]);
  });
});
