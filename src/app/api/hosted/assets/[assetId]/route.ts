import { NextResponse } from "next/server";
import { getSession } from "@/server/auth";
import { db } from "@/server/db";
import { fileResponse } from "@/server/qr/file-response";
import { ownerHostedFile } from "@/server/qr/hosted-public";
import { logoStore } from "@/server/storage/s3";

/** A hosted page's draft file (photo or PDF) for its owner only: the editor preview before publishing. */
export async function GET(request: Request, ctx: RouteContext<"/api/hosted/assets/[assetId]">) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const store = logoStore();
  if (!store) return NextResponse.json({ error: "storage_not_configured" }, { status: 503 });
  const { assetId } = await ctx.params;
  const file = await ownerHostedFile(db, store, session.user.id, assetId);
  if (!file) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const url = new URL(request.url);
  return fileResponse(file, {
    cache: "private, no-store",
    download: url.searchParams.get("download") === "1",
    name: url.searchParams.get("name") ?? undefined,
  });
}
