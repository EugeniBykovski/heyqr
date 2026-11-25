import { NextResponse } from "next/server";
import { HOSTED_LIMITS } from "@/entities/qr";
import { getSession } from "@/server/auth";
import { db } from "@/server/db";
import { newId } from "@/server/db/ids";
import { checkPdf, storePdf } from "@/server/qr/hosted-assets";
import { logoStore } from "@/server/storage/s3";

/**
 * PDF document upload (design 11.10–11.13): signed-in owners only. The server checks the bytes (a real PDF, not
 * empty, at most 25 MB and 300 pages) and stores it in the account's private storage. The answer is the file's
 * reference for the draft; nothing public changes until the owner publishes.
 */
export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const store = logoStore();
  if (!store) return NextResponse.json({ error: "storage_not_configured" }, { status: 503 });
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > HOSTED_LIMITS.pdfBytes + 64 * 1024) return NextResponse.json({ error: "tooLarge" }, { status: 413 });
  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "notPdf" }, { status: 400 });
  if (file.size > HOSTED_LIMITS.pdfBytes) return NextResponse.json({ error: "tooLarge" }, { status: 413 });
  const bytes = new Uint8Array(await file.arrayBuffer());
  const check = checkPdf(bytes);
  if (!check.ok) return NextResponse.json({ error: check.reason, pages: check.pages }, { status: 422 });
  const id = await storePdf(db, store, session.user.id, bytes, newId);
  const name = (file.name || "document.pdf").slice(0, 200);
  return NextResponse.json(
    { asset: `asset:${id}`, name, bytes: bytes.byteLength, pages: check.pages },
    { headers: { "cache-control": "no-store" } },
  );
}
