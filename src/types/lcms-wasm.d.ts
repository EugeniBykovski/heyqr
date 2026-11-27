/** HEY-188: the part of lcms-wasm 1.0.5 (Little CMS 2 as WebAssembly, MIT) the print export uses. */
declare module "lcms-wasm" {
  export interface Lcms {
    cmsOpenProfileFromMem(data: Uint8Array, size: number): number;
    cmsCreate_sRGBProfile(): number;
    cmsCloseProfile(profile: number): void;
    cmsGetColorSpaceASCII(profile: number): string | null;
    cmsGetProfileInfoASCII(profile: number, info: number, language: string, country: string): string;
    cmsCreateTransform(input: number, inputFormat: number, output: number, outputFormat: number, intent: number, flags: number): number;
    cmsDoTransform(transform: number, input: Uint8Array, pixels: number): Uint8Array | Uint16Array;
    cmsDeleteTransform(transform: number): void;
  }
  export function instantiate(options?: { wasmBinary?: Uint8Array }): Promise<Lcms>;
  export const TYPE_RGB_8: number;
  export const TYPE_CMYK_8: number;
  export const TYPE_CMYK_16: number;
  export const INTENT_PERCEPTUAL: number;
  export const INTENT_RELATIVE_COLORIMETRIC: number;
  export const cmsFLAGS_BLACKPOINTCOMPENSATION: number;
  export const cmsInfoDescription: number;
}
