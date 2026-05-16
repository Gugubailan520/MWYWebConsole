# 冥雾云 WebConsole Wiki

基于 Node.js 的全协议 Web 远程连接管理平台，支持 SSH 终端、SFTP/FTP 文件管理、VNC 和 RDP 远程桌面，所有操作均在浏览器中完成，无需安装任何客户端。

---

## 快速导航

| 页面 | 说明 |
|------|------|
| [安装部署](Installation) | 源码部署、Docker 部署、guacd 安装 |
| [配置参考](Configuration) | 环境变量、guacd 配置、安全建议 |
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
|------|------|---------|
| SSH | Web 终端 | ssh2 + xterm.js |
| SFTP | 文件浏览/上传/下载 | ssh2-sftp |
| VNC | Linux 图形桌面 | noVNC |
| RDP | Windows 远程桌面（支持 NLA） | guacamole-lite + guacd |
| FTP/FTPS | 文件传输 | basic-ftp |

### 服务器管理

- 卡片式界面，支持分组、搜索、分页
- 快捷栏支持 `user@host:port` 格式直接连接
- 服务器信息本地 AES-GCM 加密存储

### 云同步

- 端到端加密，服务端无法解密连接凭据
- 内置用户注册/登录系统
- 可视化对比本地与云端数据，支持逐条同步

---

## 技术栈

```
Express 4.x          — HTTP/WS 服务器
ssh2                 — SSH/SFTP 协议
guacamole-lite       — Guacamole 协议 WebSocket 代理
guacd                — RDP/VNC 协议守护进程（Apache Guacamole）
noVNC                — 浏览器端 VNC 客户端
xterm.js             — 浏览器端 SSH 终端
basic-ftp            — FTP/FTPS 客户端
```

---

## 项目结构

```
MWYwebConsole/
├── server.js           # 主服务端（Express + WebSocket）
├── .env                # 环境变量配置
├── package.json
├── pnpm-lock.yaml
└── public/
    ├── index.html      # 主页面（服务器管理）
    ├── index.js        # 主页面逻辑
    ├── terminal.html   # SSH 终端页面
    ├── terminal.js     # 终端逻辑
    ├── sftp.html       # SFTP 文件管理页面
    ├── sftp.js         # SFTP 逻辑
    ├── vnc.html        # VNC 远程桌面页面
    ├── rdp.html        # RDP 远程桌面页面
    ├── ftp.html        # FTP 文件管理页面
    ├── embed.html      # iframe 嵌入中间件
    ├── novnc/          # noVNC 客户端库
    └── imgs/           # 背景图、Logo
```
