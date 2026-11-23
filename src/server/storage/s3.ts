import "server-only";
import { DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
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

/**
 * HEY-84: how long a signed download link stays valid. It's a bearer link until then, so it is issued for one object
 * at a time, only after the owner check, and never logged; asking again re-checks ownership and signs a new one.
 */
export const SIGNED_URL_TTL_SECONDS = 120;

export async function presignDownload(key: string, filename: string) {
  const command = new GetObjectCommand({
    Bucket: storageConfig().S3_BUCKET,
    Key: key,
    ResponseContentDisposition: `attachment; filename="${filename}"`,
  });
  return getSignedUrl(s3(), command, { expiresIn: SIGNED_URL_TTL_SECONDS });
}

export async function putObject(key: string, body: Buffer | string, contentType: string, contentDisposition?: string) {
  await s3().send(
    new PutObjectCommand({
      Bucket: storageConfig().S3_BUCKET,
      Key: key,
      Body: body,
      ContentType: contentType,
      ContentDisposition: contentDisposition,
    }),
  );
}

/** Whether an object exists, with the download name it was stored with (HEY-102 paid files). */
export async function headObject(key: string): Promise<{ contentDisposition: string | null } | null> {
  try {
    const res = await s3().send(new HeadObjectCommand({ Bucket: storageConfig().S3_BUCKET, Key: key }));
    return { contentDisposition: res.ContentDisposition ?? null };
  } catch (e) {
    if (e instanceof Error && (e.name === "NotFound" || e.name === "NoSuchKey" || e.name === "404")) return null;
    throw e;
  }
}

/**
 * HEY-102: a signed GET for one paid file, downloaded under its own name (the full Content-Disposition, UTF-8 names
 * included). Same TTL as every signed link; issued only after the caller's owner and entitlement checks, never logged.
 */
export async function signedFileUrl(key: string, contentDisposition: string) {
  const command = new GetObjectCommand({ Bucket: storageConfig().S3_BUCKET, Key: key, ResponseContentDisposition: contentDisposition });
  return getSignedUrl(s3(), command, { expiresIn: SIGNED_URL_TTL_SECONDS });
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
