import { formatMoney, PACK_CREDITS, PLANS, type Currency, type Offer } from "@/shared/config/catalog";
import type { CompareCell, ComparePlan, CompareRow } from "./plan-compare";

import type { getTranslations } from "next-intl/server";

/** The `plans` messages translator (next-intl). */
type T = Awaited<ReturnType<typeof getTranslations<"plans">>>;

/*
 * Pricing "Compare" (HEY-72): every price and allowance from the catalog, in the same currency as the offer cards.
 * Monthly static unlocks and Dynamic slots (live at the same time) are separate rows; post-cancellation access is
 * stated only for the subscriptions, since one-time offers aren't cancelled.
 */
export function compareData(t: T, sheet: Record<Offer, number | null>, currency: Currency): { plans: ComparePlan[]; rows: CompareRow[] } {
  const money = (cents: number | null) => formatMoney(cents, currency);
  const pp = money(sheet.printPack);
  const yes: CompareCell = { kind: "yes" };
  const no: CompareCell = { kind: "no" };
  const na: CompareCell = { kind: "na" };
  const text = (value: string, note?: string): CompareCell => ({ kind: "text", text: value, note });

  const plans: ComparePlan[] = [
    { id: "free", name: t("free.title"), model: t("cmp.model.free"), prices: [{ price: money(0) }] },
    { id: "single", name: t("single.title"), model: t("cmp.model.once"), prices: [{ price: money(sheet.single), unit: t("cmp.once") }] },
    {
      id: "packs",
      name: t("packs.title"),
      model: t("cmp.model.credits"),
      prices: (["pack3", "pack10"] as const).map((id) => ({ price: money(sheet[id]), unit: t("packs.unit", { n: PACK_CREDITS[id] }) })),
    },
    {
      id: "starter",
      name: t("starter.title"),
      model: t("cmp.model.monthly"),
      prices: [{ price: money(sheet.starter), unit: t("cmp.mo") }],
    },
    {
      id: "studio",
      name: t("studio.title"),
      model: t("cmp.model.monthly"),
      prices: [{ price: money(sheet.studio), unit: t("cmp.mo") }],
      highlight: true,
    },
  ];

  const ppAdd = text(t("cmp.ppAdd", { price: pp }));
  const unlocks = (plan: "starter" | "studio") => text(t("cmp.perMonth", { n: PLANS[plan].unlocks }), t("cmp.noRollover"));
  const slots = (plan: "starter" | "studio") => text(t("cmp.atOnce", { n: PLANS[plan].dyn }), t("cmp.freeSlot"));
  const afterCancel = text(t("cmp.stay"), t("cmp.dynStop"));
  const rows: CompareRow[] = [
    { id: "live", label: t("cmp.live"), cells: [yes, yes, yes, yes, yes] },
    {
      id: "static",
      label: t("cmp.static"),
      hint: t("cmp.staticHint"),
      cells: [no, text(t("cmp.oneQr")), text(t("cmp.perCredit"), t("cmp.noExpiry")), unlocks("starter"), unlocks("studio")],
    },
    { id: "dynamic", label: t("cmp.dynamic"), hint: t("cmp.dynamicHint"), cells: [no, no, no, slots("starter"), slots("studio")] },
    { id: "analytics", label: t("cmp.analytics"), cells: [no, no, no, text(t("cmp.basic"), t("cmp.daily")), text(t("cmp.perCode"))] },
    {
      id: "printPack",
      label: t("cmp.printPack"),
      cells: [no, ppAdd, ppAdd, ppAdd, text(t("cmp.ppStudio", { n: PLANS.studio.packs }), t("cmp.ppThen", { price: pp }))],
    },
    { id: "repeat", label: t("cmp.repeat"), cells: [no, yes, yes, yes, yes] },
    { id: "cancel", label: t("cmp.cancel"), cells: [na, na, na, afterCancel, afterCancel] },
  ];
  return { plans, rows };
}
