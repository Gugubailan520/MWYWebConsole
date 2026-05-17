// public/admin.js - 管理后台 SPA 逻辑
// ===== Auth Check =====
let token = null;
try {
  const s = JSON.parse(sessionStorage.getItem('nt_session'));
  // admin session 只在 login 后才拿到 token
  token = sessionStorage.getItem('admin_token');
} catch (_) {}

// Check if we have admin access
(function checkAuth() {
  token = sessionStorage.getItem('admin_token');
  if (!token) {
    // Try to extract from main session - login as admin
    const sess = JSON.parse(sessionStorage.getItem('nt_session') || 'null');
    if (sess && sess.username) {
      // We have a session but no admin token - need to verify via /api/me
      fetch('/api/me', {
        headers: { 'Authorization': 'Bearer ' + (sess.token || '') }
      }).then(r => r.json()).then(d => {
        if (d.success && d.user && d.user.isAdmin) {
          token = sess.token;
          sessionStorage.setItem('admin_token', token);
        } else {
          redirectToLogin();
        }
      }).catch(() => redirectToLogin());
    } else {
      redirectToLogin();
    }
  }
})();

function redirectToLogin() {
  // Store return URL and redirect to main page
  sessionStorage.setItem('admin_return', '/admin.html');
  location.href = '/';
}

// ===== API Helpers =====
async function apiGet(url) {
  const r = await fetch(url, { headers: { 'Authorization': 'Bearer ' + token } });
  if (r.status === 401 || r.status === 403) { redirectToLogin(); return null; }
  return r.json();
}
async function apiPut(url, body) {
  const r = await fetch(url, {
    method: 'PUT',
    headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (r.status === 401 || r.status === 403) { redirectToLogin(); return null; }
  return r.json();
}
async function apiPost(url, body) {
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (r.status === 401 || r.status === 403) { redirectToLogin(); return null; }
  return r.json();
}
async function apiDelete(url) {
  const r = await fetch(url, {
    method: 'DELETE',
    headers: { 'Authorization': 'Bearer ' + token },
  });
  if (r.status === 401 || r.status === 403) { redirectToLogin(); return null; }
  return r.json();
}
async function apiUpload(file, kind) {
  const fd = new FormData();
  fd.append('file', file);
  fd.append('kind', kind || 'asset');
  const r = await fetch('/api/admin/upload', {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + token },
    body: fd,
  });
  return r.json();
}

// ===== Toast =====
function toast(msg, type) {
  const c = document.getElementById('toastContainer');
  const t = document.createElement('div');
  t.className = 'toast' + (type ? ' ' + type : '');
  t.textContent = msg;
  c.appendChild(t);
  setTimeout(() => { t.style.opacity = '0'; setTimeout(() => t.remove(), 300); }, 3000);
}

// ===== Tab Switching =====
let currentTab = 'site';
function switchTab(tab, btn) {
  currentTab = tab;
  document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  document.querySelectorAll('.tab-content').forEach(el => el.style.display = 'none');
  const el = document.getElementById('tab-' + tab);
  if (el) {
    el.style.display = '';
    el.classList.remove('fade-in');
    void el.offsetWidth;
    el.classList.add('fade-in');
  }
  // Load data for the tab
  if (tab === 'site') loadSiteSettings();
  else if (tab === 'features') loadFeatures();
  else if (tab === 'proxy') loadProxy();
  else if (tab === 'users') loadUsers();
  else if (tab === 'logs') loadLogs();
}

// ===== Site Settings =====
async function loadSiteSettings() {
  const d = await apiGet('/api/admin/site');
  if (!d || !d.success) return;
  const s = d.settings;
  document.getElementById('siteName').value = s.site_name || '';
  document.getElementById('siteSubtitle').value = s.site_subtitle || '';
  document.getElementById('siteLogo').value = s.site_logo || '';
  document.getElementById('siteFavicon').value = s.site_favicon || '';
  document.getElementById('siteBg').value = s.site_background || '';
  document.getElementById('footerText').value = s.footer_text || '';
  const pc = s.primary_color || '#2563eb';
  document.getElementById('primaryColor').value = pc;
  document.getElementById('primaryColorText').value = pc;
  // previews
  setPreview('logoPreview', s.site_logo);
  setPreview('faviconPreview', s.site_favicon);
  setPreview('bgPreview', s.site_background);
}

function setPreview(id, url) {
  const img = document.getElementById(id);
  if (url && url !== '/imgs/logo.png' && url !== '/imgs/bj.png') {
    img.src = url;
    img.style.display = '';
  } else {
    img.style.display = 'none';
  }
}

async function saveSiteSettings() {
  const settings = {
    site_name: document.getElementById('siteName').value.trim(),
    site_subtitle: document.getElementById('siteSubtitle').value.trim(),
    site_logo: document.getElementById('siteLogo').value.trim(),
    site_favicon: document.getElementById('siteFavicon').value.trim(),
    site_background: document.getElementById('siteBg').value.trim(),
    primary_color: document.getElementById('primaryColorText').value.trim() || document.getElementById('primaryColor').value,
    footer_text: document.getElementById('footerText').value.trim(),
  };
  const d = await apiPut('/api/admin/site', settings);
  if (d && d.success) toast('站点设置已保存', 'success');
  else toast('保存失败: ' + (d && d.error), 'error');
}

function triggerUpload(kind) {
  const map = { logo: 'logoFile', favicon: 'faviconFile', bg: 'bgFile' };
  document.getElementById(map[kind]).click();
}

async function handleUpload(input, settingKey, previewId) {
  if (!input.files || !input.files[0]) return;
  const kind = settingKey.replace('site_', '');
  const d = await apiUpload(input.files[0], kind);
  if (d && d.success) {
    const url = d.url;
    // Set the URL input
    const inputMap = {
      site_logo: 'siteLogo',
      site_favicon: 'siteFavicon',
      site_background: 'siteBg'
    };
    document.getElementById(inputMap[settingKey]).value = url;
    setPreview(previewId, url);
    toast('上传成功', 'success');
  } else {
    toast('上传失败: ' + (d && d.error), 'error');
  }
  input.value = '';
}

// Sync color picker and text input
document.addEventListener('DOMContentLoaded', () => {
  const picker = document.getElementById('primaryColor');
  const text = document.getElementById('primaryColorText');
  if (picker && text) {
    picker.addEventListener('input', () => { text.value = picker.value; });
    text.addEventListener('input', () => {
      if (/^#[0-9a-fA-F]{6}$/.test(text.value)) picker.value = text.value;
    });
  }
});

// ===== Features =====
const FEATURE_MAP = {
  enable_ssh: 'toggleSSH',
  enable_sftp: 'toggleSFTP',
  enable_rdp: 'toggleRDP',
  enable_vnc: 'toggleVNC',
  enable_ftp: 'toggleFTP',
  enable_register: 'toggleRegister',
};
let currentFlags = {};

async function loadFeatures() {
  const d = await apiGet('/api/admin/features');
  if (!d || !d.success) return;
  currentFlags = d.flags;
  for (const [key, toggleId] of Object.entries(FEATURE_MAP)) {
    const el = document.getElementById(toggleId);
    if (el) el.classList.toggle('on', currentFlags[key] === '1');
  }
}

async function toggleFeature(key, el) {
  const newVal = !el.classList.contains('on');
  el.classList.toggle('on', newVal);
  const d = await apiPut('/api/admin/features', { [key]: newVal ? '1' : '0' });
  if (d && d.success) {
    toast('已' + (newVal ? '开启' : '关闭'), 'success');
  } else {
    el.classList.toggle('on', !newVal);
    toast('操作失败', 'error');
  }
}

// ===== Proxy =====
let proxyData = {};

async function loadProxy() {
  const d = await apiGet('/api/admin/proxy');
  if (!d || !d.success) return;
  proxyData = d.proxy;
  document.getElementById('toggleProxy').classList.toggle('on', !!proxyData.enabled);
  document.getElementById('proxyFields').style.display = proxyData.enabled ? '' : 'none';
  document.getElementById('proxyHost').value = proxyData.host || '';
  document.getElementById('proxyPort').value = proxyData.port || '';
  document.getElementById('proxyUser').value = proxyData.username || '';
  document.getElementById('proxyPass').value = proxyData.password || '';
  document.getElementById('proxyApplySSH').classList.toggle('on', !!proxyData.apply_ssh);
  document.getElementById('proxyApplyVNC').classList.toggle('on', !!proxyData.apply_vnc);
  document.getElementById('proxyApplyFTP').classList.toggle('on', !!proxyData.apply_ftp);
}

async function toggleProxyEnabled(el) {
  const newVal = !el.classList.contains('on');
  el.classList.toggle('on', newVal);
  document.getElementById('proxyFields').style.display = newVal ? '' : 'none';
  // Save immediately
  const cfg = gatherProxyConfig();
  cfg.enabled = newVal;
  const d = await apiPut('/api/admin/proxy', cfg);
  if (d && d.success) {
    proxyData = d.proxy;
    toast(newVal ? '代理已启用' : '代理已关闭', 'success');
  } else {
    el.classList.toggle('on', !newVal);
    document.getElementById('proxyFields').style.display = !newVal ? '' : 'none';
    toast('操作失败', 'error');
  }
}

function toggleProxyApply(key, el) {
  el.classList.toggle('on');
}

function gatherProxyConfig() {
  return {
    enabled: document.getElementById('toggleProxy').classList.contains('on'),
    host: document.getElementById('proxyHost').value.trim(),
    port: parseInt(document.getElementById('proxyPort').value) || 0,
    username: document.getElementById('proxyUser').value.trim(),
    password: document.getElementById('proxyPass').value,
    apply_ssh: document.getElementById('proxyApplySSH').classList.contains('on'),
    apply_rdp: false,
    apply_vnc: document.getElementById('proxyApplyVNC').classList.contains('on'),
    apply_ftp: document.getElementById('proxyApplyFTP').classList.contains('on'),
  };
}

async function saveProxy() {
  const d = await apiPut('/api/admin/proxy', gatherProxyConfig());
  if (d && d.success) toast('代理设置已保存', 'success');
  else toast('保存失败: ' + (d && d.error), 'error');
}

// ===== Users =====
async function loadUsers() {
  const d = await apiGet('/api/admin/users');
  if (!d || !d.success) return;
  const users = d.users || [];
  document.getElementById('userCount').textContent = users.length + ' 个用户';
  const tbody = document.getElementById('usersTableBody');
  if (users.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5"><div class="empty-state">暂无用户</div></td></tr>';
    return;
  }
  tbody.innerHTML = users.map(u => {
    const statusBadge = u.disabled
      ? '<span class="badge badge-danger">已禁用</span>'
      : '<span class="badge badge-success">正常</span>';
    const dateStr = u.created_at ? new Date(u.created_at).toLocaleString('zh-CN') : '-';
    return `<tr>
      <td>${u.id}</td>
      <td>${esc(u.username)}</td>
      <td>${statusBadge}</td>
      <td style="font-size:12px;color:var(--text-secondary)">${dateStr}</td>
      <td style="text-align:right">
        <button class="btn btn-ghost btn-sm" onclick="resetUserPassword(${u.id},'${esc(u.username)}')" title="重置密码">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
        </button>
        <button class="btn btn-ghost btn-sm" onclick="toggleUserDisabled(${u.id}, ${u.disabled ? 0 : 1})" title="${u.disabled ? '启用' : '禁用'}">
          ${u.disabled
            ? '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>'
            : '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>'
          }
        </button>
        <button class="btn btn-danger btn-sm" onclick="deleteUser(${u.id},'${esc(u.username)}')" title="删除">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
        </button>
      </td>
    </tr>`;
  }).join('');
}

function showAddUserForm() { document.getElementById('addUserForm').style.display = ''; }
function hideAddUserForm() {
  document.getElementById('addUserForm').style.display = 'none';
  document.getElementById('newUsername').value = '';
  document.getElementById('newPassword').value = '';
}

async function addUser() {
  const username = document.getElementById('newUsername').value.trim();
  const password = document.getElementById('newPassword').value;
  if (!username || !password) { toast('用户名和密码不能为空', 'error'); return; }
  const d = await apiPost('/api/admin/users', { username, password });
  if (d && d.success) {
    toast('用户已创建', 'success');
    hideAddUserForm();
    loadUsers();
  } else {
    toast(d && d.error ? d.error : '创建失败', 'error');
  }
}

async function resetUserPassword(id, username) {
  const pwd = prompt('请输入 "' + username + '" 的新密码（至少 4 位）：');
  if (!pwd) return;
  if (pwd.length < 4) { toast('密码至少 4 位', 'error'); return; }
  const d = await apiPut('/api/admin/users/' + id + '/password', { password: pwd });
  if (d && d.success) toast('密码已重置', 'success');
  else toast('重置失败', 'error');
}

async function toggleUserDisabled(id, disabled) {
  const d = await apiPut('/api/admin/users/' + id + '/disabled', { disabled });
  if (d && d.success) {
    toast(disabled ? '已禁用' : '已启用', 'success');
    loadUsers();
  } else {
    toast('操作失败', 'error');
  }
}

async function deleteUser(id, username) {
  if (!confirm('确定删除用户 "' + username + '"？此操作不可恢复。')) return;
  const d = await apiDelete('/api/admin/users/' + id);
  if (d && d.success) {
    toast('用户已删除', 'success');
    loadUsers();
  } else {
    toast('删除失败', 'error');
  }
}

// ===== Logs =====
let logsData = [];
let logsOffset = 0;

async function loadLogs() {
  const type = document.getElementById('logTypeFilter').value;
  const limit = parseInt(document.getElementById('logLimit').value) || 50;
  logsOffset = 0;
  const params = new URLSearchParams({ limit: String(limit), offset: '0' });
  if (type) params.set('type', type);
  const d = await apiGet('/api/admin/logs?' + params.toString());
  if (!d || !d.success) return;
  logsData = d.logs || [];
  renderLogs(logsData, limit);
}

function renderLogs(logs, limit) {
  const tbody = document.getElementById('logsTableBody');
  if (logs.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7"><div class="empty-state">暂无日志记录</div></td></tr>';
    document.getElementById('logsPagination').innerHTML = '';
    return;
  }
  tbody.innerHTML = logs.map(l => {
    const t = l.started_at ? new Date(l.started_at).toLocaleString('zh-CN') : '-';
    const target = l.target_host ? esc(l.target_host) + ':' + (l.target_port || '') : '-';
    const dur = l.duration_ms != null ? formatDuration(l.duration_ms) : '-';
    const resultBadge = formatResult(l.result);
    return `<tr>
      <td style="font-size:12px;white-space:nowrap">${t}</td>
      <td><span class="badge badge-warning">${esc(l.type || '')}</span></td>
      <td style="font-size:12px">${esc(l.username || '-')}</td>
      <td style="font-size:12px"><code>${target}</code></td>
      <td style="font-size:12px">${dur}</td>
      <td>${resultBadge}</td>
      <td style="font-size:12px;color:var(--text-tertiary)">${esc(l.client_ip || '-')}</td>
    </tr>`;
  }).join('');
}

function formatDuration(ms) {
  if (ms < 1000) return ms + 'ms';
  if (ms < 60000) return (ms / 1000).toFixed(1) + 's';
  if (ms < 3600000) return Math.floor(ms / 60000) + 'm ' + Math.floor((ms % 60000) / 1000) + 's';
  return Math.floor(ms / 3600000) + 'h ' + Math.floor((ms % 3600000) / 60000) + 'm';
}

function formatResult(r) {
  if (!r) return '-';
  const map = {
    connected: 'badge-success',
    'token-issued': 'badge-success',
    closed: 'badge-warning',
    pending: 'badge-warning',
    error: 'badge-danger',
  };
  const cls = map[r] || 'badge-warning';
  return `<span class="badge ${cls}">${esc(r)}</span>`;
}

function exportLogsCSV() {
  if (logsData.length === 0) { toast('暂无数据可导出', 'error'); return; }
  const header = '时间,类型,用户,目标地址,目标端口,目标用户,耗时ms,结果,错误信息,客户端IP';
  const rows = logsData.map(l => [
    l.started_at ? new Date(l.started_at).toISOString() : '',
    l.type || '',
    l.username || '',
    l.target_host || '',
    l.target_port || '',
    l.target_user || '',
    l.duration_ms || '',
    l.result || '',
    (l.error_message || '').replace(/"/g, '""'),
    l.client_ip || '',
  ].map(v => '"' + v + '"').join(','));
  const csv = '\uFEFF' + header + '\n' + rows.join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = 'connection_logs_' + new Date().toISOString().slice(0, 10) + '.csv';
  a.click(); URL.revokeObjectURL(url);
  toast('已导出 ' + logsData.length + ' 条记录', 'success');
}

// ===== Helpers =====
function esc(str) {
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}

// ===== Admin Token Bridge =====
// When user logs in via main page, store token for admin page use
(function bridgeToken() {
  const sess = JSON.parse(sessionStorage.getItem('nt_session') || 'null');
  if (sess && sess.token) {
    // Verify if admin
    fetch('/api/me', {
      headers: { 'Authorization': 'Bearer ' + sess.token }
    }).then(r => r.json()).then(d => {
      if (d.success && d.user && d.user.isAdmin) {
        sessionStorage.setItem('admin_token', sess.token);
        token = sess.token;
        // Now init the page
        initPage();
      } else if (!token) {
        redirectToLogin();
      }
    }).catch(() => {
      if (!token) redirectToLogin();
    });
  } else if (token) {
    initPage();
  }
})();

function initPage() {
  switchTab('site', document.querySelector('.nav-item[data-tab="site"]'));
}
