import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { PrintProfile } from "../../entities/qr/model/print";

/*
 * HEY-188: CMYK print files. Colours are converted from sRGB with Little CMS 2 (lcms-wasm 1.0.5, WebAssembly, so it runs
 * in the same Node functions as the rest of the export) to the selected ICC output profile, and that profile is embedded
 * as the PDF's output intent. Vector colours use relative colorimetric with black point compensation (a colour inside
 * the press gamut prints as itself; the darkest sRGB colour maps to the press's darkest); images use perceptual, the
 * profile's own gamut mapping for photographic content. Plain module (no "server-only") so tests convert the same way.
 */
export type CmykProfile = Exclude<PrintProfile, "srgb">;

export interface IccDefinition {
  /** The file in assets/icc, or null when the profile is provisioned at deployment (docs/PRINT_CMYK.md). */
  bundled: string | null;
  /** SHA-256 of the bundled file: anything else (a changed or damaged file) is refused. */
  sha256: string | null;
  /** The PDF output intent: the registered characterization and a human-readable description. */
  outputIntent: { identifier: string; condition: string; info: string };
}

export const ICC_PROFILES: Record<CmykProfile, IccDefinition> = {
  fogra39: {
    bundled: "Coated_Fogra39L_VIGC_300.icc",
    sha256: "6df43849a84d2632e7900a125f657bd09364ed56775bc4740c1e39a5492d47e3",
    outputIntent: {
      identifier: "FOGRA39",
      condition: "Offset printing, ISO 12647-2:2004/Amd 1, paper types 1 and 2 (gloss or matt coated), FOGRA39L",
      info: "Coated FOGRA39 (Coated_Fogra39L_VIGC_300.icc)",
    },
  },
  gracol: {
    bundled: "GRACoL2013_CRPC6.icc",
    sha256: "4ebbfad6bc9cfc033fdafdd8ac5df8159208932cb16d9a6596d349ae7ab50443",
    outputIntent: {
      identifier: "CGATS21-2-CRPC6",
      condition: "GRACoL 2013, CGATS.21-2 CRPC6 (premium coated, ISO 15339)",
      info: "GRACoL 2013 (GRACoL2013_CRPC6.icc)",
    },
  },
  fogra29: {
    bundled: null,
    sha256: null,
    outputIntent: {
      identifier: "FOGRA29",
      condition: "Offset printing, ISO 12647-2:2004, paper type 4 (uncoated white), FOGRA29L",
      info: "Uncoated FOGRA29",
    },
  },
};

export const ICC_DIR = path.join(process.cwd(), "assets/icc");

/** The profile can't be used: not provisioned, a different file, or the engine failed. Never answered with sRGB. */
export class ProfileUnavailableError extends Error {
  constructor(
    public readonly profile: CmykProfile,
    reason: string,
  ) {
    super(`ICC profile ${profile} is unavailable: ${reason}`);
    this.name = "ProfileUnavailableError";
  }
}

export const sha256Of = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");

/** A bundled profile's bytes, checked against their recorded hash. */
export function bundledIcc(profile: CmykProfile): Buffer {
  const def = ICC_PROFILES[profile];
  if (!def.bundled || !def.sha256) throw new ProfileUnavailableError(profile, "not bundled");
  let bytes: Buffer;
  try {
    bytes = readFileSync(path.join(ICC_DIR, def.bundled));
  } catch {
    throw new ProfileUnavailableError(profile, `${def.bundled} is missing`);
  }
  if (sha256Of(bytes) !== def.sha256) throw new ProfileUnavailableError(profile, `${def.bundled} doesn't match its SHA-256`);
  return bytes;
}

/** The ICC header facts the output intent depends on: an output (printer) profile from CMYK to a PCS. */
export function iccHeader(bytes: Uint8Array): { version: string; deviceClass: string; colorSpace: string; size: number } {
  const ascii = (o: number) => String.fromCharCode(...bytes.subarray(o, o + 4));
  const size = bytes.length >= 4 ? new DataView(bytes.buffer, bytes.byteOffset, 4).getUint32(0) : 0;
  return { version: `${bytes[8] ?? 0}.${(bytes[9] ?? 0) >> 4}`, deviceClass: ascii(12), colorSpace: ascii(16), size };
}

export interface CmykConverter {
  profile: CmykProfile;
  /** The profile's description tag. */
  description: string;
  icc: Buffer;
  sha256: string;
  outputIntent: IccDefinition["outputIntent"];
  /** One colour, CMYK percentages 0–100 to two decimals (relative colorimetric, black point compensation). */
  color(rgb: readonly number[]): [number, number, number, number];
  /** RGB bytes (3 a pixel) to CMYK bytes (4 a pixel, 0 = no ink), perceptual. */
  pixels(rgb: Uint8Array, count: number): Uint8Array;
}

type Lcms = import("lcms-wasm").Lcms;
let engine: Promise<{ lcms: Lcms; L: typeof import("lcms-wasm") }> | null = null;

/** Little CMS, loaded once per process. A failed load is retried by the next request. */
function lcmsEngine() {
  engine ??= (async () => {
    const L = await import("lcms-wasm");
    return { lcms: await L.instantiate(), L };
  })().catch((e: unknown) => {
    engine = null;
    throw e;
  });
  return engine;
}

/** A converter from sRGB to this ICC output profile. Throws ProfileUnavailableError for anything but a CMYK printer profile. */
export async function createConverter(profile: CmykProfile, icc: Buffer): Promise<CmykConverter> {
  const header = iccHeader(icc);
  if (header.deviceClass !== "prtr" || header.colorSpace !== "CMYK" || header.size !== icc.length)
    throw new ProfileUnavailableError(profile, `not a CMYK output profile (${header.deviceClass}/${header.colorSpace})`);
  let lcms: Lcms;
  let L: typeof import("lcms-wasm");
  try {
    ({ lcms, L } = await lcmsEngine());
  } catch (e) {
    throw new ProfileUnavailableError(profile, `the colour engine didn't load (${e instanceof Error ? e.message : String(e)})`);
  }
  const out = lcms.cmsOpenProfileFromMem(new Uint8Array(icc), icc.length);
  if (!out || lcms.cmsGetColorSpaceASCII(out) !== "CMYK") throw new ProfileUnavailableError(profile, "Little CMS can't open it");
  const srgb = lcms.cmsCreate_sRGBProfile();
  const vector = lcms.cmsCreateTransform(
    srgb,
    L.TYPE_RGB_8,
    out,
    L.TYPE_CMYK_16,
    L.INTENT_RELATIVE_COLORIMETRIC,
    L.cmsFLAGS_BLACKPOINTCOMPENSATION,
  );
  const image = lcms.cmsCreateTransform(srgb, L.TYPE_RGB_8, out, L.TYPE_CMYK_8, L.INTENT_PERCEPTUAL, 0);
  if (!vector || !image) throw new ProfileUnavailableError(profile, "Little CMS can't build its transforms");
  const description = lcms.cmsGetProfileInfoASCII(out, L.cmsInfoDescription, "en", "US");
  const cache = new Map<string, [number, number, number, number]>();
  return {
    profile,
    description,
    icc,
    sha256: sha256Of(icc),
    outputIntent: ICC_PROFILES[profile].outputIntent,
    color(rgb) {
      const key = rgb.join(",");
      const hit = cache.get(key);
      if (hit) return hit;
      const v = lcms.cmsDoTransform(vector, new Uint8Array(rgb.slice(0, 3)), 1);
      const pct = (i: number) => Math.round(((v[i] ?? 0) / 65535) * 10000) / 100;
      const cmyk: [number, number, number, number] = [pct(0), pct(1), pct(2), pct(3)];
      cache.set(key, cmyk);
      return cmyk;
    },
    pixels(rgb, count) {
      return Uint8Array.from(lcms.cmsDoTransform(image, rgb, count));
    },
  };
}

/** sRGB channels of a #RRGGBB colour. */
export const rgbOfHex = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));

/** CMYK percentages rounded for display and the specifications sheet, as "C M Y K". */
export const cmykLabel = (cmyk: readonly number[]) => cmyk.map((v) => Math.round(v)).join(" ");
