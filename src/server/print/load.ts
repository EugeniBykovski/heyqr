import "server-only";
import type { Layout } from "@heyqr/qr-core";
import { readPrintSettings, type PrintSettings } from "@/entities/qr";
import { canDownload, canDownloadPrintPack, printPackForSale } from "../billing/entitlements";
import { encodedValue, withEmbeddedImages } from "../qr/export";
import { getLayoutWithQr } from "../qr/repository";
import { printPage, type PrintPage } from "./print";

export type PrintContext = {
  layout: Layout;
  page: PrintPage;
  /** What the printed code encodes. */
  value: string;
  settings: PrintSettings;
  name: string;
  layoutName: string;
  entitled: boolean;
  unlocked: boolean;
  forSale: boolean;
};

/**
 * One saved layout of the user's own code, prepared for print with these settings. Print needs a layout in mm (design
 * "Print Pack needs a print layout measured in mm"). The revision is the layout's saved time, so a preview made before
 * a later save no longer matches the files (409 in the files route).
 */
export async function loadPrint(
  userId: string,
  layoutId: string,
  raw: Record<string, unknown>,
): Promise<{ ok: true; ctx: PrintContext } | { ok: false; error: "not_found" | "not_print" | "too_long" }> {
  const record = await getLayoutWithQr(layoutId);
  if (!record || record.qrCode.userId !== userId) return { ok: false, error: "not_found" };
  const base = record.design.layout;
  if (base.unit !== "mm") return { ok: false, error: "not_print" };
  const settings = readPrintSettings(raw, base);
  const layout = await withEmbeddedImages(base);
  const value = encodedValue(record.qrCode);
  let page: PrintPage;
  try {
    page = printPage(layout, value, settings, { layoutId, revision: record.updatedAt.toISOString() });
  } catch {
    return { ok: false, error: "too_long" };
  }
  const [entitled, unlocked] = await Promise.all([canDownload(userId, record.qrCode), canDownloadPrintPack(userId, record.qrCode)]);
  return {
    ok: true,
    ctx: {
      layout,
      page,
      value,
      settings,
      name: record.qrCode.name,
      layoutName: record.name,
      entitled,
      unlocked,
      forSale: printPackForSale(),
    },
  };
}
