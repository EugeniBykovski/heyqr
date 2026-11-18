import { QR_CONTENT_TYPES, type QrContentType } from "@heyqr/qr-core";

/*
 * Static and dynamic QR modes, and which content types support each. The single source of truth for the editor's
 * Type step, the guest draft reader and the server save path.
 *
 *   static   the content is encoded in the pattern itself. Changing it means generating a new code.
 *   dynamic  the pattern holds a permanent short link (/r/<code>) that redirects to a destination you can change after
 *            printing. The redirect needs a web address, so only website codes can be dynamic (design handoff: the
 *            Static/Dynamic choice appears only for Website).
 */
export const QR_MODES = ["static", "dynamic"] as const;
export type QrMode = (typeof QR_MODES)[number];

export const MODES_BY_TYPE: Record<QrContentType, readonly QrMode[]> = Object.fromEntries(
  QR_CONTENT_TYPES.map((type) => [type, type === "website" ? QR_MODES : (["static"] as const)]),
) as unknown as Record<QrContentType, readonly QrMode[]>;

export const supportsMode = (type: QrContentType, mode: QrMode) => MODES_BY_TYPE[type].includes(mode);

/** The mode to use for `type`: the requested one when supported, otherwise static (every type supports it). */
export const modeFor = (type: QrContentType, mode: QrMode): QrMode => (supportsMode(type, mode) ? mode : "static");
