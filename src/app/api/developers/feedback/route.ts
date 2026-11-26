import { NextResponse } from "next/server";
import { db } from "@/server/db";
import { submitDocFeedback } from "@/server/qr/hosted-public";
import { searchablePages } from "@/widgets/developers/docs/registry";

/** Docs "Was this page helpful?" (design 12.1 / 12.14): one answer for a public docs page. 400 for anything else. */
export async function POST(request: Request) {
  const body: unknown = await request.json().catch(() => null);
  const result = await submitDocFeedback(
    db,
    body,
    searchablePages().map((p) => p.id),
  );
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
  return NextResponse.json({ ok: true }, { status: 201, headers: { "cache-control": "no-store" } });
}
