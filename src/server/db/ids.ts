import { customAlphabet, nanoid } from "nanoid";

/** Primary keys. */
export const newId = () => nanoid(21);

/** Short codes for dynamic QR links: no look-alike characters, 7 chars ≈ 1.2e12 combinations. */
export const newShortCode = customAlphabet("23456789abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ", 7);
