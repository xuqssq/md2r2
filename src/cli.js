import path from 'node:path';
import { logger } from './logger.js';
import {
  APP_NAME,
  CONFIG_TEMPLATE,
  getConfigPath,
} from './config.js';

const USAGE = `${APP_NAME} - 提取 Markdown 中的本地资源并上传到 Cloudflare R2

用法:
  npx ${APP_NAME} <markdown 文件路径> [选项]
  npx ${APP_NAME} init [--force]
  npx ${APP_NAME} config-path
  npx ${APP_NAME} --help

子命令:
  init             在用户目录创建配置文件模板（已存在则报错，加 --force 覆盖）
  config-path      打印当前配置文件的绝对路径

选项:
  --dry-run        只输出将要进行的操作，不上传、不修改文件
  --no-write       上传完成后，不写回 markdown 文件（仍会打印替换结果统计）
  -h, --help       显示帮助信息
`;

export function parseArgs(argv) {
  const args = argv.slice(2);

  if (args.length === 0) {
    return { help: true };
  }

  const first = args[0];

  if (first === '-h' || first === '--help') {
    return { help: true };
  }

  if (first === 'init') {
    const rest = args.slice(1);
    const force = rest.includes('--force') || rest.includes('-f');
    return { command: 'init', options: { force } };
  }

  if (first === 'config-path') {
    return { command: 'config-path' };
  }

  const options = { dryRun: false, write: true };
  const positionals = [];
  for (const arg of args) {
    switch (arg) {
      case '--dry-run':
        options.dryRun = true;
        break;
      case '--no-write':
        options.write = false;
        break;
      case '-h':
      case '--help':
        return { help: true };
      default:
        if (arg.startsWith('-')) {
          throw new Error(`未知参数: ${arg}`);
        }
        positionals.push(arg);
    }
  }

  if (positionals.length === 0) {
    throw new Error(`请传入 markdown 文件路径，运行 \`npx ${APP_NAME} --help\` 查看用法`);
  }
  if (positionals.length > 1) {
    throw new Error('当前仅支持一次传入一个 markdown 文件路径');
  }

  return {
    command: 'upload',
    options,
    filePath: path.resolve(process.cwd(), positionals[0]),
  };
}

export function printUsage() {
  process.stdout.write(USAGE);
}

export function printFirstRunGuide(configPath = getConfigPath()) {
  logger.error(`未找到配置文件：${configPath}`);
  logger.info('请先初始化配置：');
  logger.info(`  npx ${APP_NAME} init`);
  logger.info('或手动创建上面的文件，模板内容：');
  process.stdout.write(`\n${JSON.stringify(CONFIG_TEMPLATE, null, 2)}\n\n`);
  logger.info(`查看路径: npx ${APP_NAME} config-path`);
}

export function printInitSuccess(filePath, { overwritten = false } = {}) {
  logger.success(
    overwritten
      ? `已覆盖配置文件: ${filePath}`
      : `已创建配置文件: ${filePath}`
  );
  logger.info('请编辑该文件，填入你的 R2 凭证和域名后再次运行。');
  logger.info('文件字段说明：');
  process.stdout.write(`
  accountId        Cloudflare 账户 ID
  accessKeyId      R2 Access Key
  secretAccessKey  R2 Secret Key
  bucket           存储桶名称
  publicDomain     绑定到 bucket 的公开 CDN 域名（含 https://）
  uploadPrefix     bucket 内的前缀路径，可留空
  concurrency      并行上传数量，默认 5

`);
}

export function printSummary(stats, startedAt) {
  const ms = Date.now() - startedAt;
  logger.step('上传结果汇总');
  logger.info(`耗时: ${(ms / 1000).toFixed(2)}s`);
  logger.info(`总匹配资源: ${stats.totalRefs}`);
  logger.info(`本地候选: ${stats.localCandidates}（去重后 ${stats.uniqueLocal}）`);
  logger.info(`新上传:   ${stats.uploaded}`);
  logger.info(`跳过(CDN): ${stats.skippedCdn}`);
  logger.info(`跳过(外链): ${stats.skippedRemote}`);
  logger.info(`跳过(其它): ${stats.skippedOther}`);
  logger.info(`保留自定义 alt: ${stats.altPreserved}`);
  if (stats.missing > 0) logger.warn(`文件不存在被跳过: ${stats.missing}`);
  if (stats.failed > 0) logger.error(`失败: ${stats.failed}`);
}
