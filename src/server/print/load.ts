import "server-only";
import { getCurrency } from "../currency";
import type { Layout } from "@heyqr/qr-core";
import { readPrintSettings, unsupportedProfile, type PrintSettings } from "@/entities/qr";
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
  /** HEY-102: the code it belongs to and the layout's saved revision (where its paid files are stored). */
  qrCodeId: string;
  revision: string;
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
): Promise<{ ok: true; ctx: PrintContext } | { ok: false; error: "not_found" | "not_print" | "too_long" | "unsupported_profile" }> {
  const record = await getLayoutWithQr(layoutId);
  if (!record || record.qrCode.userId !== userId) return { ok: false, error: "not_found" };
  const base = record.design.layout;
  if (base.unit !== "mm") return { ok: false, error: "not_print" };
  // HEY-196: a CMYK profile is refused (422), never answered with an sRGB file under its name.
  if (unsupportedProfile(raw)) return { ok: false, error: "unsupported_profile" };
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
      qrCodeId: record.qrCode.id,
      revision: record.updatedAt.toISOString(),
      entitled,
      unlocked,
      forSale: printPackForSale(await getCurrency()),
    },
  };
}
