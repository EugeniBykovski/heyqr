import { NextResponse } from "next/server";
import { env } from "@/env";
import { db } from "@/server/db";
import { reporterHash, submitReport } from "@/server/qr/hosted-public";

/** "Report this page" (design 11.0): stored for review, limited per visitor. No account needed. */
export async function POST(request: Request) {
  const body: unknown = await request.json().catch(() => null);
  const address = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "unknown";
  const result = await submitReport(db, body, reporterHash(address, env.BETTER_AUTH_SECRET));
  if (result.ok) return NextResponse.json({ ok: true }, { headers: { "cache-control": "no-store" } });
  const status = result.error === "rate_limited" ? 429 : result.error === "not_found" ? 404 : 400;
  return NextResponse.json({ error: result.error }, { status, headers: { "cache-control": "no-store" } });
}
