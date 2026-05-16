# 反向代理配置

冥雾云 WebConsole 使用 WebSocket 进行实时通信，反向代理需要正确配置 WebSocket 升级支持。

---

## Nginx

### HTTP（开发/内网）

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
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_read_timeout 86400;
        proxy_send_timeout 86400;
    }
}
```

### HTTPS（推荐生产）

```nginx
# HTTP → HTTPS 重定向
server {
    listen 80;
    server_name your-domain.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name your-domain.com;

    ssl_certificate     /etc/letsencrypt/live/your-domain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/your-domain.com/privkey.pem;
    ssl_protocols       TLSv1.2 TLSv1.3;
    ssl_ciphers         HIGH:!aNULL:!MD5;

    # WebSocket 支持（SSH/VNC/RDP 所有协议必须）
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 86400;
        proxy_send_timeout 86400;

        # 上传文件大小限制（SFTP/FTP 上传）
        client_max_body_size 100m;
    }
}
```

### 使用 Let's Encrypt 证书

```bash
# 安装 Certbot
apt install certbot python3-certbot-nginx

# 申请证书（自动配置 Nginx）
certbot --nginx -d your-domain.com

# 自动续期（每天检查）
certbot renew --dry-run
```

---

## Caddy（自动 HTTPS）

Caddy 自动申请和续期 Let's Encrypt 证书，配置最为简洁：

```caddyfile
your-domain.com {
    reverse_proxy localhost:3000 {
        # 保留 WebSocket 升级头
        header_up Host {host}
        header_up X-Real-IP {remote_host}
        transport http {
            read_timeout 0
            write_timeout 0
        }
    }
}
```

启动：

```bash
caddy run --config /etc/caddy/Caddyfile
```

---

## Traefik（Docker 环境）

配合 Docker Compose 使用 Traefik：

```yaml
services:
  traefik:
    image: traefik:v3
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
      - ./traefik.yml:/etc/traefik/traefik.yml
      - ./certs:/certs

  guacd:
    image: guacamole/guacd:latest
    restart: unless-stopped

  mwy-console:
    image: your-registry/mwy-web-console:latest
    restart: unless-stopped
    environment:
      - GUACD_HOST=guacd
    labels:
      - "traefik.enable=true"
      - "traefik.http.routers.mwy.rule=Host(`your-domain.com`)"
      - "traefik.http.routers.mwy.entrypoints=websecure"
      - "traefik.http.routers.mwy.tls.certresolver=letsencrypt"
      - "traefik.http.services.mwy.loadbalancer.server.port=3000"
    depends_on:
      - guacd
```

---

## 重要配置说明

### proxy_read_timeout

WebSocket 连接是长连接，默认 60s 超时会导致终端/远程桌面会话意外断开。必须设置为较大值（如 86400 = 24小时）。

### WebSocket 升级头

以下两个 header 是 WebSocket 升级必须的，缺一不可：

```nginx
proxy_set_header Upgrade $http_upgrade;
proxy_set_header Connection "upgrade";
```

### 子路径部署

若需在子路径下部署（如 `/console/`），目前不支持，建议使用独立子域名或端口。
