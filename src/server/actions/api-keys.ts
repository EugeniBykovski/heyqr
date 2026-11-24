"use server";
import { revalidatePath } from "next/cache";
import { createApiKey, revokeApiKey } from "../api-keys/keys";
import { requireUser } from "../auth";
import { db } from "../db";
import { guard, type ActionResult } from "./result";

/**
 * HEY-153: issues an API key for the signed-in account (the owner comes from the session, never from the request).
 * The full key is in this response only: a POST answer, never cached, logged or stored.
 */
export async function issueApiKey(): Promise<ActionResult<{ key: string; prefix: string; createdAt: string }>> {
  return guard(async () => {
    const user = await requireUser();
    const issued = await createApiKey(db, user.id);
    revalidatePath("/[locale]/dashboard/api-keys", "page");
    return { ok: true, data: { key: issued.key, prefix: issued.prefix, createdAt: issued.createdAt } };
  });
}

/**
 * HEY-154: revokes one of the signed-in account's keys (the owner comes from the session; another account's key id
 * reads as not found). Repeating it is harmless and keeps the original time.
 */
export async function revokeApiKeyAction(keyId: unknown): Promise<ActionResult<{ revokedAt: string }>> {
  return guard(async () => {
    const user = await requireUser();
    if (typeof keyId !== "string" || keyId.length === 0 || keyId.length > 64) return { ok: false, error: "invalid" };
    const revoked = await revokeApiKey(db, user.id, keyId);
    if (!revoked) return { ok: false, error: "not_found" };
    revalidatePath("/[locale]/dashboard/api-keys", "page");
    return { ok: true, data: revoked };
  });
}
