/**
 * HEY-83 `pnpm assets:cleanup`: removes uploaded logo files that no saved layout refers to (soft-deleted codes count,
 * they can be restored) and that haven't been used for 24 hours: uploads of saves that were refused, and files whose
 * last layout was edited or deleted. Rows are removed first under row locks (a save in flight keeps its file), then the
 * objects. Production needs CONFIRM_PRODUCTION_CLEANUP=1. Plain module: builds its own client from the environment.
 */
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { cleanupLogos, type LogoStore } from "../qr/logo-assets";
import * as schema from "./schema";
import { assertAllowed, describeDatabaseUrl, resolveDbTarget, runtimeUrl } from "./target";
import { EnvConfigError } from "../../shared/config/app-env";

function store(): LogoStore {
  const { S3_REGION, S3_BUCKET, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY, S3_ENDPOINT } = process.env;
  if (!S3_REGION || !S3_BUCKET || !S3_ACCESS_KEY_ID || !S3_SECRET_ACCESS_KEY)
    throw new EnvConfigError("Storage is not configured: set S3_REGION, S3_BUCKET, S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY.");
  const s3 = new S3Client({
    region: S3_REGION,
    endpoint: S3_ENDPOINT || undefined,
    forcePathStyle: Boolean(S3_ENDPOINT),
    credentials: { accessKeyId: S3_ACCESS_KEY_ID, secretAccessKey: S3_SECRET_ACCESS_KEY },
  });
  return {
    put: async (Key, Body, ContentType) => void (await s3.send(new PutObjectCommand({ Bucket: S3_BUCKET, Key, Body, ContentType }))),
    get: async (Key) => (await (await s3.send(new GetObjectCommand({ Bucket: S3_BUCKET, Key }))).Body?.transformToByteArray()) ?? null,
    remove: async (Key) => void (await s3.send(new DeleteObjectCommand({ Bucket: S3_BUCKET, Key }))),
  };
}

async function main() {
  const target = resolveDbTarget();
  const url = runtimeUrl();
  assertAllowed("cleanup", target, url);
  const pool = new Pool({ connectionString: url, max: 2, connectionTimeoutMillis: 10_000 });
  try {
    const removed = await cleanupLogos(drizzle(pool, { schema, casing: "snake_case" }), store());
    console.log(`Removed ${removed.length} unused logo file(s) from the ${target} database ${describeDatabaseUrl(url)} and its bucket.`);
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof EnvConfigError ? error.message : error);
  process.exitCode = 1;
});
