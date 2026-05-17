# 冥雾云 WebConsole Wiki

基于 Node.js 的全协议 Web 远程连接管理平台，支持 SSH 终端、SFTP/FTP 文件管理、VNC 和 RDP 远程桌面，所有操作均在浏览器中完成。内置管理后台，支持站点定制、用户管理、功能开关和 SOCKS5 出站代理。

---

## 快速导航

| 页面 | 说明 |
|------|------|
| [安装部署](Installation) | 源码部署、Docker 部署、guacd 安装 |
| [配置参考](Configuration) | config.yml 配置项、安全建议 |
| [管理后台](Admin-Panel) | 站点定制、功能开关、用户管理、连接日志、SOCKS5 代理 |
| [SSH & SFTP](SSH-&-SFTP) | SSH 终端使用、密钥登录、SFTP 文件管理 |
| [RDP 远程桌面](RDP) | Windows 远程桌面、NLA 认证、guacamole 架构 |
| [VNC 远程桌面](VNC) | Linux/macOS 远程桌面、noVNC 集成 |
| [FTP 文件传输](FTP) | FTP / FTPS 连接与文件操作 |
| [iframe 嵌入](Embed) | 第三方系统集成、embed.html 参数说明 |
| [打包为可执行文件](Build-Executable) | 使用 pkg 生成 Windows/Linux/macOS 独立程序 |
| [反向代理](Reverse-Proxy) | Nginx / Caddy 配置，HTTPS + WebSocket 支持 |

---

## 功能概览

### 多协议支持

| 协议 | 用途 | 技术实现 |
|------|------|----------|
| SSH | Web 终端 | ssh2 + xterm.js |
| SFTP | 文件浏览/上传/下载 | ssh2-sftp |
| VNC | Linux 图形桌面 | noVNC |
| RDP | Windows 远程桌面（支持 NLA） | guacamole-lite + guacd |
| FTP/FTPS | 文件传输 | basic-ftp |

### 管理后台

- **站点定制** — 自定义站点名称、副标题、Logo、Favicon、背景图、主题色
- **功能开关** — 按需开关各协议和用户注册
- **用户管理** — 创建/禁用/重置密码/删除用户
- **连接日志** — 记录所有连接元数据，支持 CSV 导出
- **SOCKS5 代理** — 全局出站代理，按协议选择应用范围

### 服务器管理

- 卡片式界面，支持搜索、分页
- 快捷栏支持 `user@host:port` 格式直接连接
- 服务器信息本地 AES-GCM 加密存储

### 云同步

- 端到端加密，服务端无法解密连接凭据
- 内置 JWT 用户注册/登录系统
- 可视化对比本地与云端数据，支持逐条同步

---

## 技术栈

```
Express 4.x          — HTTP/WS 服务器
better-sqlite3       — SQLite 数据库
ssh2                 — SSH/SFTP 协议
guacamole-lite       — Guacamole 协议 WebSocket 代理
guacd                — RDP 协议守护进程（Apache Guacamole）
noVNC                — 浏览器端 VNC 客户端
xterm.js             — 浏览器端 SSH 终端
basic-ftp            — FTP/FTPS 客户端
jsonwebtoken         — JWT 鉴权
socks                — SOCKS5 代理客户端
```

---

## 项目结构

```
MWYwebConsole/
├── server.js           # 主服务端（Express + WebSocket）
├── config.yml          # 启动期配置（端口/admin/guacd/密钥）
├── config.example.yml  # 配置示例
├── package.json
├── pnpm-lock.yaml
├── lib/
│   ├── config.js       # 配置加载（yml + .env 合并）
│   ├── db.js           # SQLite 初始化与查询
│   ├── auth.js         # JWT + 密码 hash + 鉴权中间件
│   ├── admin-api.js    # 管理后台 API 路由
│   ├── features.js     # 协议开关中间件
│   └── proxy.js        # SOCKS5 出站代理
├── data/
│   ├── console.db      # SQLite 数据库（运行期数据）
│   └── uploads/        # 管理后台上传的资源
└── public/
    ├── index.html      # 主页面（服务器管理）
    ├── index.js        # 主页面逻辑
    ├── admin.html      # 管理后台 SPA
    ├── admin.js        # 管理后台逻辑
    ├── site-style.js   # 站点样式动态加载
    ├── terminal.html   # SSH 终端页面
    ├── terminal.js     # 终端逻辑
    ├── sftp.html       # SFTP 文件管理页面
    ├── sftp.js         # SFTP 逻辑
    ├── vnc.html        # VNC 远程桌面页面
    ├── rdp.html        # RDP 远程桌面页面
    ├── ftp.html        # FTP 文件管理页面
    ├── embed.html      # iframe 嵌入中间件
    ├── novnc/          # noVNC 客户端库
    └── imgs/           # 默认背景图、Logo
```
