import { randomUUID } from "node:crypto";
import { S3Client, PutObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import type { ServerEnv } from "@stinventory/env";
import { createLogger } from "@stinventory/logger";

const log = createLogger("storage");

/*
  Tool photos, over the S3 API.

  Written against the protocol rather than a product, because the thing behind
  it is going to change. It is a MinIO container on the droplet today, chosen so
  a foreman can photograph a tool without anybody paying for a bucket first;
  it will be Spaces or R2 the moment the droplet's disk becomes the wrong place
  for binary data. That move is four environment variables.

  The database stores the object key, never a URL. A URL bakes today's host into
  every row, so switching storage would mean rewriting the register. A key is
  the same string wherever the bytes live.
*/

export type Storage = {
  put(input: { body: Buffer; contentType: string; keyPrefix: string }): Promise<string>;
  remove(key: string): Promise<void>;
  urlFor(key: string | null | undefined): string | null;
};

/* Only what a browser can display, and what we are prepared to serve back.
   An upload endpoint that accepts anything is a file-hosting service with extra
   steps. */
const ALLOWED = new Map<string, string>([
  ["image/jpeg", "jpg"],
  ["image/png", "png"],
  ["image/webp", "webp"],
]);

export const MAX_PHOTO_BYTES = 8 * 1024 * 1024;

export function isAllowedImage(contentType: string): boolean {
  return ALLOWED.has(contentType);
}

export function storageFor(env: ServerEnv): Storage | null {
  /* No credentials means photos are off, not broken. The routes check for null
     and say so; the register falls back to placeholders. */
  if (!env.S3_ENDPOINT || !env.S3_ACCESS_KEY || !env.S3_SECRET_KEY) return null;

  const client = new S3Client({
    endpoint: env.S3_ENDPOINT,
    region: env.S3_REGION,
    credentials: { accessKeyId: env.S3_ACCESS_KEY, secretAccessKey: env.S3_SECRET_KEY },
    /* MinIO serves buckets as a path, not a subdomain. Virtual-host style would
       need wildcard DNS for a container that only answers on one name. */
    forcePathStyle: true,
  });

  const bucket = env.S3_BUCKET;
  const publicBase = (env.S3_PUBLIC_URL ?? env.S3_ENDPOINT).replace(/\/+$/, "");

  return {
    async put({ body, contentType, keyPrefix }) {
      const ext = ALLOWED.get(contentType);
      if (!ext) throw new Error(`Unsupported image type: ${contentType}`);
      /* Random name, original discarded. An uploaded filename is attacker-chosen
         text that would otherwise end up in a URL path. */
      const key = `${keyPrefix}/${randomUUID()}.${ext}`;
      await client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: key,
          Body: body,
          ContentType: contentType,
          CacheControl: "public, max-age=31536000, immutable",
        }),
      );
      return key;
    },

    async remove(key) {
      try {
        await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
      } catch (err) {
        /* A photo that outlives its tool is litter, not a failure. Replacing a
           picture must not fail because the old one had already gone. */
        log.warn("[storage] could not remove object", { key, err: String(err) });
      }
    },

    /*
      S3_PUBLIC_URL is the base under which object keys are directly
      addressable — the bucket is already accounted for in it, so this must not
      add it again.

      That holds for both deployments this is meant to serve. Caddy's /media
      handler rewrites the bucket in on the way to MinIO, and a Spaces or R2
      URL carries the bucket in the hostname. Prepending it here produced
      /media/stinventory/stinventory/... and a 404 on every photo the API
      reported the URL of.
    */
    urlFor(key) {
      return key ? `${publicBase}/${key}` : null;
    },
  };
}
