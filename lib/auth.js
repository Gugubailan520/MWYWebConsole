// lib/auth.js - 密码 hash + JWT + 鉴权中间件
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { getConfig } = require('./config');
const db = require('./db');

const PBKDF2_ITER = 100000;
const PBKDF2_KEYLEN = 64;
const PBKDF2_DIGEST = 'sha512';

function hashPassword(password, salt) {
  if (!salt) salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync(password, salt, PBKDF2_ITER, PBKDF2_KEYLEN, PBKDF2_DIGEST).toString('hex');
  return { salt, hash };
}

function verifyPassword(password, salt, expectedHash) {
  const { hash } = hashPassword(password, salt);
  // 防时序攻击
  const a = Buffer.from(hash, 'hex');
  const b = Buffer.from(expectedHash, 'hex');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function signToken(payload) {
  const cfg = getConfig();
  return jwt.sign(payload, cfg.jwt_secret, { expiresIn: cfg.jwt_expires_in });
}

function verifyToken(token) {
  if (!token) return null;
  try {
    const cfg = getConfig();
    return jwt.verify(token, cfg.jwt_secret);
  } catch (_) {
    return null;
  }
}

// 从 Authorization / cookie / query.token 中获取 token
function extractToken(req) {
  const auth = req.headers && req.headers.authorization;
  if (auth && auth.startsWith('Bearer ')) return auth.slice(7);
  if (req.headers && req.headers.cookie) {
    const m = req.headers.cookie.match(/(?:^|; )token=([^;]+)/);
    if (m) return decodeURIComponent(m[1]);
  }
  if (req.query && req.query.token) return req.query.token;
  return null;
}

// 获取当前请求对应的用户对象（可能是 admin 虚拟用户）
function resolveUser(payload) {
  if (!payload) return null;
  const cfg = getConfig();
  if (payload.role === 'admin' && payload.username === cfg.admin.username) {
    return { id: 0, username: cfg.admin.username, role: 'admin', disabled: 0, isAdmin: true };
  }
  if (payload.uid) {
    const u = db.findUserById(payload.uid);
    if (u && !u.disabled) return { ...u, isAdmin: false };
  }
  return null;
}

// Express 中间件：要求登录
function requireAuth(req, res, next) {
  const payload = verifyToken(extractToken(req));
  const user = resolveUser(payload);
  if (!user) return res.status(401).json({ error: '未登录或登录已过期' });
  req.user = user;
  next();
}

// Express 中间件：要求管理员
function requireAdmin(req, res, next) {
  const payload = verifyToken(extractToken(req));
  const user = resolveUser(payload);
  if (!user) return res.status(401).json({ error: '未登录' });
  if (!user.isAdmin) return res.status(403).json({ error: '需要管理员权限' });
  req.user = user;
  next();
}

// 校验账号密码（admin 走 config.yml，普通用户走数据库）
function authenticate(username, password) {
  const cfg = getConfig();
  if (username === cfg.admin.username) {
    if (password === cfg.admin.password) {
      return { id: 0, username, role: 'admin', isAdmin: true };
    }
    return null;
  }
  const u = db.findUserByUsername(username);
  if (!u || u.disabled) return null;
  if (!verifyPassword(password, u.salt, u.password_hash)) return null;
  return { id: u.id, username: u.username, role: u.role, isAdmin: false };
}

function buildTokenForUser(user) {
  if (user.isAdmin) {
    return signToken({ role: 'admin', username: user.username });
  }
  return signToken({ uid: user.id, role: user.role || 'user', username: user.username });
}

module.exports = {
  hashPassword,
  verifyPassword,
  signToken,
  verifyToken,
  extractToken,
  resolveUser,
  requireAuth,
  requireAdmin,
  authenticate,
  buildTokenForUser,
};
