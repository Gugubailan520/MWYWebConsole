# VNC 远程桌面

冥雾云 WebConsole 集成 **noVNC**，可在浏览器中直接连接 VNC 服务器，无需安装 VNC 客户端。

---

## 连接方式

### 从主页连接

1. 添加服务器，类型选择 **VNC**
2. 填写主机地址、VNC 端口（默认 5900）和密码
3. 点击 **连接** 按钮

### embed.html 直连

```
/embed.html?type=vnc&host=192.168.1.1&port=5900&pass=vncpassword
```

| 参数 | 说明 | 默认值 |
|------|------|--------|
| `host` | VNC 服务器地址 | — |
| `port` | VNC 端口 | `5900` |
| `pass` | VNC 密码 | — |

---

## 服务端配置

### Linux (x11vnc)

```bash
# 安装
apt install x11vnc

# 设置密码
x11vnc -storepasswd /etc/x11vnc.pass

# 启动（监听所有接口）
x11vnc -display :0 -rfbauth /etc/x11vnc.pass -rfbport 5900 -forever -loop -noxdamage -repeat -shared
```

### Linux (TigerVNC，虚拟显示)

```bash
# 安装
apt install tigervnc-standalone-server

# 启动虚拟桌面（分辨率可调）
vncserver :1 -geometry 1280x720 -depth 24

# 密码设置
vncpasswd
```

### Windows (TightVNC / RealVNC)

1. 下载并安装 [TightVNC](https://www.tightvnc.com/) 或 [RealVNC](https://www.realvnc.com/)
2. 在设置中配置端口（默认 5900）和连接密码
3. 确保防火墙放行 TCP 5900

---

## 注意事项

- VNC 协议本身**不加密**，生产环境建议通过 **SSH 隧道**或在 HTTPS 代理后使用
- VNC 密码长度通常限制为 8 字符
- 若 VNC 服务器和 WebConsole 不在同一局域网，需确保端口可访问
