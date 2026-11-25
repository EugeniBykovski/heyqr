import { NextResponse } from "next/server";
import { db } from "@/server/db";
import { fileResponse } from "@/server/qr/file-response";
import { publicHostedFile } from "@/server/qr/hosted-public";
import { logoStore } from "@/server/storage/s3";

/**
 * A file of a live hosted page (photo, PDF), for anyone: only one the latest published version refers to, while the
 * short link is live. A short shared cache, so a paused page or a replaced file stops being served within a minute.
 */
export async function GET(request: Request, ctx: RouteContext<"/p/[code]/a/[assetId]">) {
  const store = logoStore();
  if (!store) return NextResponse.json({ error: "unavailable" }, { status: 503 });
  const { code, assetId } = await ctx.params;
  const file = await publicHostedFile(db, store, code, assetId);
  if (!file) return NextResponse.json({ error: "not_found" }, { status: 404, headers: { "cache-control": "no-store" } });
  const url = new URL(request.url);
  return fileResponse(file, {
    cache: "public, max-age=60",
    download: url.searchParams.get("download") === "1",
    name: url.searchParams.get("name") ?? undefined,
  });
}
