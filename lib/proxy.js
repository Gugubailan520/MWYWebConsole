// lib/proxy.js - SOCKS5 \u51fa\u7ad9\u4ee3\u7406\u8f85\u52a9
// \u8be6\u7ec6\u5b9e\u73b0\u5728 Task 4 \u5b8c\u6210\uff1b\u672c\u6587\u4ef6\u63d0\u4f9b\u83b7\u53d6\u4ee3\u7406\u914d\u7f6e\u4e0e dial \u8f85\u52a9\u3002
const net = require('net');
const { SocksClient } = require('socks');
const db = require('./db');

const APPLY_KEY = {
  ssh: 'apply_ssh',
  sftp: 'apply_ssh',
  rdp: 'apply_rdp',
  vnc: 'apply_vnc',
  ftp: 'apply_ftp',
};

// \u83b7\u53d6\u67d0\u4e2a\u534f\u8bae\u751f\u6548\u7684\u4ee3\u7406\u914d\u7f6e\uff0c\u672a\u542f\u7528\u8fd4\u56de null
function getActiveProxyFor(type) {
  let p;
  try { p = db.getProxyConfig(); } catch (_) { return null; }
  if (!p || !p.enabled || !p.host || !p.port) return null;
  const key = APPLY_KEY[type];
  if (key && !p[key]) return null;
  return {
    host: p.host,
    port: parseInt(p.port),
    username: p.username || undefined,
    password: p.password || undefined,
  };
}

// \u8fd4\u56de\u4e00\u4e2a Promise<net.Socket>\uff08\u53ef\u80fd\u662f\u76f4\u8fde\u6216\u7ecf\u8fc7 SOCKS5\uff09
async function dial(type, host, port) {
  const proxy = getActiveProxyFor(type);
  if (!proxy) {
    return new Promise((resolve, reject) => {
      const sock = net.createConnection({ host, port }, () => resolve(sock));
      sock.once('error', reject);
    });
  }
  const result = await SocksClient.createConnection({
    proxy: { host: proxy.host, port: proxy.port, type: 5, userId: proxy.username, password: proxy.password },
    command: 'connect',
    destination: { host, port },
  });
  return result.socket;
}

module.exports = { getActiveProxyFor, dial };
