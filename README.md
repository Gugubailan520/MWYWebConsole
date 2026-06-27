# 冥雾云WebConsole

![简介图](https://raw.githubusercontent.com/Gugubailan520/MWYWebConsole/refs/heads/main/imgs/1.png)

基于 Node.js 的 Web 远程连接管理平台，支持 SSH 终端、SFTP/FTP 文件管理、VNC/RDP 远程桌面，所有操作均在浏览器中完成。内置管理后台，支持站点定制、用户管理、功能开关和 SOCKS5 出站代理。


## 功能特点

### 多协议支持
- **SSH 终端** — 基于 xterm.js 的全功能 Web 终端，支持密码和密钥认证，同时支持目录跟随自动 SFTP
- **SFTP 文件管理** — 在线浏览、上传、下载、编辑远程文件，支持拖拽上传
- **VNC 远程桌面** — 基于 noVNC 的浏览器内 VNC 客户端
- **RDP 远程桌面** — 基于 Apache Guacamole (guacamole-lite + guacd) 的浏览器内 Windows 远程桌面，支持 NLA 网络级别身份验证
- **FTP 文件传输** — 支持 FTP / FTPS (Explicit TLS / Implicit TLS) 的文件浏览和传输

### 管理后台
- **站点定制** — 自定义站点名称、副标题、Logo、Favicon、背景图、主题色
- **功能开关** — 按需开关 SSH / SFTP / RDP / VNC / FTP / 用户注册
- **用户管理** — 创建、禁用、重置密码、删除普通用户
- **连接日志** — 记录所有连接元数据，支持按类型筛选和 CSV 导出
- **SOCKS5 代理** — 配置全局出站代理，按协议选择应用范围（SSH/SFTP/VNC/FTP）

### 服务器管理
- **卡片式管理界面** — 可视化管理所有服务器连接
- **快速连接** — 顶部快捷栏支持 `user@host:port` 格式快速连接
- **全局搜索** — 按名称、IP、用户名搜索服务器
- **分页浏览** — 服务器列表自动分页

### 云同步
- **端到端加密** — 使用 AES-GCM 在客户端加密，服务器无法查看连接信息
- **用户注册/登录** — 内置 JWT 账号系统
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
cd MWYwebConsole

# 安装依赖
pnpm install

# 复制配置文件
cp config.example.yml config.yml
# 编辑 config.yml，修改管理员密码和加密密钥

# 启动服务
pnpm start
```

服务默认运行在 `http://localhost:25555`。首次启动自动创建 SQLite 数据库和默认配置。

### Docker 部署（推荐）

项目自带 `Dockerfile` 与 `docker-compose.yml`，开箱即用。镜像基于 `node:18-bookworm-slim`，多阶段构建以编译原生模块（`better-sqlite3`），并通过 `tini` 作为 1 号进程。

#### 方式一：docker compose（含 RDP 支持）

```bash
# 修改 docker-compose.yml 中的 JWT_SECRET / GUAC_CRYPT_KEY 后执行
docker compose up -d
```

编排包含两个服务：
- `mwy-web-console` — 本应用，暴露 `25555` 端口
- `guacd` — Apache Guacamole 守护进程（RDP 必需；不需要 RDP 可在 compose 文件中注释掉，并移除 `GUACD_HOST` 环境变量与 `depends_on`）

#### 方式二：直接构建镜像

```bash
docker build -t mwy-web-console:latest .

docker run -d --name mwy -p 25555:25555 \
  -v "$PWD/data:/app/data" \
  -e JWT_SECRET=$(openssl rand -hex 24) \
  -e GUAC_CRYPT_KEY="$(openssl rand -base64 24 | head -c 32)" \
  mwy-web-console:latest
```

如需 RDP，需另起 guacd 容器，并通过 `GUACD_HOST` 指向它：

```bash
docker run -d --name guacd --restart unless-stopped guacamole/guacd:1.5.5
docker network create mwy-net 2>/dev/null; docker network connect mwy-net guacd
docker network connect mwy-net mwy  # 然后将 GUACD_HOST 设为 guacd
```

#### 配置覆盖

镜像优先级：`config.yml` > 环境变量 > `config.example.yml`（内置兜底）。任选其一：

- **环境变量**（推荐用于密钥）：`PORT`、`JWT_SECRET`、`GUACD_HOST`、`GUACD_PORT`、`GUAC_WS_PORT`、`GUAC_CRYPT_KEY`、`DATABASE`
- **挂载配置文件**：`-v "$PWD/config.yml:/app/config.yml:ro"`

#### 数据持久化

`/app/data` 已声明为 VOLUME（SQLite 数据库 + 上传文件）。生产部署务必挂载宿主目录：

```yaml
volumes:
  - ./data:/app/data
```

> 默认管理员为 `admin / changeme`，请务必通过挂载 `config.yml` 修改。

### 配置文件 (config.yml)

编辑 `config.yml`（参考 `config.example.yml`）：

```yaml
port: 25555

admin:
  username: admin
  password: changeme      # 首次部署请修改！

jwt_secret: ""            # 留空则重启后 token 失效
jwt_expires_in: 604800    # token 有效期（秒），默认 7 天

guacd:
  host: 127.0.0.1
  port: 4822
guac_ws_port: 4823
guac_crypt_key: "MWYwebConsole-GuacLite!!-Secret!!"  # 生产环境请修改！

database: ./data/console.db
uploads_dir: ./data/uploads
log_retention_days: 90
```

> **注意**：`config.yml` 中的配置为启动期不可变量（端口、管理员、密钥等），修改后需重启。运行期可变设置（站点样式、功能开关、用户数据）在管理后台修改，无需重启。

### 管理后台

使用 `config.yml` 中配置的 admin 账号登录后，顶栏右侧出现「管理」按钮，点击进入管理后台。也可直接访问 `/admin.html`。

管理后台包含：
- **基本设置** — 站点名称、副标题、Logo、Favicon、背景图、主题色
- **功能开关** — SSH / SFTP / RDP / VNC / FTP / 注册
- **代理设置** — SOCKS5 全局出站代理
- **用户管理** — 创建/禁用/重置密码/删除用户
- **连接日志** — 查看/筛选/导出连接记录

### guacd 安装（RDP 功能必须）

RDP 连接依赖 Apache Guacamole 的代理守护进程 `guacd`：

```bash
# Docker（推荐）
docker run -d --name guacd --restart unless-stopped -p 4822:4822 guacamole/guacd

# Debian/Ubuntu
apt install guacd && systemctl enable --now guacd
```

### 反向代理 (Nginx)

```nginx
server {
    listen 80;
    server_name your-domain.com;

    location / {
        proxy_pass http://127.0.0.1:25555;
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

`embed.html` 是中间件页面，通过 URL 查询参数接收连接信息，自动路由到对应功能页面。适合嵌入第三方系统的 iframe。

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
  src="https://your-domain.com/embed.html?type=ssh&host=10.0.0.1&user=root&pass=xxx"
  width="100%"
  height="600"
  style="border: none;"
  allow="clipboard-read; clipboard-write"
  allowfullscreen>
</iframe>
```

> **安全提示**：URL 中包含明文密码，建议仅在内网或受信环境中使用，或通过后端动态生成带有临时凭据的嵌入链接。

