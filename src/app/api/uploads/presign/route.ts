import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/server/auth";
import { db, schema } from "@/server/db";
import { newId } from "@/server/db/ids";
import { LOGO_TYPES, MAX_LOGO_BYTES, presignUpload, publicUrl } from "@/server/storage/s3";

const body = z.object({ contentType: z.enum(LOGO_TYPES), byteSize: z.number().int().positive().max(MAX_LOGO_BYTES) });
const EXT: Record<(typeof LOGO_TYPES)[number], string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/svg+xml": "svg",
  "image/webp": "webp",
};

/** Returns a 5-minute URL the browser PUTs the logo to, plus its future public URL. */
export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid_file" }, { status: 400 });

  const id = newId();
  const key = `logos/${session.user.id}/${id}.${EXT[parsed.data.contentType]}`;
  const uploadUrl = await presignUpload(key, parsed.data.contentType, parsed.data.byteSize);
  await db
    .insert(schema.asset)
    .values({ id, userId: session.user.id, storageKey: key, contentType: parsed.data.contentType, byteSize: parsed.data.byteSize });
  return NextResponse.json({ assetId: id, uploadUrl, url: publicUrl(key) });
}
