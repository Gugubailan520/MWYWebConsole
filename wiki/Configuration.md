# 配置参考

所有配置通过项目根目录的 `.env` 文件设置。参考 `.env.example` 创建。

---

## 环境变量说明

### 服务器基础配置

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `PORT` | `3000` | HTTP 服务监听端口 |

### Guacamole / RDP 配置

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `GUAC_CRYPT_KEY` | `MWYwebConsole-GuacLite!!-Secret!!` | AES-256-CBC Token 加密密钥，**必须恰好 32 字符**，生产环境务必修改 |
| `GUAC_WS_PORT` | `4823` | guacamole-lite 内部 WebSocket 端口，仅绑定 `127.0.0.1`，不对外暴露 |
| `GUACD_HOST` | `127.0.0.1` | guacd 守护进程主机地址 |
| `GUACD_PORT` | `4822` | guacd 守护进程端口 |

---

## 示例 .env 文件

```ini
# 服务器端口
PORT=3000

# Guacamole 配置
# guacamole-lite 内部 WebSocket 端口（仅监听 127.0.0.1，不对外暴露）
GUAC_WS_PORT=4823

# guacd 守护进程地址（默认同机部署）
GUACD_HOST=127.0.0.1
GUACD_PORT=4822

# AES-256-CBC 加密密钥（必须恰好 32 字符，生产环境请修改！）
GUAC_CRYPT_KEY=YourStrongSecretKey32CharsHere!!
```

---

## 生产环境安全建议

### 1. 修改 GUAC_CRYPT_KEY

默认密钥为公开值，**任何人均可伪造 RDP Token**。生产环境必须替换：

```bash
# 生成 32 字符随机密钥
openssl rand -hex 16
# 输出示例: a3f8c2e1d4b7960e5f1a2b3c4d5e6f708
```

将输出值填入 `GUAC_CRYPT_KEY`（确保恰好 32 字符）。

### 2. 仅监听本机

guacamole-lite 默认绑定 `127.0.0.1:4823`，主应用通过内部 TCP 代理转发，不会将 4823 端口暴露到外网。无需额外防火墙规则。

### 3. 使用 HTTPS

强烈建议在反向代理层（Nginx/Caddy）配置 TLS，详见 [反向代理](Reverse-Proxy)。

### 4. 数据目录权限

`users/` 目录存储所有用户账号和加密的云同步数据，建议限制读取权限：

```bash
chmod 700 users/
```

---

## guacd 详细配置

### 连接流程

```
浏览器  ←WebSocket→  server.js:3000/guac  ←TCP代理→  guacamole-lite:4823  ←TCP→  guacd:4822  ←RDP→  Windows服务器
```

- `server.js` 在 `/guac` 路径做 WebSocket TCP 代理，前端只需连接端口 3000
- `guacamole-lite` 仅绑定 `127.0.0.1`，不暴露外网
- `guacd` 负责将 Guacamole 协议指令转换为 RDP 原生协议

### Docker 网络场景

| 场景 | GUACD_HOST 设置 |
|------|----------------|
| guacd 与应用同容器网络（Compose） | 服务名，如 `guacd` |
| guacd 独立 Docker 容器（同宿主机） | `host.docker.internal`（Mac/Win）或宿主机 IP |
| guacd 安装在宿主机系统 | `127.0.0.1`（默认） |
| guacd 在远程服务器 | 远程服务器 IP |
