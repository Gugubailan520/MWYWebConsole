// lib/features.js - \u534f\u8bae\u5f00\u5173\u4e0e\u6ce8\u518c\u5f00\u5173\u4e2d\u95f4\u4ef6
// \u8be6\u7ec6\u5b9e\u73b0\u5728 Task 5 \u5b8c\u6210\uff1b\u672c\u6587\u4ef6\u4ec5\u63d0\u4f9b\u8f7b\u91cf\u8f85\u52a9\u51fd\u6570\u3002
const db = require('./db');

const TYPE_TO_FLAG = {
  ssh: 'enable_ssh',
  sftp: 'enable_sftp',
  rdp: 'enable_rdp',
  vnc: 'enable_vnc',
  ftp: 'enable_ftp',
};

function isProtocolEnabled(type) {
  const key = TYPE_TO_FLAG[type];
  if (!key) return true;
  return db.isFeatureEnabled(key);
}

function isRegisterEnabled() {
  return db.isFeatureEnabled('enable_register');
}

// Express \u4e2d\u95f4\u4ef6\uff1a\u67d0\u4e2a\u534f\u8bae\u672a\u5f00\u542f\u5219 403
function requireProtocol(type) {
  return (req, res, next) => {
    if (!isProtocolEnabled(type)) {
      return res.status(403).json({ error: `\u7ba1\u7406\u5458\u5df2\u7981\u7528 ${type.toUpperCase()} \u529f\u80fd` });
    }
    next();
  };
}

module.exports = {
  isProtocolEnabled,
  isRegisterEnabled,
  requireProtocol,
};
