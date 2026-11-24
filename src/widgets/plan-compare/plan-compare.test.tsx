// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { createTranslator } from "next-intl";
import { afterEach, describe, expect, it, vi } from "vitest";
import { formatMoney, PACK_CREDITS, PLANS, priceSheet, type Currency } from "@/shared/config/catalog";
import messages from "../../../messages/en.json";
import { compareData } from "./compare-data";
import { PlanCompare } from "./plan-compare";

// jsdom has no layout: the scroll region just never overflows.
vi.stubGlobal(
  "ResizeObserver",
  class {
    observe() {}
    disconnect() {}
  },
);
const t = createTranslator({ locale: "en", messages, namespace: "plans" });
const labels = {
  feature: "Feature",
  region: "Plan comparison",
  more: "Scroll for more plans",
  pick: ["First plan", "Second plan"] as [string, string],
  yes: "Included",
  no: "Not included",
  na: "Doesn't apply: not a subscription",
};
const mount = (currency: Currency = "USD") => {
  const data = compareData(t, priceSheet(currency), currency);
  return render(<PlanCompare {...data} initialPair={["single", "starter"]} labels={labels} />);
};
// jsdom ignores the responsive classes: [0] is the full table (from 640 px), [1] the two-plan table.
const tables = () => screen.getAllByRole("table");
const heads = (table: HTMLElement) =>
  within(table)
    .getAllByRole("columnheader")
    .map((th) => th.textContent);
const row = (table: HTMLElement, name: RegExp) => within(table).getByRole("rowheader", { name }).closest("tr") as HTMLElement;

afterEach(cleanup);

describe("Pricing compare data (HEY-72)", () => {
  it.each(["USD", "PLN"] as const)("every price comes from the catalog in %s, each pack amount with its own price", (currency) => {
    const sheet = priceSheet(currency);
    const { plans } = compareData(t, sheet, currency);
    const money = (c: number | null) => formatMoney(c, currency);
    expect(plans.map((p) => [p.id, p.model])).toEqual([
      ["free", "Free"],
      ["single", "One-time purchase"],
      ["packs", "Credits"],
      ["starter", "Monthly subscription"],
      ["studio", "Monthly subscription"],
    ]);
    expect(plans.map((p) => p.prices)).toEqual([
      [{ price: money(0) }],
      [{ price: money(sheet.single), unit: "once" }],
      [
        { price: money(sheet.pack3), unit: `for ${PACK_CREDITS.pack3} credits` },
        { price: money(sheet.pack10), unit: `for ${PACK_CREDITS.pack10} credits` },
      ],
      [{ price: money(sheet.starter), unit: "/mo" }],
      [{ price: money(sheet.studio), unit: "/mo" }],
    ]);
  });

  it("keeps monthly static unlocks and Dynamic slots live at once apart, and post-cancellation only for subscriptions", () => {
    const { rows } = compareData(t, priceSheet("USD"), "USD");
    const cells = (id: string) => rows.find((r) => r.id === id)?.cells;
    expect(cells("static")?.slice(3)).toEqual([
      { kind: "text", text: `${PLANS.starter.unlocks} new each month`, note: "Unused ones don't roll over" },
      { kind: "text", text: `${PLANS.studio.unlocks} new each month`, note: "Unused ones don't roll over" },
    ]);
    expect(cells("dynamic")?.map((c) => (c.kind === "text" ? c.text : c.kind))).toEqual([
      "no",
      "no",
      "no",
      `${PLANS.starter.dyn} live at once`,
      `${PLANS.studio.dyn} live at once`,
    ]);
    const cancel = cells("cancel") ?? [];
    expect(cancel.slice(0, 3).every((c) => c.kind === "na")).toBe(true);
    expect(cancel.slice(3)).toEqual(
      Array(2).fill({
        kind: "text",
        text: "Static codes stay downloadable",
        note: "No Dynamic downloads or activations after the paid period",
      }),
    );
    expect(cells("printPack")?.[4]).toEqual({
      kind: "text",
      text: `${PLANS.studio.packs} included each month`,
      note: "Then +$2.99 per QR",
    });
  });
});

describe("Pricing compare table (HEY-72)", () => {
  it("shows all five offers with plan names, prices and billing model in the column headers", () => {
    mount();
    const [full] = tables();
    if (!full) throw new Error("no table");
    const h = heads(full);
    expect(h).toHaveLength(6);
    expect(h[3]).toBe("CreditsStatic Packs$11.99for 3 credits$24.99for 10 credits");
    expect(h[5]).toContain("Monthly subscriptionStudio$24.00/mo");
  });

  it("gives checkmarks and dashes a text equivalent", () => {
    mount();
    const [full] = tables();
    if (!full) throw new Error("no table");
    const repeat = within(row(full, /Repeat downloads/))
      .getAllByRole("cell")
      .map((c) => c.textContent);
    expect(repeat).toEqual(["—Not included", "Included", "Included", "Included", "Included"]);
    const cancel = within(row(full, /After you cancel/)).getAllByRole("cell")[0];
    expect(cancel?.textContent).toBe("—Doesn't apply: not a subscription");
  });

  it("compares two distinct, labeled plans side by side; picking the other side's plan swaps them", () => {
    mount();
    const first = screen.getByLabelText("First plan");
    const second = screen.getByLabelText("Second plan");
    const pair = () =>
      heads(tables()[1] as HTMLElement)
        .slice(1)
        .map((h) => h?.match(/(Free|Single QR|Static Packs|Starter|Studio)/)?.[0]);
    expect(pair()).toEqual(["Single QR", "Starter"]);
    fireEvent.change(second, { target: { value: "packs" } });
    expect(pair()).toEqual(["Single QR", "Static Packs"]);
    fireEvent.change(first, { target: { value: "starter" } });
    fireEvent.change(second, { target: { value: "studio" } });
    expect(pair()).toEqual(["Starter", "Studio"]);
    fireEvent.change(first, { target: { value: "studio" } });
    expect(pair()).toEqual(["Studio", "Starter"]);
  });

  it("keeps the chosen plans when the currency changes, with the new amounts", () => {
    const view = mount("USD");
    fireEvent.change(screen.getByLabelText("First plan"), { target: { value: "packs" } });
    const data = compareData(t, priceSheet("PLN"), "PLN");
    view.rerender(<PlanCompare {...data} initialPair={["single", "starter"]} labels={labels} />);
    const h = heads(tables()[1] as HTMLElement);
    expect(h[1]).toContain(`Static Packs${formatMoney(priceSheet("PLN").pack3, "PLN")}`);
    expect(h[2]).toContain(`Starter${formatMoney(priceSheet("PLN").starter, "PLN")}`);
  });
});
