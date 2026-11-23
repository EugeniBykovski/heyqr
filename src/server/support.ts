import "server-only";
import { env } from "@/env";

/** HEY-109: the confirmed support contact, the same everywhere it's shown; null until one is configured. */
export function supportEmail(): string | null {
  return env.SUPPORT_EMAIL ?? null;
}
