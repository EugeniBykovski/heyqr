import "server-only";
import { PRINT_PROFILES, type PrintProfile } from "@/entities/qr";
import { env } from "@/env";
import { reportFailure } from "../monitoring";
import { getObject } from "../storage/s3";
import {
  bundledIcc,
  cmykLabel,
  createConverter,
  ICC_PROFILES,
  ProfileUnavailableError,
  rgbOfHex,
  sha256Of,
  type CmykConverter,
  type CmykProfile,
} from "./cmyk";
import type { PrintPage } from "./print";

/*
 * HEY-188: which colour profiles this deployment can produce, and their converters. Bundled profiles (FOGRA39 and
 * GRACoL 2013, licensed for redistribution) are always offered. Uncoated FOGRA29 has no profile whose licence allows
 * bundling; it is offered only when a deployment provisions one in its private bucket (docs/PRINT_CMYK.md):
 * PRINT_ICC_FOGRA29_KEY names the object and PRINT_ICC_FOGRA29_SHA256 pins its exact bytes.
 */
export const isCmyk = (p: PrintProfile): p is CmykProfile => p !== "srgb";

function provisioned(profile: CmykProfile): { key: string; sha256: string } | null {
  if (profile !== "fogra29") return null;
  const key = env.PRINT_ICC_FOGRA29_KEY;
  const sha256 = env.PRINT_ICC_FOGRA29_SHA256;
  return key && sha256 ? { key, sha256: sha256.toLowerCase() } : null;
}

/** The profiles Print Preview may offer and the print routes may produce, in the design's order. */
export function availableProfiles(): PrintProfile[] {
  return PRINT_PROFILES.filter((p) => !isCmyk(p) || ICC_PROFILES[p].bundled !== null || provisioned(p) !== null);
}

async function iccBytes(profile: CmykProfile): Promise<Buffer> {
  if (ICC_PROFILES[profile].bundled) return bundledIcc(profile);
  const source = provisioned(profile);
  if (!source) throw new ProfileUnavailableError(profile, "not provisioned");
  let bytes: Uint8Array | null;
  try {
    bytes = await getObject(source.key);
  } catch {
    throw new ProfileUnavailableError(profile, "its storage object can't be read");
  }
  if (!bytes) throw new ProfileUnavailableError(profile, "its storage object is missing");
  if (sha256Of(bytes) !== source.sha256) throw new ProfileUnavailableError(profile, "its storage object doesn't match its SHA-256");
  return Buffer.from(bytes);
}

/**
 * The converter for a print setting's profile: null for sRGB, "unavailable" when its profile can't be used right now
 * (the routes answer 503 profile_unavailable, never an sRGB file). The page's colours get their CMYK values.
 */
export async function printConverter(
  profile: PrintProfile,
  page: PrintPage,
): Promise<{ cmyk: CmykConverter | null; page: PrintPage } | "unavailable"> {
  if (!isCmyk(profile)) return { cmyk: null, page };
  let cmyk: CmykConverter;
  try {
    cmyk = await converterFor(profile);
  } catch (e) {
    reportFailure(e, { operation: "print.icc", severity: "high", tags: { profile } });
    return "unavailable";
  }
  return { cmyk, page: { ...page, colors: page.colors.map((c) => ({ ...c, cmyk: cmykLabel(cmyk.color(rgbOfHex(c.hex))) })) } };
}

const converters = new Map<CmykProfile, Promise<CmykConverter>>();

/** The converter of a CMYK profile, made once per process; a failure is not kept, so the next request tries again. */
export function converterFor(profile: CmykProfile): Promise<CmykConverter> {
  let c = converters.get(profile);
  if (!c) {
    c = iccBytes(profile).then((icc) => createConverter(profile, icc));
    c.catch(() => converters.delete(profile));
    converters.set(profile, c);
  }
  return c;
}
