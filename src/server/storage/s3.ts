import "server-only";
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { isConfigured, storageConfig } from "@/server/config";
import type { LogoStore } from "@/server/qr/logo-assets";

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

export async function getObject(key: string): Promise<Uint8Array | null> {
  try {
    const res = await s3().send(new GetObjectCommand({ Bucket: storageConfig().S3_BUCKET, Key: key }));
    return res.Body ? await res.Body.transformToByteArray() : null;
  } catch (e) {
    if (e instanceof Error && (e.name === "NoSuchKey" || e.name === "NotFound")) return null;
    throw e;
  }
}

export async function deleteObject(key: string) {
  await s3().send(new DeleteObjectCommand({ Bucket: storageConfig().S3_BUCKET, Key: key }));
}

/**
 * HEY-83: private logo storage (the bucket is never public; files are read only through their owner's layouts). Null
 * in dev without storage credentials: uploaded logos then stay inline in the design, as before.
 */
export function logoStore(): LogoStore | null {
  if (!isConfigured("storage")) return null;
  return { put: (key, body, type) => putObject(key, Buffer.from(body), type), get: getObject, remove: deleteObject };
}
