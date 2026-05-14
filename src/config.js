import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const APP_NAME = 'md2r2';
export const CONFIG_FILE_NAME = 'config.json';

export class ConfigError extends Error {
  constructor(message, { code = 'CONFIG_INVALID', configPath } = {}) {
    super(message);
    this.name = 'ConfigError';
    this.code = code;
    this.configPath = configPath;
  }
}

export function getConfigDir() {
  if (process.env.MD2R2_CONFIG_DIR) {
    return path.resolve(process.env.MD2R2_CONFIG_DIR);
  }
  const base =
    process.env.XDG_CONFIG_HOME ||
    (process.platform === 'win32'
      ? process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming')
      : path.join(os.homedir(), '.config'));
  return path.join(base, APP_NAME);
}

export function getConfigPath() {
  return path.join(getConfigDir(), CONFIG_FILE_NAME);
}

export function configExists() {
  return fs.existsSync(getConfigPath());
}

export const CONFIG_TEMPLATE = {
  accountId: '',
  accessKeyId: '',
  secretAccessKey: '',
  bucket: '',
  publicDomain: 'https://cdn.example.com',
  uploadPrefix: '',
  concurrency: 5,
};

function requireField(raw, key) {
  const value = raw?.[key];
  if (typeof value !== 'string' || !value.trim()) {
    throw new ConfigError(`配置项 ${key} 缺失或为空`, {
      code: 'CONFIG_INVALID',
      configPath: getConfigPath(),
    });
  }
  return value.trim();
}

function optionalString(raw, key, fallback = '') {
  const value = raw?.[key];
  if (typeof value !== 'string' || !value.trim()) return fallback;
  return value.trim();
}

function normalizeDomain(domain) {
  return domain.replace(/\/+$/, '');
}

function normalizePrefix(prefix) {
  return prefix.replace(/^\/+|\/+$/g, '');
}

export function loadConfig() {
  const configPath = getConfigPath();

  if (!fs.existsSync(configPath)) {
    throw new ConfigError(`未找到配置文件: ${configPath}`, {
      code: 'CONFIG_MISSING',
      configPath,
    });
  }

  let raw;
  try {
    const text = fs.readFileSync(configPath, 'utf8');
    raw = JSON.parse(text);
  } catch (err) {
    throw new ConfigError(`配置文件解析失败: ${err.message}`, {
      code: 'CONFIG_INVALID',
      configPath,
    });
  }

  const accountId = requireField(raw, 'accountId');
  const accessKeyId = requireField(raw, 'accessKeyId');
  const secretAccessKey = requireField(raw, 'secretAccessKey');
  const bucket = requireField(raw, 'bucket');
  const publicDomain = normalizeDomain(requireField(raw, 'publicDomain'));
  const uploadPrefix = normalizePrefix(optionalString(raw, 'uploadPrefix', ''));

  const concurrencyRaw = raw?.concurrency ?? 5;
  const concurrency = Number.parseInt(concurrencyRaw, 10);
  if (!Number.isFinite(concurrency) || concurrency <= 0) {
    throw new ConfigError(
      `配置项 concurrency 必须是正整数，当前值: ${concurrencyRaw}`,
      { code: 'CONFIG_INVALID', configPath }
    );
  }

  return {
    accountId,
    accessKeyId,
    secretAccessKey,
    bucket,
    publicDomain,
    uploadPrefix,
    concurrency,
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    configPath,
  };
}

export function writeTemplateConfig({ overwrite = false } = {}) {
  const dir = getConfigDir();
  const file = getConfigPath();

  if (fs.existsSync(file) && !overwrite) {
    throw new ConfigError(`配置文件已存在: ${file}`, {
      code: 'CONFIG_EXISTS',
      configPath: file,
    });
  }

  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    file,
    `${JSON.stringify(CONFIG_TEMPLATE, null, 2)}\n`,
    { encoding: 'utf8', mode: 0o600 }
  );
  return file;
}
