# iframe 嵌入集成

`embed.html` 是冥雾云 WebConsole 提供的嵌入中间件页面，通过 URL 查询参数传递连接信息，自动路由并以 iframe 形式嵌入到目标连接页面，适合集成到运维平台、堡垒机系统等第三方系统中。

---

## 基本格式

```
https://your-console.com/embed.html?type=<类型>&host=<地址>&[其他参数]
```

---

## 全参数说明

| 参数 | 适用类型 | 必填 | 说明 |
|------|---------|------|------|
| `type` | 全部 | **是** | `ssh` / `sftp` / `vnc` / `rdp` / `ftp` |
| `host` | 全部 | **是** | 服务器 IP 或域名 |
| `port` | 全部 | 否 | 端口号（各协议有默认值，见下表） |
| `user` | SSH/SFTP/RDP/FTP | 否 | 用户名 |
| `pass` | 全部 | 否 | 密码 |
| `key` | SSH/SFTP | 否 | SSH 私钥内容（OpenSSH/PEM 格式） |
| `domain` | RDP | 否 | Windows 域名 |
| `secure` | FTP | 否 | FTP 加密：`false`（默认）/ `true` / `implicit` |

### 各协议默认端口

| 协议 | 默认端口 |
|------|---------|
| SSH | 22 |
| SFTP | 22 |
| VNC | 5900 |
| RDP | 3389 |
| FTP | 21 |

---

## 示例

### SSH 终端

```
/embed.html?type=ssh&host=192.168.1.1&port=22&user=root&pass=123456
```

### SSH 私钥认证

```
/embed.html?type=ssh&host=192.168.1.1&user=root&key=-----BEGIN OPENSSH PRIVATE KEY-----...
```

### SFTP 文件管理

```
/embed.html?type=sftp&host=192.168.1.1&user=root&pass=123456
```

### VNC 远程桌面

```
/embed.html?type=vnc&host=192.168.1.1&port=5900&pass=vncpass
```

### RDP 远程桌面

```
/embed.html?type=rdp&host=192.168.1.1&port=3389&user=Administrator&pass=P@ssword
```

### RDP 域用户

```
/embed.html?type=rdp&host=192.168.1.1&user=jsmith&pass=P@ssword&domain=CORP
```

### FTP（FTPS）

```
/embed.html?type=ftp&host=192.168.1.1&port=21&user=ftpuser&pass=123456&secure=true
```

---

## 在 iframe 中嵌入

```html
<iframe
  src="https://your-console.com/embed.html?type=ssh&host=10.0.0.1&user=root&pass=xxx"
  width="100%"
  height="600"
  style="border: none;"
  allow="clipboard-read; clipboard-write"
  allowfullscreen>
</iframe>
```

### 全屏嵌入（推荐用于独立标签页）

```html
<iframe
  src="https://your-console.com/embed.html?type=rdp&host=10.0.0.1&user=Administrator&pass=xxx"
  style="position: fixed; top: 0; left: 0; width: 100%; height: 100%; border: none; z-index: 9999;"
  allow="clipboard-read; clipboard-write"
  allowfullscreen>
</iframe>
```

---

## 与第三方系统集成

### 后端动态生成嵌入 URL

为避免在前端页面暴露明文密码，建议由后端按需生成带有临时凭据的嵌入链接：

```javascript
// Node.js 示例
app.get('/console/ssh/:serverId', async (req, res) => {
  const server = await getServerById(req.params.serverId);
  const embedUrl = `https://console.example.com/embed.html` +
    `?type=ssh&host=${server.host}&port=${server.port}` +
    `&user=${encodeURIComponent(server.user)}&pass=${encodeURIComponent(server.password)}`;
  
  res.render('console', { embedUrl });
});
```

```python
# Python Flask 示例
@app.route('/console/rdp/<server_id>')
def rdp_console(server_id):
    server = get_server(server_id)
    embed_url = (
        f"https://console.example.com/embed.html"
        f"?type=rdp&host={server.host}&port={server.port}"
        f"&user={quote(server.username)}&pass={quote(server.password)}"
    )
    return render_template('rdp.html', embed_url=embed_url)
```

---

## 安全注意事项

> **重要**：embed.html URL 中包含明文密码，请注意以下安全实践：

1. **仅在内网或受信环境使用**明文密码 URL
2. 生产环境使用 **HTTPS** 防止传输层泄露
3. 建议由后端动态生成 URL，并设置**短时效**的临时凭据
4. 可配合堡垒机/跳板机，embed.html 连接跳板机而非直接连接目标服务器
5. 浏览器历史记录可能保存含密码的 URL，敏感场景建议在用后清除
