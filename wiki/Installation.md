# 安装部署

本页介绍三种部署方式：**源码运行**、**Docker Compose**（推荐生产）和**直接 Docker 运行**。

---

## 环境要求

| 依赖 | 版本要求 | 说明 |
|------|---------|------|
| Node.js | >= 18 | 运行服务器 |
| pnpm | >= 8 | 包管理器（推荐） |
| guacd | 任意版本 | 仅使用 RDP 功能时必须 |

---

## 方式一：源码运行

### 1. 获取代码

```bash
git clone https://github.com/your-org/MWYwebConsole.git
cd MWYwebConsole
```

### 2. 安装依赖

```bash
pnpm install
```

### 3. 配置

```bash
cp config.example.yml config.yml
# 编辑 config.yml，至少修改 admin.password 和 guac_crypt_key
```

> 首次启动会自动创建 `data/console.db`（SQLite）和 `data/uploads/` 目录。

### 4. 启动 guacd（使用 RDP 时）

```bash
docker run -d --name guacd --restart unless-stopped -p 4822:4822 guacamole/guacd
```

### 5. 启动服务

```bash
pnpm start
```

服务运行在 `http://localhost:25555`（或 `config.yml` 中配置的端口）。

---

## 方式二：Docker Compose（推荐）

以下 `docker-compose.yml` 同时部署应用和 guacd：

```yaml
services:
  guacd:
    image: guacamole/guacd:latest
    container_name: guacd
    restart: unless-stopped

  mwy-console:
    image: your-registry/mwy-web-console:latest
    container_name: mwy-console
    restart: unless-stopped
    ports:
      - "25555:25555"
    volumes:
      - ./data:/app/data
      - ./config.yml:/app/config.yml:ro
    environment:
      - NODE_ENV=production
    depends_on:
      - guacd
```

```bash
# 复制并配置
cp config.example.yml config.yml
# 编辑 config.yml，设置 admin 密码和 guacd 连接

# 启动（后台运行）
docker compose up -d

# 查看日志
docker compose logs -f

# 停止
docker compose down
```

### 挂载说明

| 宿主机路径 | 容器路径 | 说明 |
|-----------|---------|------|
| `./data/` | `/app/data/` | SQLite 数据库 + 上传资源（持久化必须挂载） |
| `./config.yml` | `/app/config.yml` | 启动期配置（只读挂载） |

> **注意**：`config.yml` 中 `guacd.host` 应设为 `guacd`（Compose 服务名）。

---

## 方式三：直接 Docker 运行

```bash
# 先启动 guacd
docker run -d --name guacd --restart unless-stopped -p 4822:4822 guacamole/guacd

# 再启动应用
docker run -d \
  --name mwy-console \
  --restart unless-stopped \
  -p 25555:25555 \
  -v $(pwd)/data:/app/data \
  -v $(pwd)/config.yml:/app/config.yml:ro \
  your-registry/mwy-web-console:latest
```

> **注意**：若 guacd 与应用不在同一个 Docker 网络，需在 `config.yml` 中将 `guacd.host` 设为宿主机可达的地址。

---

## guacd 安装方式汇总

RDP 功能依赖 Apache Guacamole 的守护进程 `guacd`（内部使用 FreeRDP，支持 NLA）。

| 方式 | 命令 |
|------|------|
| Docker（推荐） | `docker run -d --name guacd -p 4822:4822 guacamole/guacd` |
| Debian/Ubuntu | `apt install guacd && systemctl enable --now guacd` |
| Docker Compose | 参见上方 Compose 示例中的 `guacd` service |

---

## 验证安装

启动后访问 `http://your-host:25555`，若能看到服务器管理界面即为成功。

使用 `config.yml` 中配置的管理员账号登录后，顶栏右侧会出现「管理」按钮，点击进入管理后台。

若不需要 RDP，guacd 可以不安装。服务启动时会显示：

```
[Guacamole] Failed to start: connect ECONNREFUSED 127.0.0.1:4822
```

这是预期警告，不影响 SSH/SFTP/VNC/FTP 功能。
