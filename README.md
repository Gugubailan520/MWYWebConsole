# 冥雾云WebConsole

基于 Node.js 的 Web 远程连接管理器，支持 SSH 终端、SFTP 文件管理、VNC/RDP 远程桌面和 FTP 文件传输，所有操作均在浏览器中完成。


## 功能特点

### 多协议支持
- **SSH 终端** — 基于 xterm.js 的全功能 Web 终端，支持密码和密钥认证，同时支持目录跟随自动SFTP。
- **SFTP 文件管理** — 在线浏览、上传、下载、编辑远程文件，支持拖拽上传
- **VNC 远程桌面** — 基于 noVNC 的浏览器内 VNC 客户端
- **RDP 远程桌面** — 基于 Apache Guacamole (guacamole-lite + guacd) 的浏览器内 Windows 远程桌面，支持 NLA 网络级别身份验证
- **FTP 文件传输** — 支持 FTP / FTPS (Explicit TLS / Implicit TLS) 的文件浏览和传输

### 服务器管理
- **卡片式管理界面** — 可视化管理所有服务器连接
- **快速连接** — 顶部快捷栏支持 `user@host:port` 格式快速连接
- **全局搜索** — 按名称、IP、用户名搜索服务器
- **分页浏览** — 服务器列表自动分页

### 云同步
- **端到端加密** — 使用 AES-GCM 在客户端加密，服务器无法查看连接信息
- **用户注册/登录** — 内置账号系统
- **同步管理面板** — 可视化对比本地/云端数据，支持分页和去重过滤
- **单项操作** — 支持逐条上传、下载、删除云端数据

### 其他
- **暗色/亮色主题** — 支持一键切换，偏好自动保存到本地
- **响应式布局** — 适配桌面和移动设备
- **中文界面** — 全中文本地化
- **iframe 嵌入** — 提供 `embed.html` 中间页，可通过 URL 参数直接嵌入到第三方系统

## 部署

### 环境要求

- **Node.js** >= 18
- **pnpm**（推荐）或 npm
- **guacd**（使用 RDP 功能时必须，见下方说明）

### 安装步骤

```bash
# 克隆项目
git clone <repo-url>
cd 冥雾云WebConsole

# 安装依赖
pnpm install

# 复制环境变量配置
cp .env.example .env

# 启动服务
pnpm start
```

服务默认运行在 `http://localhost:3000`。

### 环境变量

编辑 `.env` 文件（参考 `.env.example`）：

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `PORT` | 主服务监听端口 | `3000` |
| `GUAC_CRYPT_KEY` | RDP Token 加密密钥（32 字符，生产环境请修改） | 内置默认值 |
| `GUAC_WS_PORT` | guacamole-lite 内部端口（仅监听 127.0.0.1） | `4823` |
| `GUACD_HOST` | guacd 守护进程地址 | `127.0.0.1` |
| `GUACD_PORT` | guacd 守护进程端口 | `4822` |

### guacd 安装（RDP 功能必须）

RDP 连接依赖 Apache Guacamole 的代理守护进程 `guacd`，有以下几种安装方式：

```bash
# 方式一：Docker 独立运行（推荐，无需改动主应用）
docker run -d --name guacd --restart unless-stopped -p 4822:4822 guacamole/guacd

# 方式二：Debian/Ubuntu 系统包
apt install guacd && systemctl enable --now guacd

# 方式三：Docker Compose 同栈部署（见下方 Compose 示例）
```

### 反向代理 (Nginx)

冥雾云WebConsole 使用 WebSocket，Nginx 配置需要包含：

```nginx
server {
    listen 80;
    server_name your-domain.com;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_read_timeout 86400;
    }
}
```


## iframe 嵌入 (embed.html)

`embed.html` 是一个中间件页面，通过 URL 查询参数接收连接信息，自动路由到对应的功能页面（SSH、SFTP、VNC、RDP、FTP）。适合将 冥雾云WebConsole 嵌入到其他系统的 iframe 中使用。

### 基本格式

```
/embed.html?type=<类型>&host=<地址>&port=<端口>&user=<用户名>&pass=<密码>
```

### 参数说明

| 参数 | 说明 | 必填 |
|------|------|------|
| `type` | 连接类型：`ssh` / `sftp` / `vnc` / `rdp` / `ftp` | 是 |
| `host` | 服务器地址 | 是 |
| `port` | 端口号（各协议有默认值） | 否 |
| `user` | 用户名 | 否 |
| `pass` | 密码 | 否 |
| `key` | SSH 私钥内容（SSH/SFTP） | 否 |
| `secure` | FTP 加密模式：`false` / `true` / `implicit` | 否 |

### 各类型示例

```bash
# SSH 终端
/embed.html?type=ssh&host=192.168.1.1&port=22&user=root&pass=123456

# SFTP 文件管理
/embed.html?type=sftp&host=192.168.1.1&user=root&pass=123456

# VNC 远程桌面
/embed.html?type=vnc&host=192.168.1.1&port=5900&pass=vncpass

# RDP 远程桌面
/embed.html?type=rdp&host=192.168.1.1&port=3389&user=Administrator&pass=123456

# FTP 文件传输（FTPS）
/embed.html?type=ftp&host=192.168.1.1&port=21&user=ftpuser&pass=123456&secure=true
```

### 在 iframe 中使用

```html
<iframe
  src="https://your-冥雾云WebConsole.com/embed.html?type=ssh&host=10.0.0.1&user=root&pass=xxx"
  width="100%"
  height="600"
  style="border: none;"
  allow="clipboard-read; clipboard-write"
  allowfullscreen>
</iframe>
```

> **安全提示**：URL 中包含明文密码，建议仅在内网或受信环境中使用，或通过后端动态生成带有临时凭据的嵌入链接。

