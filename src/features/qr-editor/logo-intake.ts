import { LOGO_MAX_BYTES, LOGO_MIME, sniffLogoFormat, type LogoFormat } from "@/entities/qr";

/*
 * HEY-50: the one path every uploaded logo takes (file picker, drag and drop, replacing a logo), in this order:
 * 1. size, before anything is read: empty or over LOGO_MAX_BYTES (10 MB) is refused;
 * 2. format, from the file's own bytes: PNG, JPEG, WebP or SVG, whatever the name or MIME type says;
 * 3. decoding: the image must actually open (a damaged or truncated file is refused);
 * 4. storage: raster images larger than STORED_MAX_SIDE, or heavier than STORED_MAX_BYTES (a 10 MB file can be a tiny
 *    image with a lot of padding or metadata), are re-encoded at most STORED_MAX_SIDE wide, so drafts and saved designs
 *    stay small; SVG stays vector, as the handoff asks.
 * SVG is only ever used as an image (in the QR's <image>), where browsers don't run scripts or load external resources.
 */
export const STORED_MAX_SIDE = 1024;
export const STORED_MAX_BYTES = 1024 * 1024;

export type LogoIntake =
  | { ok: true; href: string; format: LogoFormat; width: number; height: number }
  | { ok: false; reason: "empty" | "tooLarge" | "unsupported" | "unreadable"; bytes: number };

/** Decoding and re-encoding, injected so tests can run without a browser's image stack. */
export interface LogoDecoder {
  /** Decodes a raster image; rejects when it can't be decoded. */
  raster(file: Blob): Promise<{ width: number; height: number; encode(width: number, height: number, mime: string): Promise<string> }>;
  /** Loads an SVG document as an image; rejects when it isn't a renderable SVG. */
  svg(dataUrl: string, source: string): Promise<{ width: number; height: number }>;
}

const toBase64 = (bytes: Uint8Array) => {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
};

export async function intakeLogo(file: Blob, decoder: LogoDecoder = browserLogoDecoder): Promise<LogoIntake> {
  const bytes = file.size;
  if (bytes === 0) return { ok: false, reason: "empty", bytes };
  if (bytes > LOGO_MAX_BYTES) return { ok: false, reason: "tooLarge", bytes };
  const format = sniffLogoFormat(new Uint8Array(await file.slice(0, 1024).arrayBuffer()));
  if (!format) return { ok: false, reason: "unsupported", bytes };
  try {
    if (format === "svg") {
      const data = new Uint8Array(await file.arrayBuffer());
      const href = `data:${LOGO_MIME.svg};base64,${toBase64(data)}`;
      const { width, height } = await decoder.svg(href, new TextDecoder().decode(data));
      return { ok: true, href, format, width, height };
    }
    const image = await decoder.raster(file);
    if (!image.width || !image.height) return { ok: false, reason: "unreadable", bytes };
    const scale = Math.min(1, STORED_MAX_SIDE / Math.max(image.width, image.height));
    if (scale < 1 || bytes > STORED_MAX_BYTES) {
      // JPEG stays JPEG (no transparency to keep); PNG and WebP become PNG, which every renderer reads.
      const mime = format === "jpeg" ? LOGO_MIME.jpeg : LOGO_MIME.png;
      const [w, h] = [Math.max(1, Math.round(image.width * scale)), Math.max(1, Math.round(image.height * scale))];
      return { ok: true, href: await image.encode(w, h, mime), format, width: w, height: h };
    }
    const href = `data:${LOGO_MIME[format]};base64,${toBase64(new Uint8Array(await file.arrayBuffer()))}`;
    return { ok: true, href, format, width: image.width, height: image.height };
  } catch {
    return { ok: false, reason: "unreadable", bytes };
  }
}

export const browserLogoDecoder: LogoDecoder = {
  async raster(file) {
    const bitmap = await createImageBitmap(file);
    return {
      width: bitmap.width,
      height: bitmap.height,
      async encode(width, height, mime) {
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        if (!ctx) throw new Error("no canvas");
        ctx.imageSmoothingQuality = "high";
        ctx.drawImage(bitmap, 0, 0, width, height);
        bitmap.close();
        return canvas.toDataURL(mime, 0.92);
      },
    };
  },
  async svg(dataUrl, source) {
    const doc = new DOMParser().parseFromString(source, "image/svg+xml");
    if (doc.querySelector("parsererror") || doc.documentElement.localName !== "svg") throw new Error("not an svg document");
    const img = new Image();
    img.src = dataUrl;
    await img.decode();
    return { width: img.naturalWidth || 300, height: img.naturalHeight || 150 };
  },
};
