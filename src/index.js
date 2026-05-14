#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import pLimit from 'p-limit';

import {
  loadConfig,
  writeTemplateConfig,
  getConfigPath,
  ConfigError,
} from './config.js';
import { logger } from './logger.js';
import {
  parseArgs,
  printUsage,
  printSummary,
  printFirstRunGuide,
  printInitSuccess,
} from './cli.js';
import {
  findResources,
  classifyResource,
  replaceResources,
  altMatchesUrl,
} from './markdown.js';
import { createR2Client, uploadFile } from './uploader.js';

async function fileExists(p) {
  try {
    const stat = await fs.stat(p);
    return stat.isFile();
  } catch {
    return false;
  }
}

function formatBytes(n) {
  if (n < 1024) return `${n}B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)}KB`;
  return `${(n / 1024 / 1024).toFixed(2)}MB`;
}

function loadConfigOrExit() {
  try {
    return loadConfig();
  } catch (err) {
    if (err instanceof ConfigError && err.code === 'CONFIG_MISSING') {
      printFirstRunGuide(err.configPath);
      process.exit(1);
    }
    if (err instanceof ConfigError) {
      logger.error(err.message);
      if (err.configPath) logger.info(`配置文件: ${err.configPath}`);
      process.exit(1);
    }
    throw err;
  }
}

async function runInit({ force }) {
  try {
    const filePath = writeTemplateConfig({ overwrite: force });
    printInitSuccess(filePath, { overwritten: force });
  } catch (err) {
    if (err instanceof ConfigError && err.code === 'CONFIG_EXISTS') {
      logger.warn(err.message);
      logger.info('如需覆盖，运行: md2r2 init --force');
      process.exit(1);
    }
    throw err;
  }
}

async function runUpload({ filePath, options }) {
  const startedAt = Date.now();
  const config = loadConfigOrExit();

  if (!(await fileExists(filePath))) {
    logger.error(`markdown 文件不存在: ${filePath}`);
    process.exit(1);
  }

  const baseDir = path.dirname(filePath);

  logger.step(`开始处理: ${filePath}`);
  logger.info(`配置文件: ${config.configPath}`);
  logger.info(`公开域名: ${config.publicDomain}`);
  logger.info(`目标桶 / 前缀: ${config.bucket}/${config.uploadPrefix || '(根目录)'}`);
  logger.info(`并发数: ${config.concurrency}${options.dryRun ? '  [dry-run 模式]' : ''}`);

  const markdown = await fs.readFile(filePath, 'utf8');
  const refs = findResources(markdown);
  logger.info(`匹配到 ${refs.length} 处资源引用`);

  const stats = {
    totalRefs: refs.length,
    localCandidates: 0,
    uniqueLocal: 0,
    uploaded: 0,
    skippedCdn: 0,
    skippedRemote: 0,
    skippedOther: 0,
    altPreserved: 0,
    missing: 0,
    failed: 0,
  };

  const uniqueLocal = new Map();

  for (const ref of refs) {
    const info = classifyResource(ref.raw, baseDir, config.publicDomain);
    switch (info.kind) {
      case 'cdn-skip':
        stats.skippedCdn += 1;
        logger.skip(`已在 CDN: ${ref.raw}`);
        break;
      case 'remote-skip':
        stats.skippedRemote += 1;
        logger.skip(`外链不处理: ${ref.raw}`);
        break;
      case 'inline-skip':
      case 'anchor-skip':
      case 'invalid':
        stats.skippedOther += 1;
        break;
      case 'local': {
        stats.localCandidates += 1;
        if (ref.kind === 'md-image' && !altMatchesUrl(ref.alt, ref.raw)) {
          stats.altPreserved += 1;
          logger.info(
            `保留自定义 alt（仅替换 URL）: ![${ref.alt}](${ref.raw})`
          );
        }
        if (!uniqueLocal.has(info.absolutePath)) {
          uniqueLocal.set(info.absolutePath, {
            raws: new Set(),
            occurrences: 0,
          });
        }
        const entry = uniqueLocal.get(info.absolutePath);
        entry.raws.add(ref.raw);
        entry.occurrences += 1;
        break;
      }
      default:
        stats.skippedOther += 1;
    }
  }

  stats.uniqueLocal = uniqueLocal.size;

  if (uniqueLocal.size === 0) {
    logger.info('没有需要上传的本地资源');
    printSummary(stats, startedAt);
    return;
  }

  for (const [absolutePath] of uniqueLocal) {
    if (!(await fileExists(absolutePath))) {
      stats.missing += 1;
      logger.warn(`文件不存在，跳过: ${absolutePath}`);
      uniqueLocal.delete(absolutePath);
    }
  }

  if (options.dryRun) {
    logger.step('Dry-run 待上传清单');
    for (const [absolutePath, meta] of uniqueLocal) {
      logger.info(`-> ${absolutePath}  (引用 ${meta.occurrences} 处)`);
    }
    printSummary(stats, startedAt);
    return;
  }

  const client = createR2Client(config);
  const limit = pLimit(config.concurrency);
  const rawToNewUrl = new Map();

  logger.step(`开始上传 (并发 ${config.concurrency})，共 ${uniqueLocal.size} 个文件`);

  const tasks = [...uniqueLocal.entries()].map(([absolutePath, meta], idx) =>
    limit(async () => {
      const tag = `[${idx + 1}/${uniqueLocal.size}] ${path.basename(absolutePath)}`;
      try {
        const result = await uploadFile({
          client,
          config,
          absolutePath,
          onProgress: ({ phase, key }) => {
            if (phase === 'upload') logger.info(`${tag} 上传中 → ${key}`);
          },
        });

        stats.uploaded += 1;
        logger.success(
          `${tag} 上传完成 (${formatBytes(result.size)}, ${result.contentType}) → ${result.url}`
        );

        for (const raw of meta.raws) {
          rawToNewUrl.set(raw, result.url);
        }
      } catch (err) {
        stats.failed += 1;
        logger.error(`${tag} 上传失败: ${err?.message || err}`);
      }
    })
  );

  await Promise.all(tasks);

  if (rawToNewUrl.size > 0) {
    const updated = replaceResources(markdown, rawToNewUrl);
    if (updated !== markdown) {
      if (options.write) {
        await fs.writeFile(filePath, updated, 'utf8');
        logger.success(`已写回 markdown 文件: ${filePath}`);
      } else {
        logger.info('已跳过文件写回（--no-write）');
      }
    } else {
      logger.info('markdown 内容无变更');
    }
  } else {
    logger.info('没有可写回的替换条目');
  }

  printSummary(stats, startedAt);
  if (stats.failed > 0) process.exit(2);
}

async function main() {
  let parsed;
  try {
    parsed = parseArgs(process.argv);
  } catch (err) {
    logger.error(err.message);
    printUsage();
    process.exit(1);
  }

  if (parsed.help) {
    printUsage();
    return;
  }

  switch (parsed.command) {
    case 'init':
      await runInit(parsed.options);
      return;
    case 'config-path':
      process.stdout.write(`${getConfigPath()}\n`);
      return;
    case 'upload':
      await runUpload(parsed);
      return;
    default:
      printUsage();
  }
}

main().catch((err) => {
  logger.error(err?.stack || err?.message || String(err));
  process.exit(1);
});
