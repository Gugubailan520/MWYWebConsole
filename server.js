#!/usr/bin/env node
require('dotenv').config();
const express = require('express');
const http = require('http');
const net = require('net');
const WebSocket = require('ws');
const { Client } = require('ssh2');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const ftp = require('basic-ftp');
const { Readable, Writable } = require('stream');
const GuacamoleLite = require('guacamole-lite');
const Crypt = require('guacamole-lite/lib/Crypt');

// ==================== Local modules ====================
const { getConfig } = require('./lib/config');
const dbLib = require('./lib/db');
const authLib = require('./lib/auth');
const proxyLib = require('./lib/proxy');
const featureGate = require('./lib/features');
const CFG = getConfig();
dbLib.init();
// 周期清理过期日志
if (CFG.log_retention_days > 0) {
  setInterval(() => { try { dbLib.purgeOldLogs(CFG.log_retention_days); } catch (_) {} }, 6 * 3600 * 1000).unref();
  try { dbLib.purgeOldLogs(CFG.log_retention_days); } catch (_) {}
}

// ==================== Guacamole Config ====================
const GUAC_CRYPT_KEY = CFG.guac_crypt_key;
const GUAC_WS_PORT   = CFG.guac_ws_port;
const GUACD_HOST     = CFG.guacd.host;
const GUACD_PORT     = CFG.guacd.port;
const guacCrypt = new Crypt('AES-256-CBC', GUAC_CRYPT_KEY);

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ noServer: true, maxPayload: 50 * 1024 * 1024 });
const vncWss = new WebSocket.Server({ noServer: true });

// Route WebSocket upgrades
server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/vnc-proxy') {
    if (!featureGate.isProtocolEnabled('vnc')) {
      socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
      try { socket.destroy(); } catch (_) {}
      return;
    }
    vncWss.handleUpgrade(req, socket, head, (ws) => vncWss.emit('connection', ws, req));
  } else if (url.pathname === '/guac') {
    if (!featureGate.isProtocolEnabled('rdp')) {
      socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
      try { socket.destroy(); } catch (_) {}
      return;
    }
    // TCP proxy → internal guacamole-lite
    const guacSock = net.createConnection({ host: '127.0.0.1', port: GUAC_WS_PORT }, () => {
      let raw = `${req.method} ${req.url} HTTP/${req.httpVersion}\r\n`;
      for (let i = 0; i < req.rawHeaders.length; i += 2)
        raw += `${req.rawHeaders[i]}: ${req.rawHeaders[i + 1]}\r\n`;
      raw += '\r\n';
      guacSock.write(raw);
      if (head && head.length > 0) guacSock.write(head);
      socket.pipe(guacSock);
      guacSock.pipe(socket);
    });
    guacSock.on('error', () => { try { socket.destroy(); } catch {} });
    socket.on('error', () => { try { guacSock.destroy(); } catch {} });
  } else {
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
  }
});

// ==================== VNC WebSocket Proxy ====================
vncWss.on('connection', (ws, req) => {
  const url = new URL(req.url, 'http://localhost');
  const host = url.searchParams.get('host');
  const port = parseInt(url.searchParams.get('port')) || 5900;

  if (!host) { ws.close(1008, 'Missing host'); return; }

  const u = resolveUserFromReq(req);
  const vlogId = logStart({ ...u, type: 'vnc', target_host: host, target_port: port, client_ip: clientIp(req) });
  let finalized = false;
  const finishOnce = (result, errMsg) => { if (!finalized) { finalized = true; logFinish(vlogId, result, errMsg); } };

  const connectVNC = async () => {
    let tcp;
    try {
      tcp = await proxyLib.dial('vnc', host, port);
      finishOnce('connected');
    } catch (e) {
      // Proxy failed, try direct
      try {
        tcp = net.createConnection({ host, port }, () => {
          finishOnce('connected');
        });
      } catch (e2) {
        finishOnce('error', e2.message);
        ws.close(1011, e2.message);
        return;
      }
    }

    tcp.on('data', (buf) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(buf);
      }
    });

    tcp.on('error', (err) => {
      finishOnce('error', err.message);
      try { ws.close(1011, err.message); } catch {}
    });

    tcp.on('close', () => {
      finishOnce('closed');
      try { ws.close(); } catch {}
    });

    ws.on('message', (msg) => {
      if (tcp.writable) {
        // Ensure we write Buffer, not string
        tcp.write(Buffer.isBuffer(msg) ? msg : Buffer.from(msg));
      }
    });

    ws.on('close', () => {
      tcp.destroy();
    });
  };
  connectVNC();
});

app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true, limit: '5mb' }));
app.use(express.static(path.join(__dirname, 'public')));
// 管理后台上传的静态资源
app.use('/uploads', express.static(CFG.uploads_dir));
// 管理后台 API
const { createAdminRouter } = require('./lib/admin-api');
app.use('/api/admin', createAdminRouter());

// ===== 公开的站点信息（页面样式 + 功能开关）=====
app.get('/api/site/info', (req, res) => {
  try {
    const settings = dbLib.getAllSiteSettings();
    const flags = dbLib.getAllFeatureFlags();
    res.json({
      success: true,
      site: settings,
      features: {
        ssh: flags.enable_ssh === '1',
        sftp: flags.enable_sftp === '1',
        rdp: flags.enable_rdp === '1',
        vnc: flags.enable_vnc === '1',
        ftp: flags.enable_ftp === '1',
        register: flags.enable_register === '1',
      },
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Serve Guacamole JS client (strip ESM export → window global)
app.get('/guacamole-common.js', (req, res) => {
  const filePath = path.join(__dirname, 'node_modules/guacamole-common-js/dist/esm/guacamole-common.js');
  try {
    let code = fs.readFileSync(filePath, 'utf-8');
    code = code.replace(/^export default Guacamole;?\s*$/m, 'window.Guacamole = Guacamole;');
    res.setHeader('Content-Type', 'application/javascript');
    res.send(code);
  } catch (e) {
    res.status(500).send('// Failed to load guacamole-common-js: ' + e.message);
  }
});

// Generate encrypted RDP connection token
app.post('/api/rdp-token', featureGate.requireProtocol('rdp'), (req, res) => {
  const { host, port, username, password, domain, width, height } = req.body;
  if (!host) return res.json({ error: '缺少主机地址' });
  const u = resolveUserFromReq(req);
  const lid = logStart({ ...u, type: 'rdp', target_host: host, target_port: parseInt(port) || 3389, target_user: username || '', client_ip: clientIp(req) });
  try {
    const token = guacCrypt.encrypt({
      connection: {
        type: 'rdp',
        settings: {
          hostname: host,
          port: String(port || 3389),
          username: username || '',
          password: password || '',
          domain: domain || '',
          security: 'any',
          'ignore-cert': 'true',
          width: String(width || 1280),
          height: String(height || 720),
          'color-depth': '32',
          'resize-method': 'display-update',
          'enable-wallpaper': 'true',
          'enable-theming': 'true',
          'enable-font-smoothing': 'true',
          'enable-full-window-drag': 'true',
          'enable-desktop-composition': 'true',
          'enable-menu-animations': 'true',
        }
      }
    });
    res.json({ token });
  } catch (e) {
    logFinish(lid, 'error', e.message);
    res.json({ error: '令牌生成失败: ' + e.message });
    return;
  }
  logFinish(lid, 'token-issued');
});

// Initialize guacamole-lite on internal port (127.0.0.1 only)
try {
  new GuacamoleLite(
    { port: GUAC_WS_PORT, host: '127.0.0.1' },
    { host: GUACD_HOST, port: GUACD_PORT },
    {
      crypt: { cypher: 'AES-256-CBC', key: GUAC_CRYPT_KEY },
      log: { level: 'ERRORS' }
    }
  );
  console.log(`[Guacamole] Proxy at 127.0.0.1:${GUAC_WS_PORT} → guacd ${GUACD_HOST}:${GUACD_PORT}`);
} catch (e) {
  console.warn(`[Guacamole] Failed to start: ${e.message}`);
  console.warn('[Guacamole] Run guacd: docker run -d -p 4822:4822 guacamole/guacd');
}

// ==================== FTP API ====================
async function createFtpClient(opts) {
  const client = new ftp.Client();
  client.ftp.verbose = false;
  const secure = opts.secure === 'true' ? true : opts.secure === 'implicit' ? 'implicit' : false;
  const ftpOpts = {
    host: opts.host,
    port: parseInt(opts.port) || 21,
    user: opts.username || 'anonymous',
    password: opts.password || '',
    secure,
    secureOptions: { rejectUnauthorized: false }
  };
  // Try SOCKS5 proxy for FTP
  try {
    const proxySock = await proxyLib.dial('ftp', opts.host, parseInt(opts.port) || 21);
    if (proxySock && proxySock.remoteAddress) {
      // basic-ftp supports socket option
      ftpOpts.socket = proxySock;
    }
  } catch (e) {
    console.warn('[proxy] SOCKS5 dial failed for FTP, falling back to direct:', e.message);
  }
  await client.access(ftpOpts);
  return client;
}

// List directory
app.post('/ftp/list', featureGate.requireProtocol('ftp'), async (req, res) => {
  let client;
  const u = resolveUserFromReq(req);
  const lid = logStart({ ...u, type: 'ftp', target_host: req.body && req.body.host, target_port: parseInt(req.body && req.body.port) || 21, target_user: req.body && req.body.username, client_ip: clientIp(req) });
  try {
    client = await createFtpClient(req.body);
    const list = await client.list(req.body.path || '/');
    logFinish(lid, 'connected');
    res.json({ ok: true, data: list.map(f => ({
      name: f.name, size: f.size, type: f.type === 2 ? 'd' : 'f',
      date: f.rawModifiedAt || f.modifiedAt?.toISOString() || '',
      permissions: f.permissions || {}
    }))});
  } catch (e) {
    logFinish(lid, 'error', e.message);
    res.json({ ok: false, error: e.message });
  } finally {
    if (client) client.close();
  }
});

// Download file
app.post('/ftp/download', featureGate.requireProtocol('ftp'), async (req, res) => {
  let client;
  try {
    client = await createFtpClient(req.body);
    const remotePath = req.body.path;
    const filename = path.basename(remotePath);
    res.setHeader('Content-Disposition', 'attachment; filename="' + encodeURIComponent(filename) + '"');
    res.setHeader('Content-Type', 'application/octet-stream');
    await client.downloadTo(res, remotePath);
  } catch (e) {
    if (!res.headersSent) res.json({ ok: false, error: e.message });
  } finally {
    if (client) client.close();
  }
});

// Upload file (base64 body)
app.post('/ftp/upload', featureGate.requireProtocol('ftp'), async (req, res) => {
  let client;
  try {
    client = await createFtpClient(req.body);
    const buf = Buffer.from(req.body.fileData, 'base64');
    const stream = new Readable();
    stream.push(buf);
    stream.push(null);
    await client.uploadFrom(stream, req.body.path);
    res.json({ ok: true });
  } catch (e) {
    res.json({ ok: false, error: e.message });
  } finally {
    if (client) client.close();
  }
});

// Delete file
app.post('/ftp/delete', featureGate.requireProtocol('ftp'), async (req, res) => {
  let client;
  try {
    client = await createFtpClient(req.body);
    await client.remove(req.body.path);
    res.json({ ok: true });
  } catch (e) {
    res.json({ ok: false, error: e.message });
  } finally {
    if (client) client.close();
  }
});

// Remove directory
app.post('/ftp/rmdir', featureGate.requireProtocol('ftp'), async (req, res) => {
  let client;
  try {
    client = await createFtpClient(req.body);
    await client.removeDir(req.body.path);
    res.json({ ok: true });
  } catch (e) {
    res.json({ ok: false, error: e.message });
  } finally {
    if (client) client.close();
  }
});

// Create directory
app.post('/ftp/mkdir', featureGate.requireProtocol('ftp'), async (req, res) => {
  let client;
  try {
    client = await createFtpClient(req.body);
    await client.ensureDir(req.body.path);
    res.json({ ok: true });
  } catch (e) {
    res.json({ ok: false, error: e.message });
  } finally {
    if (client) client.close();
  }
});

// Rename
app.post('/ftp/rename', featureGate.requireProtocol('ftp'), async (req, res) => {
  let client;
  try {
    client = await createFtpClient(req.body);
    await client.rename(req.body.oldPath, req.body.newPath);
    res.json({ ok: true });
  } catch (e) {
    res.json({ ok: false, error: e.message });
  } finally {
    if (client) client.close();
  }
});

// ==================== User Auth & Sync ====================
// 历史兼容：./users/*.json 在 db.init() 中会被一次性迁移到 SQLite。
// admin 账号在 config.yml 配置，不进入 users 表。

// Register
app.post('/api/register', (req, res) => {
  if (!featureGate.isRegisterEnabled()) {
    return res.status(403).json({ error: '管理员已关闭注册' });
  }
  const { username, password } = req.body || {};
  if (!username || !password) return res.json({ error: '用户名和密码不能为空' });
  if (username.length < 2 || username.length > 32) return res.json({ error: '用户名长度 2-32 位' });
  if (password.length < 4) return res.json({ error: '密码至少 4 位' });
  if (!/^[a-zA-Z0-9_\-]+$/.test(username)) return res.json({ error: '用户名只能包含字母、数字、下划线和横线' });
  if (username === CFG.admin.username) return res.json({ error: '该用户名为管理员保留' });
  if (dbLib.findUserByUsername(username)) return res.json({ error: '用户名已存在' });

  const { salt, hash } = authLib.hashPassword(password);
  const id = dbLib.createUser({ username, password_hash: hash, salt, role: 'user' });
  const token = authLib.buildTokenForUser({ id, username, role: 'user', isAdmin: false });
  res.json({ success: true, token, user: { id, username, role: 'user' } });
});

// Login — returns JWT token and basic user info
app.post('/api/login', (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.json({ error: '用户名和密码不能为空' });
  const user = authLib.authenticate(username, password);
  if (!user) return res.json({ error: '用户名或密码错误' });
  const token = authLib.buildTokenForUser(user);
  // 返回云服务器列表（仅普通用户，admin 不存访问服务器）
  let servers = [];
  if (!user.isAdmin) {
    servers = dbLib.getUserServers(user.id).map(s => ({ id: s.id, name: s.name }));
  }
  res.json({
    success: true,
    token,
    user: { id: user.id, username: user.username, role: user.role, isAdmin: !!user.isAdmin },
    servers,
  });
});

// 当前用户信息
app.get('/api/me', authLib.requireAuth, (req, res) => {
  res.json({
    success: true,
    user: {
      id: req.user.id,
      username: req.user.username,
      role: req.user.role,
      isAdmin: !!req.user.isAdmin,
    },
  });
});

// Upload servers (replace all cloud data) — 需 token
app.post('/api/sync/upload', authLib.requireAuth, (req, res) => {
  if (req.user.isAdmin) return res.status(403).json({ error: '管理员账号不支持云同步' });
  const { servers } = req.body || {};
  if (!Array.isArray(servers)) return res.json({ error: '数据格式错误' });
  // 全量覆盖：先清空再写入
  const tx = dbLib.getDb().transaction((rows) => {
    dbLib.getDb().prepare('DELETE FROM user_servers WHERE user_id = ?').run(req.user.id);
    for (const s of rows) {
      if (!s || !s.name) continue;
      const payload = JSON.stringify(s);
      dbLib.upsertUserServer(req.user.id, s.name, payload);
    }
  });
  try {
    tx(servers);
    res.json({ success: true });
  } catch (e) {
    res.json({ error: '保存失败: ' + e.message });
  }
});

// Download all servers (with encrypted data for client to decrypt) — 需 token
app.post('/api/sync/download', authLib.requireAuth, (req, res) => {
  if (req.user.isAdmin) return res.status(403).json({ error: '管理员账号不支持云同步' });
  const rows = dbLib.getUserServers(req.user.id);
  const servers = [];
  let latest = 0;
  for (const r of rows) {
    try {
      const obj = JSON.parse(r.encrypted_payload);
      servers.push(obj);
      if (r.updated_at > latest) latest = r.updated_at;
    } catch (_) {}
  }
  res.json({ success: true, servers, updatedAt: latest ? new Date(latest).toISOString() : null });
});

// List cloud servers (metadata) — 需 token
app.post('/api/sync/list', authLib.requireAuth, (req, res) => {
  if (req.user.isAdmin) return res.json({ success: true, servers: [] });
  const rows = dbLib.getUserServers(req.user.id);
  const servers = rows.map(r => {
    let meta = { id: r.id, name: r.name };
    try {
      const obj = JSON.parse(r.encrypted_payload);
      if (obj && typeof obj === 'object') {
        meta.host = obj.host;
        meta.port = obj.port;
        meta.user = obj.user;
      }
    } catch (_) {}
    return meta;
  });
  res.json({ success: true, servers });
});



function sendJSON(ws, obj) {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj));
}

// 从请求中提取用户信息（可选）
function resolveUserFromReq(req) {
  try {
    const payload = authLib.verifyToken(authLib.extractToken(req));
    const user = authLib.resolveUser(payload);
    if (user) return { user_id: user.isAdmin ? null : user.id, username: user.username };
  } catch (_) {}
  return { user_id: null, username: null };
}
function clientIp(req) {
  return (req && req.socket && req.socket.remoteAddress) || null;
}
function logStart(ctx) {
  try { return dbLib.insertLog({ ...ctx, started_at: Date.now(), result: 'pending' }); } catch (_) { return null; }
}
function logFinish(id, result, errMsg) {
  if (!id) return;
  try {
    const startedAt = (dbLib.getDb().prepare('SELECT started_at FROM connection_logs WHERE id = ?').get(id) || {}).started_at;
    const ended = Date.now();
    dbLib.updateLog(id, {
      ended_at: ended,
      duration_ms: startedAt ? ended - startedAt : null,
      result: result || 'unknown',
      error_message: errMsg || null,
    });
  } catch (_) {}
}

// ==================== WebSocket SSH + SFTP ====================

wss.on('connection', (ws, req) => {
  let sshClient = null;
  let stream = null;
  let sftp = null;
  let shellPid = null;
  let logId = null;

  ws.on('message', (msg) => {
    let data;
    try {
      data = JSON.parse(msg);
    } catch {
      if (stream) stream.write(msg);
      return;
    }

    // ---- SFTP-only connection ----
    if (data.type === 'sftp-connect') {
      if (!featureGate.isProtocolEnabled('sftp')) {
        sendJSON(ws, { type: 'error', message: '管理员已禁用 SFTP 功能' });
        return;
      }
      sshClient = new Client();
      const connOpts = {
        host: data.host,
        port: data.port || 22,
        username: data.username,
        readyTimeout: 10000,
      };
      if (data.privateKey) connOpts.privateKey = data.privateKey;
      else if (data.password) connOpts.password = data.password;

      const u = resolveUserFromReq(req);
      logId = logStart({ ...u, type: 'sftp', target_host: data.host, target_port: data.port || 22, target_user: data.username, client_ip: clientIp(req) });

      const connectSSH = async () => {
        try {
          const sock = await proxyLib.dial('sftp', data.host, data.port || 22);
          if (sock !== null && sock.remoteAddress) {
            // SOCKS5 proxied socket
            connOpts.sock = sock;
            delete connOpts.host;
            delete connOpts.port;
          }
        } catch (e) {
          // Proxy failed, fall back to direct
          console.warn('[proxy] SOCKS5 dial failed for SFTP, falling back to direct:', e.message);
        }
        sshClient.on('ready', () => {
          logFinish(logId, 'connected'); logId = null;
          sendJSON(ws, { type: 'status', message: 'connected' });
          sshClient.sftp((err, s) => {
            if (err) { sendJSON(ws, { type: 'error', message: 'SFTP init failed: ' + err.message }); return; }
            sftp = s;
            sendJSON(ws, { type: 'sftp-ready' });
          });
        });
        sshClient.on('error', (err) => { logFinish(logId, 'error', err.message); logId = null; sendJSON(ws, { type: 'error', message: err.message }); });
        sshClient.on('close', () => sendJSON(ws, { type: 'status', message: 'disconnected' }));
        sshClient.connect(connOpts);
      };
      connectSSH();

    // ---- SSH Shell ----
    } else if (data.type === 'connect') {
      if (!featureGate.isProtocolEnabled('ssh')) {
        sendJSON(ws, { type: 'error', message: '管理员已禁用 SSH 功能' });
        return;
      }
      sshClient = new Client();
      const connOpts = {
        host: data.host,
        port: data.port || 22,
        username: data.username,
        readyTimeout: 10000,
      };
      if (data.privateKey) connOpts.privateKey = data.privateKey;
      else if (data.password) connOpts.password = data.password;

      const u2 = resolveUserFromReq(req);
      logId = logStart({ ...u2, type: 'ssh', target_host: data.host, target_port: data.port || 22, target_user: data.username, client_ip: clientIp(req) });

      const connectSSH = async () => {
        try {
          const sock = await proxyLib.dial('ssh', data.host, data.port || 22);
          if (sock !== null && sock.remoteAddress) {
            connOpts.sock = sock;
            delete connOpts.host;
            delete connOpts.port;
          }
        } catch (e) {
          console.warn('[proxy] SOCKS5 dial failed for SSH, falling back to direct:', e.message);
        }
        sshClient.on('ready', () => {
          logFinish(logId, 'connected'); logId = null;
          sendJSON(ws, { type: 'status', message: 'connected' });

          sshClient.shell(
            { term: 'xterm-256color', cols: data.cols || 80, rows: data.rows || 24 },
            (err, s) => {
              if (err) { sendJSON(ws, { type: 'error', message: err.message }); return; }
              stream = s;
              stream.on('data', (chunk) => { if (ws.readyState === WebSocket.OPEN) ws.send(chunk.toString('utf-8')); });
              stream.on('close', () => { sendJSON(ws, { type: 'status', message: 'disconnected' }); sshClient.end(); });
              stream.stderr.on('data', (chunk) => { if (ws.readyState === WebSocket.OPEN) ws.send(chunk.toString('utf-8')); });
            }
          );

          // Auto-init SFTP
          sshClient.sftp((err, s) => {
            if (!err) { sftp = s; sendJSON(ws, { type: 'sftp-ready' }); }
          });
        });

        sshClient.on('error', (err) => { logFinish(logId, 'error', err.message); logId = null; sendJSON(ws, { type: 'error', message: err.message }); });
        sshClient.on('close', () => sendJSON(ws, { type: 'status', message: 'disconnected' }));
        sshClient.connect(connOpts);
      };
      connectSSH();

    } else if (data.type === 'data') {
      if (stream) stream.write(data.data);

    } else if (data.type === 'resize') {
      if (stream) stream.setWindow(data.rows, data.cols, 0, 0);

    // ---- Get shell cwd via /proc ----
    } else if (data.type === 'sftp-pwd') {
      if (!sshClient) return;

      const execCmd = (cmd, cb) => {
        sshClient.exec(cmd, (err, ch) => {
          if (err) return cb(err, '');
          let out = '';
          ch.on('data', (d) => { out += d.toString(); });
          ch.stderr.on('data', () => {});
          ch.on('close', () => cb(null, out.trim()));
        });
      };

      if (shellPid) {
        // Fast path: cached shell PID
        execCmd('readlink /proc/' + shellPid + '/cwd 2>/dev/null || pwd', (err, path) => {
          if (err) { sendJSON(ws, { type: 'sftp-pwd-result', error: err.message }); return; }
          sendJSON(ws, { type: 'sftp-pwd-result', path: path || '/' });
        });
      } else {
        // Discover shell PID: scan /proc for sibling process that is a shell
        const discoverCmd = 'MP=$$; PP=$(awk \'/PPid/{print $2}\' /proc/$MP/status 2>/dev/null); '
          + 'if [ -n "$PP" ]; then '
          + 'for d in /proc/[0-9]*/; do '
          + 'P=${d#/proc/}; P=${P%/}; '
          + '[ "$P" = "$MP" ] && continue; '
          + '[ "$(awk \'/PPid/{print $2}\' ${d}status 2>/dev/null)" = "$PP" ] || continue; '
          + 'N=$(awk \'/Name/{print $2}\' ${d}status 2>/dev/null); '
          + 'case "$N" in bash|zsh|sh|dash|fish|ash|ksh|tcsh|csh) '
          + 'echo "NTPID:$P"; readlink ${d}cwd 2>/dev/null; exit 0;; esac; '
          + 'done; fi; pwd';
        execCmd(discoverCmd, (err, out) => {
          if (err) { sendJSON(ws, { type: 'sftp-pwd-result', error: err.message }); return; }
          const lines = out.split('\n');
          let path = lines[lines.length - 1] || '/';
          for (const line of lines) {
            const m = line.match(/^NTPID:(\d+)$/);
            if (m) { shellPid = m[1]; break; }
          }
          sendJSON(ws, { type: 'sftp-pwd-result', path });
        });
      }

    // ---- SFTP: List directory ----
    } else if (data.type === 'sftp-list') {
      if (!sftp) { sendJSON(ws, { type: 'sftp-list-result', reqId: data.reqId, error: 'SFTP not ready' }); return; }
      sftp.readdir(data.path || '/', (err, list) => {
        if (err) { sendJSON(ws, { type: 'sftp-list-result', reqId: data.reqId, error: err.message }); return; }
        const items = list.map(f => ({
          name: f.filename,
          size: f.attrs.size,
          mtime: f.attrs.mtime * 1000,
          isDir: (f.attrs.mode & 0o40000) !== 0,
          isLink: (f.attrs.mode & 0o120000) === 0o120000,
          mode: f.attrs.mode,
          uid: f.attrs.uid,
          gid: f.attrs.gid,
        }));
        sendJSON(ws, { type: 'sftp-list-result', reqId: data.reqId, path: data.path, items });
      });

    // ---- SFTP: Stat (for resolving symlinks etc) ----
    } else if (data.type === 'sftp-stat') {
      if (!sftp) return;
      sftp.stat(data.path, (err, stats) => {
        if (err) { sendJSON(ws, { type: 'sftp-stat-result', error: err.message }); return; }
        sendJSON(ws, { type: 'sftp-stat-result', path: data.path, isDir: (stats.mode & 0o40000) !== 0 });
      });

    // ---- SFTP: Download file ----
    } else if (data.type === 'sftp-download') {
      if (!sftp) { sendJSON(ws, { type: 'sftp-download-result', reqId: data.reqId, error: 'SFTP not ready' }); return; }
      sftp.stat(data.path, (err, stats) => {
        if (err) { sendJSON(ws, { type: 'sftp-download-result', reqId: data.reqId, error: err.message }); return; }
        if (stats.size > 100 * 1024 * 1024) {
          sendJSON(ws, { type: 'sftp-download-result', reqId: data.reqId, error: 'File too large (>100MB)' });
          return;
        }
        const chunks = [];
        const rs = sftp.createReadStream(data.path);
        rs.on('data', (chunk) => chunks.push(chunk));
        rs.on('end', () => {
          const buf = Buffer.concat(chunks);
          sendJSON(ws, { type: 'sftp-download-result', reqId: data.reqId, name: path.basename(data.path), data: buf.toString('base64'), size: buf.length });
        });
        rs.on('error', (e) => { sendJSON(ws, { type: 'sftp-download-result', reqId: data.reqId, error: e.message }); });
      });

    // ---- SFTP: Upload file ----
    } else if (data.type === 'sftp-upload') {
      if (!sftp) { sendJSON(ws, { type: 'sftp-upload-result', reqId: data.reqId, error: 'SFTP not ready' }); return; }
      const buf = Buffer.from(data.data, 'base64');
      const remotePath = data.path.replace(/\/$/, '') + '/' + data.name;
      const wstream = sftp.createWriteStream(remotePath);
      wstream.on('close', () => {
        sendJSON(ws, { type: 'sftp-upload-result', reqId: data.reqId, success: true });
      });
      wstream.on('error', (e) => {
        sendJSON(ws, { type: 'sftp-upload-result', reqId: data.reqId, error: e.message });
      });
      wstream.end(buf);

    // ---- SFTP: Delete file ----
    } else if (data.type === 'sftp-delete') {
      if (!sftp) return;
      const doDelete = data.isDir
        ? (cb) => { sshClient.exec('rm -rf ' + JSON.stringify(data.path), (err, ch) => { if (err) return cb(err); ch.on('close', () => cb(null)); ch.resume(); }); }
        : (cb) => sftp.unlink(data.path, cb);
      doDelete((err) => {
        if (err) sendJSON(ws, { type: 'sftp-delete-result', reqId: data.reqId, error: err.message });
        else sendJSON(ws, { type: 'sftp-delete-result', reqId: data.reqId, success: true });
      });

    // ---- SFTP: Create directory ----
    } else if (data.type === 'sftp-mkdir') {
      if (!sftp) return;
      sftp.mkdir(data.path, (err) => {
        if (err) sendJSON(ws, { type: 'sftp-mkdir-result', reqId: data.reqId, error: err.message });
        else sendJSON(ws, { type: 'sftp-mkdir-result', reqId: data.reqId, success: true });
      });

    // ---- SFTP: Read text file ----
    } else if (data.type === 'sftp-read') {
      if (!sftp) { sendJSON(ws, { type: 'sftp-read-result', reqId: data.reqId, error: 'SFTP not ready' }); return; }
      sftp.stat(data.path, (err, stats) => {
        if (err) { sendJSON(ws, { type: 'sftp-read-result', reqId: data.reqId, error: err.message }); return; }
        if (stats.size > 5 * 1024 * 1024) {
          sendJSON(ws, { type: 'sftp-read-result', reqId: data.reqId, error: 'File too large for editor (>5MB)' });
          return;
        }
        const chunks = [];
        const rs = sftp.createReadStream(data.path);
        rs.on('data', (chunk) => chunks.push(chunk));
        rs.on('end', () => {
          const buf = Buffer.concat(chunks);
          sendJSON(ws, { type: 'sftp-read-result', reqId: data.reqId, path: data.path, content: buf.toString('utf-8'), size: buf.length });
        });
        rs.on('error', (e) => { sendJSON(ws, { type: 'sftp-read-result', reqId: data.reqId, error: e.message }); });
      });

    // ---- SFTP: Write text file ----
    } else if (data.type === 'sftp-write') {
      if (!sftp) { sendJSON(ws, { type: 'sftp-write-result', reqId: data.reqId, error: 'SFTP not ready' }); return; }
      const buf = Buffer.from(data.content, 'utf-8');
      const wstream = sftp.createWriteStream(data.path);
      wstream.on('close', () => {
        sendJSON(ws, { type: 'sftp-write-result', reqId: data.reqId, success: true });
      });
      wstream.on('error', (e) => {
        sendJSON(ws, { type: 'sftp-write-result', reqId: data.reqId, error: e.message });
      });
      wstream.end(buf);

    // ---- SFTP: Rename ----
    } else if (data.type === 'sftp-rename') {
      if (!sftp) return;
      sftp.rename(data.oldPath, data.newPath, (err) => {
        if (err) sendJSON(ws, { type: 'sftp-rename-result', reqId: data.reqId, error: err.message });
        else sendJSON(ws, { type: 'sftp-rename-result', reqId: data.reqId, success: true });
      });

    // ---- Monitor: collect /proc stats via SSH exec ----
    } else if (data.type === 'monitor-stats') {
      if (!sshClient) { sendJSON(ws, { type: 'monitor-stats-result', error: 'not connected' }); return; }
      const cmd = "cat /proc/stat 2>/dev/null; echo '===MEMINFO==='; cat /proc/meminfo 2>/dev/null; echo '===NETDEV==='; cat /proc/net/dev 2>/dev/null; echo '===DISKSTATS==='; cat /proc/diskstats 2>/dev/null";
      sshClient.exec(cmd, (err, ch) => {
        if (err) { sendJSON(ws, { type: 'monitor-stats-result', error: err.message }); return; }
        let out = '';
        ch.on('data', (d) => { out += d.toString(); });
        ch.stderr.on('data', () => {});
        ch.on('close', () => { sendJSON(ws, { type: 'monitor-stats-result', raw: out }); });
      });
    }
  });

  ws.on('close', () => {
    if (stream) stream.close();
    if (sshClient) sshClient.end();
    sftp = null;
  });
});

const PORT = CFG.port;
server.listen(PORT, () => {
  console.log(`冥雾云Web控制台 running at http://localhost:${PORT}`);
  console.log(`[Config] admin=${CFG.admin.username}  db=${CFG.database}`);
});
