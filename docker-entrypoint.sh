#!/bin/sh
set -e

# RDP 功能由独立的 guacd 容器提供（见 docker-compose.yml）。
# 若本容器内未运行 guacd，应用会按 GUACD_HOST 环境变量连接外部 guacd。
# 用户可通过挂载 /app/config.yml 或设置环境变量覆盖配置。

exec "$@"
