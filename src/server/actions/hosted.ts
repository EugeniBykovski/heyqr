"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { HostedContent, HostedErrors } from "@/entities/qr";
import { requireUser } from "../auth";
import { db } from "../db";
import { newId } from "../db/ids";
import { publishHosted, saveHostedDraft } from "../qr/hosted";
import { logoStore } from "../storage/s3";
import { guard, type ActionResult } from "./result";

const idSchema = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);

const revalidate = (qrCodeId: string) => {
  revalidatePath("/[locale]/dashboard", "page");
  revalidatePath(`/[locale]/dashboard/qr/${qrCodeId}`, "page");
  revalidatePath("/[locale]/dashboard/qr/[id]", "page");
};

/** QR details → Edit page: saves the working draft of the owner's hosted code. Visitors still see the published page. */
export async function saveHostedPage(qrCodeId: string, content: unknown): Promise<ActionResult<{ content: HostedContent }>> {
  return guard(async () => {
    const user = await requireUser();
    const id = idSchema.safeParse(qrCodeId);
    if (!id.success) return { ok: false, error: "invalid" };
    const result = await saveHostedDraft(db, logoStore(), user.id, id.data, content, newId);
    if (!result.ok) return { ok: false, error: result.error === "not_found" ? "not_found" : "invalid" };
    revalidate(id.data);
    return { ok: true, data: { content: result.content } };
  });
}

export type PublishOutcome =
  ActionResult<{ version: number; publishedAt: string; unchanged: boolean }> | { ok: false; error: "rules"; errors: HostedErrors };

/**
 * Publish: the owner's current draft becomes the live page at the code's short link (same QR, same link, same scan
 * history). A draft that breaks the rules is refused with the field errors; the live page stays as it was.
 */
export async function publishHostedPage(qrCodeId: string): Promise<PublishOutcome> {
  return guard<{ version: number; publishedAt: string; unchanged: boolean }, { ok: false; error: "rules"; errors: HostedErrors }>(
    async () => {
      const user = await requireUser();
      const id = idSchema.safeParse(qrCodeId);
      if (!id.success) return { ok: false, error: "invalid" };
      const result = await publishHosted(db, user.id, id.data);
      if (!result.ok) {
        if (result.error === "invalid") return { ok: false, error: "rules", errors: result.errors };
        return { ok: false, error: result.error === "not_found" ? "not_found" : "invalid" };
      }
      revalidate(id.data);
      return { ok: true, data: { version: result.version, publishedAt: result.publishedAt.toISOString(), unchanged: result.unchanged } };
    },
  );
}
