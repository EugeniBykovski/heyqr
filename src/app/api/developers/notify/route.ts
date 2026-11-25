import { NextResponse } from "next/server";
import { db } from "@/server/db";
import { submitDeveloperNotify } from "@/server/qr/hosted-public";

/** /developers "Email me" (design 12.1): adds the address to the package release list. */
export async function POST(request: Request) {
  const body: unknown = await request.json().catch(() => null);
  const result = await submitDeveloperNotify(db, body);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
  return NextResponse.json({ ok: true }, { headers: { "cache-control": "no-store" } });
}
