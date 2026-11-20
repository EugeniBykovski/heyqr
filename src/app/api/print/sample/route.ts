import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { env } from "@/env";
import { getSession } from "@/server/auth";
import { userTrial } from "@/server/billing/entitlements";
import { printFileResponse } from "@/server/print/files";
import { samplePrint } from "@/server/print/sample";

const query = z.object({ file: z.enum(["pdf", "svg", "spec"]), locale: z.string().optional() });

/**
 * Design 9.1: the Print Pack sample files during the Starter trial (active or ending), made by the same code as a
 * bought Print Pack but for a fixed demo QR. Signed out: 401; no running trial: 403.
 */
export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const q = query.safeParse(Object.fromEntries(request.nextUrl.searchParams));
  if (!q.success) return NextResponse.json({ error: "invalid_query" }, { status: 400 });
  const phase = await userTrial(session.user.id);
  if (phase.state !== "active" && phase.state !== "ending") return NextResponse.json({ error: "trial_only" }, { status: 403 });
  const sample = samplePrint(env.NEXT_PUBLIC_APP_URL);
  return printFileResponse(q.data.file, { ...sample, name: "Hey QR sample", layoutName: "Little Fern Coffee", locale: q.data.locale });
}
