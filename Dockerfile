# syntax=docker/dockerfile:1
# ============== 冥雾云Web控制台 Dockerfile ==============
# 多阶段构建：builder 编译原生模块（better-sqlite3），runtime 内置 guacd

# ---------- Builder: 编译 Node 原生依赖 ----------
FROM node:18-bookworm-slim AS builder

# 启用 pnpm（与 package.json 中声明的 packageManager 保持一致）
RUN corepack enable && corepack prepare pnpm@10.33.2 --activate

# 原生模块编译工具链（better-sqlite3 需要 python3/make/g++）
RUN apt-get update && apt-get install -y --no-install-recommends \
        python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# 先拷锁文件以利用 docker 层缓存
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile --prod

# ---------- Runtime: 最终镜像 ----------
# 注意：guacd（RDP 后端）通过独立的 guacd sidecar 容器提供，
#       请使用 docker-compose.yml 一并启动；本镜像不内置 guacd，保持职责单一。
FROM node:18-bookworm-slim AS runtime

# ca-certificates 用于 SSH/SFTP/HTTPS 出站连接
RUN apt-get update && apt-get install -y --no-install-recommends \
        ca-certificates tini \
    && rm -rf /var/lib/apt/lists/* \
    && mkdir -p /app/data

WORKDIR /app

# 拷贝已编译好的依赖
COPY --from=builder /app/node_modules ./node_modules

# 拷贝应用源码
COPY package.json server.js ./
COPY lib ./lib
COPY public ./public
COPY config.example.yml ./

# 启动脚本
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

# 数据持久化：SQLite 数据库 + 上传文件
VOLUME ["/app/data"]

ENV NODE_ENV=production \
    PORT=25555

EXPOSE 25555

# tini 作为 1 号进程，正确处理信号与僵尸进程
ENTRYPOINT ["tini", "--", "docker-entrypoint.sh"]
CMD ["node", "server.js"]
