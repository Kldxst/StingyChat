# Stingy Bridge

本地桥为 StingyChat 工程模式提供可选的命令、Git、stdio MCP 与 DeepSeek Harness 运行时。它只监听 `127.0.0.1`，不会把源码上传到 Cloudflare。

普通用户可在工程模式的“桥接”页下载独立脚本，并在目标项目目录运行：

```powershell
node "$env:USERPROFILE\Downloads\stingy-bridge.mjs" --root .
```

仅在 StingyChat 仓库开发时使用 `npm run bridge -- --root D:\your-project`。

在 `https://chat.kldxst.me/project` 的终端面板输入终端显示的一次性配对码。高风险命令仍需要单独确认。
