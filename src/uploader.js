import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import mime from 'mime-types';

export function createR2Client(config) {
  return new S3Client({
    region: 'auto',
    endpoint: config.endpoint,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
  });
}

export function buildObjectKey({ prefix, fileName }) {
  const ext = path.extname(fileName).toLowerCase();
  const id = crypto.randomUUID();
  const segments = [];
  if (prefix) segments.push(prefix);
  segments.push(`${id}${ext}`);
  return segments.join('/');
}

export function publicUrlFor(domain, key) {
  return `${domain.replace(/\/+$/, '')}/${key.replace(/^\/+/, '')}`;
}

export async function uploadFile({ client, config, absolutePath, onProgress }) {
  const buffer = await fs.readFile(absolutePath);
  const fileName = path.basename(absolutePath);
  const key = buildObjectKey({
    prefix: config.uploadPrefix,
    fileName,
  });

  const contentType = mime.lookup(absolutePath) || 'application/octet-stream';

  onProgress?.({ phase: 'upload', key });
  await client.send(
    new PutObjectCommand({
      Bucket: config.bucket,
      Key: key,
      Body: buffer,
      ContentType: contentType,
      CacheControl: 'public, max-age=31536000, immutable',
    })
  );

  return {
    key,
    url: publicUrlFor(config.publicDomain, key),
    reused: false,
    size: buffer.byteLength,
    contentType,
  };
}
