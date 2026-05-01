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

// ==================== Guacamole Config ====================
const GUAC_CRYPT_KEY = (process.env.GUAC_CRYPT_KEY || 'MWYwebConsole-GuacLite!!-Secret!!').slice(0, 32).padEnd(32, '0');
const GUAC_WS_PORT   = parseInt(process.env.GUAC_WS_PORT  || '4823');
const GUACD_HOST     = process.env.GUACD_HOST || '127.0.0.1';
const GUACD_PORT     = parseInt(process.env.GUACD_PORT    || '4822');
const guacCrypt = new Crypt('AES-256-CBC', GUAC_CRYPT_KEY);

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ noServer: true, maxPayload: 50 * 1024 * 1024 });
const vncWss = new WebSocket.Server({ noServer: true });

// Route WebSocket upgrades
server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/vnc-proxy') {
    vncWss.handleUpgrade(req, socket, head, (ws) => vncWss.emit('connection', ws, req));
  } else if (url.pathname === '/guac') {
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

  const tcp = net.createConnection({ host, port }, () => {
    // Connection established, noVNC RFB will start VNC handshake
  });

  tcp.on('data', (buf) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(buf);
    }
  });

  tcp.on('error', (err) => {
    try { ws.close(1011, err.message); } catch {}
  });

  tcp.on('close', () => {
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
});

app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true, limit: '5mb' }));
app.use(express.static(path.join(__dirname, 'public')));

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
app.post('/api/rdp-token', (req, res) => {
  const { host, port, username, password, domain, width, height } = req.body;
  if (!host) return res.json({ error: '缺少主机地址' });
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
    res.json({ error: '令牌生成失败: ' + e.message });
  }
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
  await client.access({
    host: opts.host,
    port: parseInt(opts.port) || 21,
    user: opts.username || 'anonymous',
    password: opts.password || '',
    secure,
    secureOptions: { rejectUnauthorized: false }
  });
  return client;
}

// List directory
app.post('/ftp/list', async (req, res) => {
  let client;
  try {
    client = await createFtpClient(req.body);
    const list = await client.list(req.body.path || '/');
    res.json({ ok: true, data: list.map(f => ({
      name: f.name, size: f.size, type: f.type === 2 ? 'd' : 'f',
      date: f.rawModifiedAt || f.modifiedAt?.toISOString() || '',
      permissions: f.permissions || {}
    }))});
  } catch (e) {
    res.json({ ok: false, error: e.message });
  } finally {
    if (client) client.close();
  }
});

// Download file
app.post('/ftp/download', async (req, res) => {
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
app.post('/ftp/upload', async (req, res) => {
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
app.post('/ftp/delete', async (req, res) => {
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
app.post('/ftp/rmdir', async (req, res) => {
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
app.post('/ftp/mkdir', async (req, res) => {
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
app.post('/ftp/rename', async (req, res) => {
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

const USERS_DIR = path.resolve('./users');
try {
  if (!fs.existsSync(USERS_DIR)) {
    fs.mkdirSync(USERS_DIR, { recursive: true });
  }
} catch (err) {}

function userFile(username) {
  const safe = username.replace(/[^a-zA-Z0-9_\-]/g, '');
  if (!safe) return null;
  return path.join(USERS_DIR, safe + '.json');
}

function hashPassword(password, salt) {
  salt = salt || crypto.randomBytes(32).toString('hex');
  const hash = crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha512').toString('hex');
  return { salt, hash };
}

function authUser(username, password) {
  const fp = userFile(username);
  if (!fp || !fs.existsSync(fp)) return null;
  let ud;
  try { ud = JSON.parse(fs.readFileSync(fp, 'utf-8')); } catch { return null; }
  // OIDC users are no longer supported
  const { hash } = hashPassword(password, ud.salt);
  if (hash !== ud.hash) return null;
  return { fp, ud };
}

// Register
app.post('/api/register', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.json({ error: '用户名和密码不能为空' });
  if (username.length < 2 || username.length > 32) return res.json({ error: '用户名长度 2-32 位' });
  if (password.length < 4) return res.json({ error: '密码至少 4 位' });
  if (!/^[a-zA-Z0-9_\-]+$/.test(username)) return res.json({ error: '用户名只能包含字母、数字、下划线和横线' });

  const fp = userFile(username);
  if (!fp) return res.json({ error: '无效用户名' });
  if (fs.existsSync(fp)) return res.json({ error: '用户名已存在' });

  const { salt, hash } = hashPassword(password);
  const userData = { username, salt, hash, servers: [], updatedAt: new Date().toISOString() };
  fs.writeFileSync(fp, JSON.stringify(userData, null, 2));
  res.json({ success: true });
});

// Login — returns cloud server list (id + name only, no encrypted data)
app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.json({ error: '用户名和密码不能为空' });
  const auth = authUser(username, password);
  if (!auth) return res.json({ error: '用户名或密码错误' });
  const list = (auth.ud.servers || []).map(s => ({ id: s.id, name: s.name }));
  res.json({ success: true, servers: list });
});

// Upload servers (replace all cloud data)
app.post('/api/sync/upload', (req, res) => {
  const { username, password, servers } = req.body;
  const auth = authUser(username, password);
  if (!auth) return res.json({ error: '认证失败' });
  if (!Array.isArray(servers)) return res.json({ error: '数据格式错误' });
  auth.ud.servers = servers;
  auth.ud.updatedAt = new Date().toISOString();
  fs.writeFileSync(auth.fp, JSON.stringify(auth.ud, null, 2));
  res.json({ success: true });
});

// Download all servers (with encrypted data for client to decrypt)
app.post('/api/sync/download', (req, res) => {
  const { username, password } = req.body;
  const auth = authUser(username, password);
  if (!auth) return res.json({ error: '认证失败' });
  res.json({ success: true, servers: auth.ud.servers || [], updatedAt: auth.ud.updatedAt });
});

// List cloud servers (metadata without encrypted data)
app.post('/api/sync/list', (req, res) => {
  const { username, password } = req.body;
  const auth = authUser(username, password);
  if (!auth) return res.json({ error: '认证失败' });
  const list = (auth.ud.servers || []).map(s => ({ id: s.id, name: s.name, host: s.host, port: s.port, user: s.user }));
  res.json({ success: true, servers: list });
});



function sendJSON(ws, obj) {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj));
}

// ==================== WebSocket SSH + SFTP ====================

wss.on('connection', (ws) => {
  let sshClient = null;
  let stream = null;
  let sftp = null;
  let shellPid = null;

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
      sshClient = new Client();
      const connOpts = {
        host: data.host,
        port: data.port || 22,
        username: data.username,
        readyTimeout: 10000,
      };
      if (data.privateKey) connOpts.privateKey = data.privateKey;
      else if (data.password) connOpts.password = data.password;

      sshClient.on('ready', () => {
        sendJSON(ws, { type: 'status', message: 'connected' });
        sshClient.sftp((err, s) => {
          if (err) { sendJSON(ws, { type: 'error', message: 'SFTP init failed: ' + err.message }); return; }
          sftp = s;
          sendJSON(ws, { type: 'sftp-ready' });
        });
      });
      sshClient.on('error', (err) => sendJSON(ws, { type: 'error', message: err.message }));
      sshClient.on('close', () => sendJSON(ws, { type: 'status', message: 'disconnected' }));
      sshClient.connect(connOpts);

    // ---- SSH Shell ----
    } else if (data.type === 'connect') {
      sshClient = new Client();
      const connOpts = {
        host: data.host,
        port: data.port || 22,
        username: data.username,
        readyTimeout: 10000,
      };
      if (data.privateKey) connOpts.privateKey = data.privateKey;
      else if (data.password) connOpts.password = data.password;

      sshClient.on('ready', () => {
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

      sshClient.on('error', (err) => sendJSON(ws, { type: 'error', message: err.message }));
      sshClient.on('close', () => sendJSON(ws, { type: 'status', message: 'disconnected' }));
      sshClient.connect(connOpts);

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

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`冥雾云Web控制台 running at http://localhost:${PORT}`);
});
