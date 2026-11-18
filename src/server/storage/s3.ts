import "server-only";
import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { storageConfig } from "@/server/config";

let client: S3Client | null = null;

/** Works with AWS S3, Cloudflare R2 and local MinIO (S3_ENDPOINT). */
export function s3(): S3Client {
  const c = storageConfig();
  client ??= new S3Client({
    region: c.S3_REGION,
    endpoint: c.S3_ENDPOINT,
    forcePathStyle: Boolean(c.S3_ENDPOINT),
    credentials: { accessKeyId: c.S3_ACCESS_KEY_ID, secretAccessKey: c.S3_SECRET_ACCESS_KEY },
  });
  return client;
}

export const LOGO_TYPES = ["image/png", "image/jpeg", "image/svg+xml", "image/webp"] as const;
export const MAX_LOGO_BYTES = 10 * 1024 * 1024;

/** Short-lived URL the browser uploads a logo to directly. */
export async function presignUpload(key: string, contentType: string, byteSize: number) {
  const command = new PutObjectCommand({ Bucket: storageConfig().S3_BUCKET, Key: key, ContentType: contentType, ContentLength: byteSize });
  return getSignedUrl(s3(), command, { expiresIn: 300 });
}

export async function presignDownload(key: string, filename: string) {
  const command = new GetObjectCommand({
    Bucket: storageConfig().S3_BUCKET,
    Key: key,
    ResponseContentDisposition: `attachment; filename="${filename}"`,
  });
  return getSignedUrl(s3(), command, { expiresIn: 120 });
}

export async function putObject(key: string, body: Buffer | string, contentType: string) {
  await s3().send(new PutObjectCommand({ Bucket: storageConfig().S3_BUCKET, Key: key, Body: body, ContentType: contentType }));
}

export const publicUrl = (key: string) => `${storageConfig().S3_PUBLIC_URL.replace(/\/$/, "")}/${key}`;
