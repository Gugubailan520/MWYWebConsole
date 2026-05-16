# 打包为独立可执行文件

冥雾云 WebConsole 支持使用 [pkg](https://github.com/vercel/pkg) 打包为无需安装 Node.js 的独立可执行程序，方便在没有 Node.js 环境的机器上直接运行。

---

## 打包命令

```bash
# Windows 可执行文件 (.exe)
pnpm run pkg:win

# Linux 可执行文件
pnpm run pkg:linux

# macOS 可执行文件
pnpm run pkg:mac
```

输出文件：

| 命令 | 输出文件 | 目标平台 |
|------|---------|---------|
| `pkg:win` | `MWYWebConsole.exe` | Windows x64 |
| `pkg:linux` | `MWYWebConsole` | Linux x64 |
| `pkg:mac` | `MWYWebConsole.app` | macOS x64 |

---

## 前置条件

```bash
# 安装 pkg（已在 devDependencies 中）
pnpm install

# 确认 pkg 已安装
npx pkg --version
```

---

## 打包内容

`package.json` 中的 `pkg` 配置指定了打包规则：

```json
"pkg": {
  "assets": [
    "public/**/*",
    ".env"
  ],
  "scripts": "server.js"
}
```

- `public/**/*`：所有静态前端文件（HTML、JS、图片等）打包进可执行文件
- `.env`：环境变量文件打包进去作为默认配置
- `users/` 目录不打包（运行时动态创建）

---

## 运行打包后的程序

### Windows

```cmd
# 直接双击运行，或命令行：
MWYWebConsole.exe

# 指定端口（通过 .env 配置，或环境变量）
set PORT=8080 && MWYWebConsole.exe
```

### Linux

```bash
chmod +x MWYWebConsole
./MWYWebConsole

# 后台运行
nohup ./MWYWebConsole &
```

### macOS

```bash
chmod +x MWYWebConsole.app
./MWYWebConsole.app
```

---

## 数据持久化

打包后的程序在运行目录下自动创建 `users/` 目录存储数据。

建议在固定目录运行，避免频繁切换工作目录导致数据分散：

```bash
# Linux/macOS 建议
mkdir -p /opt/mwy-console
cp MWYWebConsole /opt/mwy-console/
cd /opt/mwy-console
./MWYWebConsole
```

---

## 配置 .env

打包后的程序优先读取**运行目录**下的 `.env` 文件（覆盖打包内置的默认配置）：

```bash
# 在运行目录创建自定义 .env
cat > .env << EOF
PORT=3000
GUAC_CRYPT_KEY=YourStrongSecretKey32CharsHere!!
GUACD_HOST=127.0.0.1
GUACD_PORT=4822
EOF
```

---

## 注意事项

- pkg 打包的目标 Node.js 版本为 `node18`，请确保打包机已安装 Node.js 18+
- 打包文件较大（通常 50–100 MB），包含了完整的 Node.js 运行时
- guacd 守护进程**不会**被打包，RDP 功能仍需在运行环境中单独安装 guacd
- 若更换了前端静态文件，需重新打包
