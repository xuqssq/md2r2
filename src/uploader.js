import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import https from 'node:https';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { NodeHttpHandler } from '@smithy/node-http-handler';
import mime from 'mime-types';

// 关闭 keep-alive 可以彻底避免长连接被 Cloudflare R2 边缘节点中途重置
// 导致的 `bad record mac` (SSL alert 20)；单次跑几十个文件几乎无感。
function buildRequestHandler(concurrency) {
  const agent = new https.Agent({
    keepAlive: false,
    maxSockets: Math.max(concurrency || 5, 5),
  });
  return new NodeHttpHandler({
    httpsAgent: agent,
    connectionTimeout: 5_000,
    requestTimeout: 60_000,
  });
}

export function createR2Client(config) {
  return new S3Client({
    region: 'auto',
    endpoint: config.endpoint,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
    maxAttempts: 4,
    requestHandler: buildRequestHandler(config.concurrency),
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

// 这些都是「重试一次大概率就过」的瞬时错误，主要来自 TLS / TCP 抖动
// 以及 SDK 偶发的 socket 复用问题。
const TRANSIENT_PATTERNS = [
  /bad record mac/i,
  /ERR_SSL_/i,
  /ECONNRESET/i,
  /ETIMEDOUT/i,
  /EPIPE/i,
  /EAI_AGAIN/i,
  /socket hang up/i,
  /network socket disconnected/i,
  /TimeoutError/i,
];

function isTransient(err) {
  if (!err) return false;
  const code = err.code || err.name || '';
  const msg = err.message || String(err);
  return TRANSIENT_PATTERNS.some((re) => re.test(code) || re.test(msg));
}

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withRetry(fn, { retries, baseDelay, onRetry }) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await fn();
    } catch (err) {
      if (attempt >= retries || !isTransient(err)) throw err;
      const delay = baseDelay * 2 ** attempt + Math.floor(Math.random() * 150);
      onRetry?.({ attempt: attempt + 1, retries, err, delayMs: delay });
      await sleep(delay);
    }
  }
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
  await withRetry(
    () =>
      client.send(
        new PutObjectCommand({
          Bucket: config.bucket,
          Key: key,
          Body: buffer,
          ContentType: contentType,
          CacheControl: 'public, max-age=31536000, immutable',
        })
      ),
    {
      retries: 3,
      baseDelay: 400,
      onRetry: ({ attempt, retries, err, delayMs }) => {
        onProgress?.({
          phase: 'retry',
          key,
          attempt,
          retries,
          delayMs,
          error: err,
        });
      },
    }
  );

  return {
    key,
    url: publicUrlFor(config.publicDomain, key),
    reused: false,
    size: buffer.byteLength,
    contentType,
  };
}
