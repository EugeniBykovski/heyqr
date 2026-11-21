import { CENTER_LOGO_SIZE, composeLayout, contrastRatio, luminance, type ScanIssueCode } from "@heyqr/qr-core";
import { designToLayout, type EditorDesign } from "@/entities/qr";
import type { Decoder } from "./use-scan-check";

/*
 * HEY-68: why a scan check failed, confirmed by the decoder. Each suspected cause is tested by rendering the current
 * design with only that one setting changed and decoding it: a cause is confirmed when that candidate reads back the
 * expected payload. Causes and copy follow the design's scan check (1.9): invert, contrast, eyes, text, logo.
 */
export type ScanCause = ScanIssueCode;

/** The code colour the design suggests for "Increase contrast" on a light background. */
export const INK = "#0D0D12";

/** The single-setting change that would remove a cause, or null when it doesn't apply to this design. */
export function causePatch(cause: ScanCause, d: EditorDesign): Partial<EditorDesign> | null {
  switch (cause) {
    case "logo":
      return d.logo.kind === "none" ? null : { logo: { kind: "none" } };
    case "text":
      return d.captionPosition === "inside" && d.caption.trim() && d.preset !== "qr" && d.preset !== "frame"
        ? { captionPosition: "below" }
        : null;
    case "eyes":
      return (d.eye !== undefined && d.eye.toUpperCase() !== d.fg.toUpperCase()) ||
        (d.eyeIn !== undefined && d.eyeIn.toUpperCase() !== d.fg.toUpperCase())
        ? { eye: d.fg, eyeIn: d.fg }
        : null;
    case "contrast":
      // Only when the code colour is itself weak (under the design's 4:1 aim).
      return luminance(d.bg) > 0.4 && contrastRatio(d.fg, d.bg) < 4 ? { fg: INK } : null;
    case "invert":
      return luminance(d.fg) > luminance(d.bg) ? { fg: d.bg, bg: d.fg } : null;
  }
}

const CAUSES: readonly ScanCause[] = ["invert", "contrast", "eyes", "text", "logo"];
const render = (d: EditorDesign, value: string) => composeLayout(designToLayout(d), value).svg;

/** The causes a test render confirms (in the design's order); empty when none does (then: general guidance). */
export async function confirmCauses(d: EditorDesign, value: string, decode: Decoder): Promise<ScanCause[]> {
  const confirmed: ScanCause[] = [];
  for (const cause of CAUSES) {
    const patch = causePatch(cause, d);
    if (!patch) continue;
    if ((await decode(render({ ...d, ...patch }, value))) === value) confirmed.push(cause);
  }
  return confirmed;
}

/** Supported logo sizes below the current one, largest first, in the slider's 1 % steps. */
export function smallerLogoSizes(current: number): number[] {
  const out: number[] = [];
  for (let s = Math.round(current * 100) - 1; s >= Math.round(CENTER_LOGO_SIZE.min * 100); s--) out.push(s / 100);
  return out;
}

/**
 * "Reduce logo size": the largest smaller supported size whose render decodes to the expected payload. `stillCurrent`
 * is asked before every decode: when the design changed meanwhile the search stops ("stale") and nothing is applied.
 */
export async function findScanningLogoSize(
  d: EditorDesign,
  value: string,
  decode: Decoder,
  stillCurrent: () => boolean,
): Promise<{ kind: "found"; size: number; tried: number } | { kind: "none"; tried: number } | { kind: "stale" }> {
  let tried = 0;
  for (const size of smallerLogoSizes(d.logoSize)) {
    if (!stillCurrent()) return { kind: "stale" };
    tried++;
    if ((await decode(render({ ...d, logoSize: size }, value))) === value)
      return stillCurrent() ? { kind: "found", size, tried } : { kind: "stale" };
  }
  return stillCurrent() ? { kind: "none", tried } : { kind: "stale" };
}
