// lib/db.js - SQLite 初始化、表结构、辅助查询、老数据迁移
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const { getConfig } = require('./config');

let db = null;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  salt TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user',
  disabled INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS user_servers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  encrypted_payload TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_user_servers_user ON user_servers(user_id);

CREATE TABLE IF NOT EXISTS connection_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  username TEXT,
  type TEXT NOT NULL,
  target_host TEXT,
  target_port INTEGER,
  target_user TEXT,
  started_at INTEGER NOT NULL,
  ended_at INTEGER,
  duration_ms INTEGER,
  result TEXT,
  error_message TEXT,
  client_ip TEXT
);
CREATE INDEX IF NOT EXISTS idx_logs_started ON connection_logs(started_at DESC);
CREATE INDEX IF NOT EXISTS idx_logs_user ON connection_logs(user_id);

CREATE TABLE IF NOT EXISTS site_settings (
  key TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE IF NOT EXISTS feature_flags (
  key TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE IF NOT EXISTS proxy_config (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  enabled INTEGER NOT NULL DEFAULT 0,
  host TEXT,
  port INTEGER,
  username TEXT,
  password TEXT,
  apply_ssh INTEGER NOT NULL DEFAULT 1,
  apply_rdp INTEGER NOT NULL DEFAULT 0,
  apply_vnc INTEGER NOT NULL DEFAULT 1,
  apply_ftp INTEGER NOT NULL DEFAULT 1
);
`;

const DEFAULT_SITE_SETTINGS = {
  site_name: '冥雾云Web控制台',
  site_subtitle: 'MWY Web Console',
  site_logo: '/imgs/logo.png',
  site_favicon: '/imgs/logo.png',
  site_background: '/imgs/bj.png',
  primary_color: '#3a86ff',
  footer_text: '',
};

const DEFAULT_FEATURE_FLAGS = {
  enable_ssh: '1',
  enable_sftp: '1',
  enable_rdp: '1',
  enable_vnc: '1',
  enable_ftp: '1',
  enable_register: '1',
};

function init() {
  if (db) return db;
  const cfg = getConfig();
  fs.mkdirSync(path.dirname(cfg.database), { recursive: true });
  db = new Database(cfg.database);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(SCHEMA);

  const insertSetting = db.prepare('INSERT OR IGNORE INTO site_settings(key, value) VALUES (?, ?)');
  for (const [k, v] of Object.entries(DEFAULT_SITE_SETTINGS)) insertSetting.run(k, v);

  const insertFlag = db.prepare('INSERT OR IGNORE INTO feature_flags(key, value) VALUES (?, ?)');
  for (const [k, v] of Object.entries(DEFAULT_FEATURE_FLAGS)) insertFlag.run(k, v);

  db.prepare(`INSERT OR IGNORE INTO proxy_config(id, enabled, host, port, username, password,
    apply_ssh, apply_rdp, apply_vnc, apply_ftp) VALUES (1, 0, NULL, NULL, NULL, NULL, 1, 0, 1, 1)`).run();

  // 一次性迁移老数据
  try {
    migrateLegacyUsers();
  } catch (e) {
    console.error('[db] 老用户数据迁移失败:', e.message);
  }
  return db;
}

function getDb() {
  if (!db) init();
  return db;
}

// ===== 设置类辅助 =====
function getAllSiteSettings() {
  const rows = getDb().prepare('SELECT key, value FROM site_settings').all();
  const out = { ...DEFAULT_SITE_SETTINGS };
  for (const r of rows) out[r.key] = r.value;
  return out;
}
function setSiteSetting(key, value) {
  getDb().prepare(`INSERT INTO site_settings(key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(key, value == null ? null : String(value));
}

function getAllFeatureFlags() {
  const rows = getDb().prepare('SELECT key, value FROM feature_flags').all();
  const out = { ...DEFAULT_FEATURE_FLAGS };
  for (const r of rows) out[r.key] = r.value;
  return out;
}
function isFeatureEnabled(key) {
  const flags = getAllFeatureFlags();
  return flags[key] === '1' || flags[key] === 1 || flags[key] === true;
}
function setFeatureFlag(key, value) {
  const v = (value === true || value === 1 || value === '1') ? '1' : '0';
  getDb().prepare(`INSERT INTO feature_flags(key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(key, v);
}

function getProxyConfig() {
  const row = getDb().prepare('SELECT * FROM proxy_config WHERE id = 1').get();
  if (!row) return { enabled: false };
  return {
    enabled: !!row.enabled,
    host: row.host || '',
    port: row.port || 0,
    username: row.username || '',
    password: row.password || '',
    apply_ssh: !!row.apply_ssh,
    apply_rdp: !!row.apply_rdp,
    apply_vnc: !!row.apply_vnc,
    apply_ftp: !!row.apply_ftp,
  };
}
function setProxyConfig(p) {
  getDb().prepare(`UPDATE proxy_config SET
    enabled = ?, host = ?, port = ?, username = ?, password = ?,
    apply_ssh = ?, apply_rdp = ?, apply_vnc = ?, apply_ftp = ?
    WHERE id = 1`).run(
    p.enabled ? 1 : 0,
    p.host || null,
    p.port ? parseInt(p.port) : null,
    p.username || null,
    p.password || null,
    p.apply_ssh ? 1 : 0,
    p.apply_rdp ? 1 : 0,
    p.apply_vnc ? 1 : 0,
    p.apply_ftp ? 1 : 0
  );
}

// ===== 用户类辅助 =====
function findUserByUsername(username) {
  return getDb().prepare('SELECT * FROM users WHERE username = ?').get(username);
}
function findUserById(id) {
  return getDb().prepare('SELECT * FROM users WHERE id = ?').get(id);
}
function listUsers() {
  return getDb().prepare(`SELECT id, username, role, disabled, created_at, updated_at
    FROM users ORDER BY id ASC`).all();
}
function createUser({ username, password_hash, salt, role = 'user' }) {
  const now = Date.now();
  const info = getDb().prepare(`INSERT INTO users(username, password_hash, salt, role, disabled, created_at, updated_at)
    VALUES (?, ?, ?, ?, 0, ?, ?)`).run(username, password_hash, salt, role, now, now);
  return info.lastInsertRowid;
}
function updateUserPassword(id, password_hash, salt) {
  getDb().prepare(`UPDATE users SET password_hash = ?, salt = ?, updated_at = ? WHERE id = ?`)
    .run(password_hash, salt, Date.now(), id);
}
function setUserDisabled(id, disabled) {
  getDb().prepare(`UPDATE users SET disabled = ?, updated_at = ? WHERE id = ?`)
    .run(disabled ? 1 : 0, Date.now(), id);
}
function deleteUser(id) {
  getDb().prepare('DELETE FROM users WHERE id = ?').run(id);
}

// ===== user_servers 辅助 =====
function getUserServers(userId) {
  return getDb().prepare(`SELECT id, name, encrypted_payload, updated_at
    FROM user_servers WHERE user_id = ? ORDER BY updated_at DESC`).all(userId);
}
function upsertUserServer(userId, name, encryptedPayload) {
  const existing = getDb().prepare('SELECT id FROM user_servers WHERE user_id = ? AND name = ?').get(userId, name);
  const now = Date.now();
  if (existing) {
    getDb().prepare('UPDATE user_servers SET encrypted_payload = ?, updated_at = ? WHERE id = ?')
      .run(encryptedPayload, now, existing.id);
    return existing.id;
  }
  const info = getDb().prepare(`INSERT INTO user_servers(user_id, name, encrypted_payload, updated_at)
    VALUES (?, ?, ?, ?)`).run(userId, name, encryptedPayload, now);
  return info.lastInsertRowid;
}
function deleteUserServer(userId, name) {
  getDb().prepare('DELETE FROM user_servers WHERE user_id = ? AND name = ?').run(userId, name);
}

// ===== 连接日志 =====
function insertLog(entry) {
  const info = getDb().prepare(`INSERT INTO connection_logs(
    user_id, username, type, target_host, target_port, target_user,
    started_at, ended_at, duration_ms, result, error_message, client_ip)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    entry.user_id || null,
    entry.username || null,
    entry.type,
    entry.target_host || null,
    entry.target_port || null,
    entry.target_user || null,
    entry.started_at || Date.now(),
    entry.ended_at || null,
    entry.duration_ms || null,
    entry.result || null,
    entry.error_message || null,
    entry.client_ip || null
  );
  return info.lastInsertRowid;
}
function updateLog(id, patch) {
  if (!id) return;
  const fields = [];
  const values = [];
  for (const k of ['ended_at', 'duration_ms', 'result', 'error_message']) {
    if (patch[k] !== undefined) { fields.push(`${k} = ?`); values.push(patch[k]); }
  }
  if (!fields.length) return;
  values.push(id);
  getDb().prepare(`UPDATE connection_logs SET ${fields.join(', ')} WHERE id = ?`).run(...values);
}
function listLogs({ limit = 200, offset = 0, userId, type } = {}) {
  const where = [];
  const params = [];
  if (userId) { where.push('user_id = ?'); params.push(userId); }
  if (type) { where.push('type = ?'); params.push(type); }
  const sql = `SELECT * FROM connection_logs ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY started_at DESC LIMIT ? OFFSET ?`;
  params.push(parseInt(limit) || 200, parseInt(offset) || 0);
  return getDb().prepare(sql).all(...params);
}
function purgeOldLogs(retentionDays) {
  if (!retentionDays || retentionDays <= 0) return 0;
  const cutoff = Date.now() - retentionDays * 86400000;
  const info = getDb().prepare('DELETE FROM connection_logs WHERE started_at < ?').run(cutoff);
  return info.changes;
}

// ===== 老 ./users/*.json 迁移 =====
function migrateLegacyUsers() {
  const usersDir = path.resolve(process.cwd(), 'users');
  if (!fs.existsSync(usersDir)) return;
  const files = fs.readdirSync(usersDir).filter(f => f.endsWith('.json'));
  if (!files.length) return;
  const flagFile = path.join(usersDir, '.migrated');
  if (fs.existsSync(flagFile)) return;

  const insert = getDb().prepare(`INSERT OR IGNORE INTO users(username, password_hash, salt, role, disabled, created_at, updated_at)
    VALUES (?, ?, ?, 'user', 0, ?, ?)`);
  let migrated = 0;
  for (const f of files) {
    if (f.startsWith('.')) continue;
    try {
      const data = JSON.parse(fs.readFileSync(path.join(usersDir, f), 'utf8'));
      if (!data || !data.username || !data.passwordHash || !data.salt) continue;
      const now = Date.now();
      const r = insert.run(data.username, data.passwordHash, data.salt, now, now);
      if (r.changes) migrated++;
    } catch (e) {
      console.warn(`[db] 跳过老用户文件 ${f}:`, e.message);
    }
  }
  try { fs.writeFileSync(flagFile, String(Date.now())); } catch (_) {}
  if (migrated) console.log(`[db] 已迁移 ${migrated} 个老用户到 SQLite`);
}

module.exports = {
  init,
  getDb,
  // 设置
  getAllSiteSettings, setSiteSetting,
  getAllFeatureFlags, isFeatureEnabled, setFeatureFlag,
  getProxyConfig, setProxyConfig,
  // 用户
  findUserByUsername, findUserById, listUsers, createUser,
  updateUserPassword, setUserDisabled, deleteUser,
  // user_servers
  getUserServers, upsertUserServer, deleteUserServer,
  // 日志
  insertLog, updateLog, listLogs, purgeOldLogs,
};
