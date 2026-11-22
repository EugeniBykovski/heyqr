import { NextResponse } from "next/server";
import { getSession } from "@/server/auth";
import { isConfigured } from "@/server/config";
import { db } from "@/server/db";
import { authorizedLogo } from "@/server/qr/file-access";
import { presignDownload, SIGNED_URL_TTL_SECONDS } from "@/server/storage/s3";

const EXT: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/svg+xml": "svg" };
const safe = (s: string) =>
  s
    .replace(/[^\w.-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "logo";

/**
 * HEY-84: a short-lived signed link to one stored logo file of the user's own layout. The user comes from the session;
 * the code, the layout of that code, the layout's reference to the file and the file's owner are all checked before
 * anything is signed (otherwise 404, no link). The link is a bearer link for SIGNED_URL_TTL_SECONDS; every request
 * re-checks ownership and signs a fresh one. The response isn't cached and the link is never logged.
 */
export async function GET(_request: Request, ctx: RouteContext<"/api/qr/[qrId]/layouts/[layoutId]/logo/[assetId]">) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { qrId, layoutId, assetId } = await ctx.params;
  const file = await authorizedLogo(db, session.user.id, { qrCodeId: qrId, layoutId, assetId });
  if (!file) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (!isConfigured("storage")) return NextResponse.json({ error: "storage_not_configured" }, { status: 503 });
  const url = await presignDownload(file.key, `${safe(file.layoutName)}-logo.${EXT[file.contentType] ?? "bin"}`);
  return new NextResponse(null, {
    status: 302,
    headers: {
      location: url,
      "cache-control": "private, no-store",
      "referrer-policy": "no-referrer",
      "x-link-expires-in": String(SIGNED_URL_TTL_SECONDS),
    },
  });
}
