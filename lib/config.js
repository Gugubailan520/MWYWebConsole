// lib/config.js - 加载并合并 config.yml 与 .env
// 优先级：config.yml > .env > 默认值
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const yaml = require('js-yaml');

const CONFIG_FILE = path.resolve(process.cwd(), 'config.yml');
const EXAMPLE_FILE = path.resolve(process.cwd(), 'config.example.yml');

let cached = null;

function deepMerge(base, override) {
  if (override === undefined || override === null) return base;
  if (typeof base !== 'object' || base === null) return override;
  if (typeof override !== 'object') return override;
  const out = Array.isArray(base) ? [...base] : { ...base };
  for (const k of Object.keys(override)) {
    if (override[k] && typeof override[k] === 'object' && !Array.isArray(override[k])) {
      out[k] = deepMerge(base[k] || {}, override[k]);
    } else if (override[k] !== undefined) {
      out[k] = override[k];
    }
  }
  return out;
}

function defaults() {
  return {
    port: 25555,
    admin: { username: 'admin', password: 'changeme' },
    jwt_secret: '',
    jwt_expires_in: 604800,
    guacd: { host: '127.0.0.1', port: 4822 },
    guac_ws_port: 4823,
    guac_crypt_key: 'MWYwebConsole-GuacLite!!-Secret!!',
    database: './data/console.db',
    uploads_dir: './data/uploads',
    log_retention_days: 90,
  };
}

function fromEnv() {
  const env = process.env;
  const out = {};
  if (env.PORT) out.port = parseInt(env.PORT) || undefined;
  if (env.GUACD_HOST || env.GUACD_PORT) {
    out.guacd = {};
    if (env.GUACD_HOST) out.guacd.host = env.GUACD_HOST;
    if (env.GUACD_PORT) out.guacd.port = parseInt(env.GUACD_PORT) || undefined;
  }
  if (env.GUAC_WS_PORT) out.guac_ws_port = parseInt(env.GUAC_WS_PORT) || undefined;
  if (env.GUAC_CRYPT_KEY) out.guac_crypt_key = env.GUAC_CRYPT_KEY;
  if (env.JWT_SECRET) out.jwt_secret = env.JWT_SECRET;
  if (env.DATABASE) out.database = env.DATABASE;
  return out;
}

function loadYaml(file) {
  try {
    if (!fs.existsSync(file)) return {};
    const txt = fs.readFileSync(file, 'utf8');
    const obj = yaml.load(txt);
    return obj && typeof obj === 'object' ? obj : {};
  } catch (e) {
    console.error(`[config] 解析 ${file} 失败:`, e.message);
    return {};
  }
}

function ensureCryptKey(key) {
  if (!key) key = 'MWYwebConsole-GuacLite!!-Secret!!';
  return String(key).slice(0, 32).padEnd(32, '0');
}

function ensureJwtSecret(secret) {
  if (secret && String(secret).length >= 16) return String(secret);
  // 自动生成内存密钥（重启后令所有 token 失效）
  return crypto.randomBytes(48).toString('hex');
}

function resolveAbsolute(p) {
  if (!p) return p;
  return path.isAbsolute(p) ? p : path.resolve(process.cwd(), p);
}

function buildConfig() {
  let cfg = defaults();
  // .env 覆盖默认
  cfg = deepMerge(cfg, fromEnv());
  // config.yml 覆盖 .env
  let ymlObj = loadYaml(CONFIG_FILE);
  if (!Object.keys(ymlObj).length) {
    // 兜底：尝试 example 文件
    ymlObj = loadYaml(EXAMPLE_FILE);
  }
  cfg = deepMerge(cfg, ymlObj);

  // 规范化
  cfg.guac_crypt_key = ensureCryptKey(cfg.guac_crypt_key);
  cfg.jwt_secret = ensureJwtSecret(cfg.jwt_secret);
  cfg.database = resolveAbsolute(cfg.database);
  cfg.uploads_dir = resolveAbsolute(cfg.uploads_dir);
  cfg.port = parseInt(cfg.port) || 25555;
  cfg.guac_ws_port = parseInt(cfg.guac_ws_port) || 4823;
  cfg.guacd = cfg.guacd || {};
  cfg.guacd.host = cfg.guacd.host || '127.0.0.1';
  cfg.guacd.port = parseInt(cfg.guacd.port) || 4822;
  cfg.jwt_expires_in = parseInt(cfg.jwt_expires_in) || 604800;
  cfg.log_retention_days = parseInt(cfg.log_retention_days) || 0;
  cfg.admin = cfg.admin || {};
  cfg.admin.username = cfg.admin.username || 'admin';
  cfg.admin.password = cfg.admin.password || 'changeme';

  // 确保目录存在
  try { fs.mkdirSync(path.dirname(cfg.database), { recursive: true }); } catch (_) {}
  try { fs.mkdirSync(cfg.uploads_dir, { recursive: true }); } catch (_) {}

  return cfg;
}

function getConfig() {
  if (!cached) cached = buildConfig();
  return cached;
}

function reloadConfig() {
  cached = buildConfig();
  return cached;
}

module.exports = { getConfig, reloadConfig };
