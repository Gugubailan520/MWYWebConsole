// lib/admin-api.js - \u7ba1\u7406\u540e\u53f0 API \u8def\u7531\u96c6\u5408
const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { getConfig } = require('./config');
const db = require('./db');
const auth = require('./auth');

function createAdminRouter() {
  const cfg = getConfig();
  const router = express.Router();

  // \u4e0a\u4f20\u76ee\u5f55
  fs.mkdirSync(cfg.uploads_dir, { recursive: true });

  const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, cfg.uploads_dir),
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname || '').toLowerCase().slice(0, 8) || '.bin';
      const base = (req.body && req.body.kind ? String(req.body.kind) : 'asset').replace(/[^a-z0-9_\-]/gi, '');
      cb(null, `${base}_${Date.now()}${ext}`);
    },
  });
  const upload = multer({
    storage,
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
      const okMime = /^image\/(png|jpeg|jpg|gif|webp|svg\+xml|x-icon|vnd\.microsoft\.icon)$/.test(file.mimetype);
      cb(null, okMime);
    },
  });

  // \u6240\u6709\u7ba1\u7406\u540e\u53f0 API \u5747\u9700\u7ba1\u7406\u5458
  router.use(auth.requireAdmin);

  // ===== \u7ad9\u70b9\u6837\u5f0f =====
  router.get('/site', (req, res) => {
    res.json({ success: true, settings: db.getAllSiteSettings() });
  });
  router.put('/site', (req, res) => {
    const settings = req.body || {};
    const allowed = new Set(['site_name', 'site_subtitle', 'site_logo', 'site_favicon', 'site_background', 'primary_color', 'footer_text']);
    for (const k of Object.keys(settings)) {
      if (!allowed.has(k)) continue;
      db.setSiteSetting(k, settings[k]);
    }
    res.json({ success: true, settings: db.getAllSiteSettings() });
  });

  // \u4e0a\u4f20\u8d44\u6e90\uff08logo/background/favicon\uff09
  router.post('/upload', upload.single('file'), (req, res) => {
    if (!req.file) return res.status(400).json({ error: '\u4ec5\u652f\u6301\u56fe\u7247\uff0c\u4e14\u4e0d\u5927\u4e8e 5MB' });
    const url = `/uploads/${req.file.filename}`;
    res.json({ success: true, url });
  });

  // ===== \u529f\u80fd\u5f00\u5173 =====
  router.get('/features', (req, res) => {
    res.json({ success: true, flags: db.getAllFeatureFlags() });
  });
  router.put('/features', (req, res) => {
    const flags = req.body || {};
    const allowed = new Set(['enable_ssh', 'enable_sftp', 'enable_rdp', 'enable_vnc', 'enable_ftp', 'enable_register']);
    for (const k of Object.keys(flags)) {
      if (!allowed.has(k)) continue;
      db.setFeatureFlag(k, flags[k]);
    }
    res.json({ success: true, flags: db.getAllFeatureFlags() });
  });

  // ===== \u4ee3\u7406\u914d\u7f6e =====
  router.get('/proxy', (req, res) => {
    res.json({ success: true, proxy: db.getProxyConfig() });
  });
  router.put('/proxy', (req, res) => {
    const p = req.body || {};
    db.setProxyConfig({
      enabled: !!p.enabled,
      host: p.host || '',
      port: parseInt(p.port) || 0,
      username: p.username || '',
      password: p.password || '',
      apply_ssh: !!p.apply_ssh,
      apply_rdp: !!p.apply_rdp,
      apply_vnc: !!p.apply_vnc,
      apply_ftp: !!p.apply_ftp,
    });
    res.json({ success: true, proxy: db.getProxyConfig() });
  });

  // ===== \u7528\u6237\u7ba1\u7406 =====
  router.get('/users', (req, res) => {
    res.json({ success: true, users: db.listUsers() });
  });
  router.post('/users', (req, res) => {
    const { username, password } = req.body || {};
    if (!username || !password) return res.json({ error: '\u7528\u6237\u540d\u548c\u5bc6\u7801\u4e0d\u80fd\u4e3a\u7a7a' });
    if (!/^[a-zA-Z0-9_\-]+$/.test(username)) return res.json({ error: '用户名只能包含字母、数字、下划线和横线' });
    if (username === cfg.admin.username) return res.json({ error: '\u4e0e\u7ba1\u7406\u5458\u540c\u540d' });
    if (db.findUserByUsername(username)) return res.json({ error: '\u7528\u6237\u540d\u5df2\u5b58\u5728' });
    const { salt, hash } = auth.hashPassword(password);
    const id = db.createUser({ username, password_hash: hash, salt, role: 'user' });
    res.json({ success: true, id });
  });
  router.put('/users/:id/password', (req, res) => {
    const id = parseInt(req.params.id);
    const { password } = req.body || {};
    if (!password) return res.json({ error: '\u5bc6\u7801\u4e0d\u80fd\u4e3a\u7a7a' });
    if (!db.findUserById(id)) return res.status(404).json({ error: '\u7528\u6237\u4e0d\u5b58\u5728' });
    const { salt, hash } = auth.hashPassword(password);
    db.updateUserPassword(id, hash, salt);
    res.json({ success: true });
  });
  router.put('/users/:id/disabled', (req, res) => {
    const id = parseInt(req.params.id);
    if (!db.findUserById(id)) return res.status(404).json({ error: '\u7528\u6237\u4e0d\u5b58\u5728' });
    db.setUserDisabled(id, !!req.body.disabled);
    res.json({ success: true });
  });
  router.delete('/users/:id', (req, res) => {
    const id = parseInt(req.params.id);
    if (!db.findUserById(id)) return res.status(404).json({ error: '\u7528\u6237\u4e0d\u5b58\u5728' });
    db.deleteUser(id);
    res.json({ success: true });
  });

  // ===== \u8fde\u63a5\u65e5\u5fd7 =====
  router.get('/logs', (req, res) => {
    const limit = parseInt(req.query.limit) || 200;
    const offset = parseInt(req.query.offset) || 0;
    const userId = req.query.userId ? parseInt(req.query.userId) : undefined;
    const type = req.query.type || undefined;
    res.json({ success: true, logs: db.listLogs({ limit, offset, userId, type }) });
  });

  // ===== \u670d\u52a1\u4fe1\u606f =====
  router.get('/info', (req, res) => {
    res.json({
      success: true,
      info: {
        admin_username: cfg.admin.username,
        port: cfg.port,
        guacd: cfg.guacd,
        database: cfg.database,
        uploads_dir: cfg.uploads_dir,
        log_retention_days: cfg.log_retention_days,
      },
    });
  });

  return router;
}

module.exports = { createAdminRouter };
