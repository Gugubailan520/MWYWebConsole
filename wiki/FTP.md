# FTP 文件传输

冥雾云 WebConsole 内置基于 **basic-ftp** 的浏览器端 FTP 客户端，支持 FTP、FTPS (Explicit TLS) 和 FTPS (Implicit TLS)。

---

## 连接方式

### 从主页连接

1. 添加服务器，类型选择 **FTP**
2. 填写：主机地址、端口、用户名、密码
3. 选择加密模式（见下方说明）
4. 点击 **连接** 按钮

### embed.html 直连

```
# 普通 FTP（不加密）
/embed.html?type=ftp&host=192.168.1.1&port=21&user=ftpuser&pass=123456&secure=false

# FTPS Explicit（STARTTLS，推荐）
/embed.html?type=ftp&host=192.168.1.1&port=21&user=ftpuser&pass=123456&secure=true

# FTPS Implicit（始终 TLS，端口通常为 990）
/embed.html?type=ftp&host=192.168.1.1&port=990&user=ftpuser&pass=123456&secure=implicit
```

| 参数 | 说明 | 默认值 |
|------|------|--------|
| `host` | FTP 服务器地址 | — |
| `port` | FTP 端口 | `21` |
| `user` | 用户名 | `anonymous` |
| `pass` | 密码 | — |
| `secure` | 加密模式：`false` / `true` / `implicit` | `false` |

---

## 加密模式说明

| 模式 | `secure` 值 | 标准端口 | 说明 |
|------|------------|---------|------|
| 普通 FTP | `false` | 21 | 明文传输，不建议在公网使用 |
| FTPS Explicit | `true` | 21 | 连接后通过 `AUTH TLS` 升级加密 |
| FTPS Implicit | `implicit` | 990 | 连接建立时立即使用 TLS |

---

## 文件操作

| 操作 | 说明 |
|------|------|
| 浏览目录 | 点击目录名进入，面包屑导航返回上级 |
| 上传文件 | 点击上传按钮，支持多文件选择 |
| 下载文件 | 点击文件行的下载图标 |
| 删除文件/目录 | 点击删除图标，弹窗确认 |
| 创建目录 | 点击新建目录按钮 |
| 刷新列表 | 点击刷新图标 |

---

## 常见问题

### 连接超时 / PASV 失败

FTP 被动模式（PASV）需要服务器开放额外端口范围。若在 NAT 后运行，需配置 FTP 服务器的被动端口范围并在防火墙放行：

**vsftpd 示例**（`/etc/vsftpd.conf`）：
```ini
pasv_enable=YES
pasv_min_port=40000
pasv_max_port=40100
pasv_address=公网IP
```

### 证书错误（FTPS）

若服务器使用自签名证书，连接可能被拒绝。可在服务器配置中信任自签名证书，或使用有效 CA 证书。

### 匿名登录

```
user=anonymous&pass=
```

（服务器需开启匿名访问）
