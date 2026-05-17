# 配置参考

所有启动期配置通过项目根目录的 `config.yml` 文件设置。参考 `config.example.yml` 创建。

运行期可变设置（站点样式、功能开关、用户、代理）在管理后台修改，无需重启。详见 [管理后台](Admin-Panel)。

---

## config.yml 配置项

### 服务器基础

| 配置项 | 默认值 | 说明 |
|--------|--------|------|
| `port` | `25555` | HTTP 服务监听端口 |

### 管理员账户

| 配置项 | 默认值 | 说明 |
|--------|--------|------|
| `admin.username` | `admin` | 管理员用户名（仅用于登录管理后台） |
| `admin.password` | `changeme` | 管理员密码，**首次部署务必修改** |

> 管理员账户仅存于 `config.yml`，不入数据库，无法在管理后台修改。

### JWT 鉴权

| 配置项 | 默认值 | 说明 |
|--------|--------|------|
| `jwt_secret` | `""` | JWT 签名密钥，留空则启动时随机生成（重启后所有已发 token 失效） |
| `jwt_expires_in` | `604800` | Token 有效期（秒），默认 7 天 |

### Guacamole / RDP

| 配置项 | 默认值 | 说明 |
|--------|--------|------|
| `guacd.host` | `127.0.0.1` | guacd 守护进程主机地址 |
| `guacd.port` | `4822` | guacd 守护进程端口 |
| `guac_ws_port` | `4823` | guacamole-lite 内部 WebSocket 端口，仅绑定 `127.0.0.1` |
| `guac_crypt_key` | `MWYwebConsole-...` | AES-256-CBC Token 加密密钥，**必须恰好 32 字符**，生产环境务必修改 |

### 数据库与存储

| 配置项 | 默认值 | 说明 |
|--------|--------|------|
| `database` | `./data/console.db` | SQLite 数据库文件路径（相对路径基于工作目录） |
| `uploads_dir` | `./data/uploads` | 管理后台上传资源（Logo/背景等）的保存目录 |
| `log_retention_days` | `90` | 连接日志保留天数，`0` 表示永久保留 |

---

## 完整示例

```yaml
# 冥雾云Web控制台 配置文件
# 启动期配置（修改后需重启服务生效）。运行期可变设置请在管理后台修改。

# ===== 应用监听 =====
port: 25555

# ===== 管理员账户（不入数据库，仅在此处配置）=====
admin:
  username: admin
  password: changeme

# ===== JWT 鉴权 =====
jwt_secret: ""
jwt_expires_in: 604800

# ===== Guacamole（RDP 后端）=====
guacd:
  host: 127.0.0.1
  port: 4822
guac_ws_port: 4823
guac_crypt_key: "MWYwebConsole-GuacLite!!-Secret!!"

# ===== 数据库 =====
database: ./data/console.db

# ===== 上传与日志 =====
uploads_dir: ./data/uploads
log_retention_days: 90
```

---

## 生产环境安全建议

### 1. 修改管理员密码

`config.yml` 中的默认密码为 `changeme`，**必须修改为强密码**。

### 2. 修改 JWT 密钥

留空 `jwt_secret` 会导致每次重启后所有用户 token 失效。建议设置固定密钥：

```bash
# 生成 32+ 字符随机密钥
openssl rand -hex 24
```

### 3. 修改 Guacamole 加密密钥

默认密钥为公开值，**任何人均可伪造 RDP Token**。生产环境必须替换为 32 字符的随机字符串：

```bash
openssl rand -hex 16
# 输出示例: a3f8c2e1d4b7960e5f1a2b3c4d5e6f70
```

### 4. 使用 HTTPS

强烈建议在反向代理层（Nginx/Caddy）配置 TLS，详见 [反向代理](Reverse-Proxy)。

### 5. 数据目录权限

`data/` 目录包含 SQLite 数据库和上传资源，建议限制读取权限：

```bash
chmod 700 data/
```

---

## 向后兼容：.env 文件

项目仍支持 `.env` 文件配置（优先级低于 `config.yml`）。如果同时存在 `config.yml` 和 `.env`，`config.yml` 中的值优先生效。

`.env` 支持的变量（旧版兼容）：

| 变量 | 对应 config.yml | 默认值 |
|------|-----------------|--------|
| `PORT` | `port` | `25555` |
| `GUAC_CRYPT_KEY` | `guac_crypt_key` | 内置默认值 |
| `GUAC_WS_PORT` | `guac_ws_port` | `4823` |
| `GUACD_HOST` | `guacd.host` | `127.0.0.1` |
| `GUACD_PORT` | `guacd.port` | `4822` |

---

## guacd 连接流程

```
浏览器  ←WebSocket→  server.js:25555/guac  ←TCP代理→  guacamole-lite:4823  ←TCP→  guacd:4822  ←RDP→  Windows
```

### Docker 网络场景

| 场景 | guacd.host 设置 |
|------|----------------|
| guacd 与应用同容器网络（Compose） | 服务名，如 `guacd` |
| guacd 独立 Docker 容器（同宿主机） | `host.docker.internal`（Mac/Win）或宿主机 IP |
| guacd 安装在宿主机系统 | `127.0.0.1`（默认） |
| guacd 在远程服务器 | 远程服务器 IP |
