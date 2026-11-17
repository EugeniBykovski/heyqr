import { NextResponse } from "next/server";
import { db } from "@/server/db";
import { checkDatabase } from "@/server/db/check";
import { resolveDbTarget } from "@/server/db/target";

export const dynamic = "force-dynamic";

/**
 * Liveness + database readiness: connects, checks every schema table exists and all committed migrations are applied.
 * Returns the target label (local / test / preview / production), never connection details. 503 when not ready.
 */
export async function GET() {
  const result = await checkDatabase(db.$client);
  return NextResponse.json(
    { ok: result.ok, database: { target: resolveDbTarget(), ...result } },
    { status: result.ok ? 200 : 503, headers: { "cache-control": "no-store" } },
  );
}
