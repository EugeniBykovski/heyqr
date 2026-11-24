import { customAlphabet, nanoid } from "nanoid";

/** Primary keys. */
export const newId = () => nanoid(21);

/** Short codes for dynamic QR links: no look-alike characters, 7 chars ≈ 1.2e12 combinations. */
/** Slug characters: no 0/O, 1/l/I or i, so printed codes read unambiguously (and "preview" can never be issued). */
export const SHORT_CODE_ALPHABET = "23456789abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ";
export const newShortCode = customAlphabet(SHORT_CODE_ALPHABET, 7);
