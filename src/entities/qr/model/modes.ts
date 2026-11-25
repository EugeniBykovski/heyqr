import { QR_CONTENT_TYPES } from "@heyqr/qr-core";
import { HOSTED_TYPES, type QrType } from "./hosted";

/*
 * Static and dynamic QR modes, and which content types support each. The single source of truth for the editor's
 * Type step, the guest draft reader and the server save path.
 *
 *   static   the content is encoded in the pattern itself. Changing it means generating a new code.
 *   dynamic  the pattern holds a permanent short link (/r/<code>) that redirects to a destination you can change after
 *            printing. The redirect needs a web address, so of the direct types only website codes can be dynamic
 *            (design handoff: the Static/Dynamic choice appears only for Website). The seven hosted page types are
 *            always dynamic: their page lives at the short link.
 */
export const QR_MODES = ["static", "dynamic"] as const;
export type QrMode = (typeof QR_MODES)[number];

export const MODES_BY_TYPE: Record<QrType, readonly QrMode[]> = Object.fromEntries([
  ...QR_CONTENT_TYPES.map((type) => [type, type === "website" ? QR_MODES : (["static"] as const)]),
  // Hosted pages live at the code's short link: always Dynamic.
  ...HOSTED_TYPES.map((type) => [type, ["dynamic"] as const]),
]) as unknown as Record<QrType, readonly QrMode[]>;

export const supportsMode = (type: QrType, mode: QrMode) => MODES_BY_TYPE[type]?.includes(mode) ?? false;

/** The mode to use for `type`: the requested one when supported, otherwise the type's first (only) mode. */
export const modeFor = (type: QrType, mode: QrMode): QrMode => (supportsMode(type, mode) ? mode : (MODES_BY_TYPE[type]?.[0] ?? "static"));
