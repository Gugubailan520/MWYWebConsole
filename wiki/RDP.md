# RDP 远程桌面

冥雾云 WebConsole 的 RDP 功能基于 **Apache Guacamole** 技术栈，完整支持 Windows NLA（网络级别身份验证）。

---

## 架构说明

```
浏览器
  │  WebSocket (wss://host/guac)
  ▼
server.js (TCP 代理)
  │  TCP 127.0.0.1:4823
  ▼
guacamole-lite (WebSocket → Guacamole 协议)
  │  TCP 127.0.0.1:4822
  ▼
guacd (Guacamole 守护进程, 内部使用 FreeRDP)
  │  RDP (TCP 3389)
  ▼
Windows 服务器
```

**优势**：
- 全程只需暴露端口 3000，guacamole-lite 绑定在 `127.0.0.1:4823`，不对外开放
- guacd 内置 FreeRDP，完整支持 NLA（CredSSP/NTLM/Kerberos）
- 支持 RDP 7.x 及以上协议特性

---

## 前置条件

RDP 功能必须运行 `guacd` 守护进程，详见 [安装部署 — guacd 安装](Installation#guacd-安装方式汇总)。

验证 guacd 是否运行：

```bash
# Docker 方式
docker ps | grep guacd

# systemd 方式
systemctl status guacd
```

---

## 连接方式

### 从主页连接

1. 添加服务器，类型选择 **RDP**
2. 填写：主机地址、端口（默认 3389）、用户名、密码、域名（可选）
3. 点击 **连接** 按钮

### embed.html 直连

```
/embed.html?type=rdp&host=192.168.1.100&port=3389&user=Administrator&pass=P@ssword
```

支持的参数：

| 参数 | 说明 | 默认值 |
|------|------|--------|
| `host` | Windows 服务器地址 | — |
| `port` | RDP 端口 | `3389` |
| `user` | 用户名 | `Administrator` |
| `pass` | 密码 | — |
| `domain` | 域名 | — |

---

## RDP 页面功能

| 功能 | 说明 |
|------|------|
| 自适应缩放 | 显示内容自动缩放适配浏览器窗口大小 |
| 全屏模式 | 点击全屏按钮，F11 或工具栏按钮切换 |
| Ctrl+Alt+Del | 工具栏 **CAD** 按钮发送该组合键 |
| 下载 .rdp 文件 | 生成标准 `.rdp` 配置文件，可用本地 MSTSC 直接打开 |
| 鼠标/键盘 | 完整鼠标（左/中/右键+滚轮）和键盘输入支持 |

---

## Windows 服务器配置要求

### 开启远程桌面

```
控制面板 → 系统 → 远程设置 → 允许远程连接到此计算机
```

或使用 PowerShell：

```powershell
Set-ItemProperty -Path 'HKLM:\System\CurrentControlSet\Control\Terminal Server' -Name "fDenyTSConnections" -Value 0
Enable-NetFirewallRule -DisplayGroup "Remote Desktop"
```

### NLA（网络级别身份验证）

guacd 通过 FreeRDP 完整支持 NLA，**无需关闭 NLA**。

若遇到认证失败，请检查：
- 用户名/密码是否正确（域用户格式：`DOMAIN\username` 填入域名字段）
- 服务器防火墙是否放行 TCP 3389
- 用户是否在 `Remote Desktop Users` 组中

### 防火墙规则

```powershell
# 放行 RDP（默认已有规则，确认已启用）
Enable-NetFirewallRule -DisplayName "Remote Desktop - User Mode (TCP-In)"
```

---

## 常见问题

### 连接后显示空白

- 确认 guacd 正在运行：`docker ps | grep guacd`
- 检查 guacd 端口是否匹配 `GUACD_PORT` 配置
- 查看服务器日志是否有错误信息

### 提示"缺少连接参数"

embed.html 传参方式：确认 URL 包含 `host` 参数。

### 分辨率不正确

RDP 会话分辨率在连接时由浏览器窗口大小决定。调整窗口后需要重新连接以获得最佳分辨率。

### 连接错误 / guacd 未运行

服务启动时若 guacd 未运行，控制台会显示：

```
[Guacamole] Failed to start: connect ECONNREFUSED 127.0.0.1:4822
```

这是正常警告，启动 guacd 后无需重启主应用即可自动连接。
