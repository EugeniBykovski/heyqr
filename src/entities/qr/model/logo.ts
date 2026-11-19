/*
 * HEY-50: what a logo file may be. Design handoff: "Upload PNG, JPG, SVG or WebP up to 10 MB"; the same limit and types
 * as the storage upload route (server/storage/s3.ts MAX_LOGO_BYTES, LOGO_TYPES). The format is read from the file's
 * bytes, never from its name or the browser's MIME guess, so a renamed file is judged by what it is.
 */
export const LOGO_MAX_BYTES = 10 * 1024 * 1024;
export type LogoFormat = "png" | "jpeg" | "webp" | "svg";
export const LOGO_MIME: Record<LogoFormat, string> = { png: "image/png", jpeg: "image/jpeg", webp: "image/webp", svg: "image/svg+xml" };
/** The input's `accept` list (a hint for the picker; the bytes decide). */
export const LOGO_ACCEPT = ".png,.jpg,.jpeg,.svg,.webp,image/png,image/jpeg,image/svg+xml,image/webp";

const starts = (b: Uint8Array, sig: number[], at = 0) => sig.every((v, i) => b[at + i] === v);

/** The logo format a file's first bytes show, or null when it is none of PNG, JPEG, WebP or SVG. */
export function sniffLogoFormat(head: Uint8Array): LogoFormat | null {
  if (starts(head, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "png";
  if (starts(head, [0xff, 0xd8, 0xff])) return "jpeg";
  if (starts(head, [0x52, 0x49, 0x46, 0x46]) && starts(head, [0x57, 0x45, 0x42, 0x50], 8)) return "webp";
  // SVG is text: an <svg> root, optionally after a BOM, XML declaration, comments or a doctype.
  const text = new TextDecoder("utf-8", { fatal: false }).decode(head.slice(0, 1024)).replace(/^﻿/, "");
  const body = text.replace(/^\s*(<\?xml[^>]*\?>\s*)?(<!--[\s\S]*?-->\s*)*(<!DOCTYPE[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*/i, "");
  if (/^<svg[\s>]/i.test(body)) return "svg";
  return null;
}

export type LogoHrefCheck =
  { ok: true; format: LogoFormat; bytes: number } | { ok: false; reason: "notDataUrl" | "unsupported" | "tooLarge" };

/**
 * Server-side check for a logo stored in a design as a data URL: base64, a supported type whose declared MIME matches
 * its bytes, at most LOGO_MAX_BYTES decoded.
 */
export function checkLogoDataUrl(href: string): LogoHrefCheck {
  const m = /^data:(image\/(?:png|jpeg|webp|svg\+xml));base64,([A-Za-z0-9+/]+={0,2})$/.exec(href);
  if (!m) return { ok: false, reason: href.startsWith("data:") ? "unsupported" : "notDataUrl" };
  const base64 = m[2] ?? "";
  const bytes = Math.floor((base64.length * 3) / 4) - (base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0);
  if (bytes > LOGO_MAX_BYTES) return { ok: false, reason: "tooLarge" };
  const head = Uint8Array.from(atob(base64.slice(0, 1368)), (c) => c.charCodeAt(0));
  const format = sniffLogoFormat(head);
  if (!format || LOGO_MIME[format] !== m[1]) return { ok: false, reason: "unsupported" };
  return { ok: true, format, bytes };
}
