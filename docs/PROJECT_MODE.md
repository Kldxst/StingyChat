# 工程模式与插件

工程模式位于 `/project`。浏览器源码、工程对话、diff、检查点和终端输出只写入用户授权目录、OPFS 或 IndexedDB；D1 的 `project_metadata` 仅保存名称、状态、模型、权限、时间和内容哈希，不保存源码或可还原源码的片段。

## 权限

| 模式 | 文件读取 | 自动写入 | Shell / Git 写入 | MCP / Hooks / DSH |
| --- | --- | --- | --- | --- |
| 只读 | 授权根目录 | 禁止 | 禁止 | HTTP MCP 仍受插件权限约束 |
| 工作区 | 授权根目录 | 每批修改前建立检查点 | 禁止 | 禁止可执行插件 |
| 完全访问 | 授权根目录并校验真实路径 | 允许 | 通过本地桥 | 通过本地桥隔离运行 |

越出根目录、符号链接逃逸、破坏性命令、包安装、外部网络和新增插件权限不会被“会话内自动应用”隐式放行。

## 本地桥

```powershell
npm run bridge -- --root D:\work\repository
```

桥仅绑定环回地址，要求精确 Origin、JSON Content-Type 和 Private Network Access 预检。配对码只使用一次；会话令牌保存在页面内存中并在八小时无效。命令使用参数数组执行而非 Shell 拼接，具有超时、输出上限、进程取消和根目录真实路径检查。

DSH 包先以禁用 lifecycle scripts 的方式安装到独立 profile。需要构建脚本、网络、提权或危险 Git 操作时必须单独确认。浏览器关闭或会话过期后需要重新配对。

## 兼容矩阵

| 格式 | 浏览器原生 | 本地桥 | 说明 |
| --- | --- | --- | --- |
| StingyChat | Skills、Tools、HTTP MCP | 可选 | 内建清单格式 |
| Codex Agent Plugin | `plugin.json`、`.codex-plugin/plugin.json`、`SKILL.md`、HTTP MCP | stdio MCP、Hooks | Codex 专属 App UI 不注入主页面；MCP Apps 必须进入 CSP 沙箱 |
| DeepSeek Harness | Skills、MCP、静态元数据 | `dsh.bundle.patch` 与 Cordis runtime | 客户端专属 UI 标记为部分兼容，不转换为提示词 |
| MCP | Streamable HTTP | stdio | 工具名规范化为 `mcp__<server>__<tool>`，冲突时附加稳定哈希 |
| Agent Skill | 名称和描述先加载，正文按需读取 | 可选 | 渐进披露减少上下文成本 |

## 安装与更新

市场目录可以公开读取；安装和运行要求登录且具备 `plugin_install` 权限。安装层拒绝未声明许可证、AGPL 和尚未通过 GPL-3.0-only 兼容审核的许可证。Git 来源必须固定 commit SHA，npm 来源必须固定版本与 integrity。

补丁更新只有在权限集合不增加时才能无交互完成。新增权限、主版本、可执行代码或安装脚本需要重新确认。更新前保留 `previousManifest`；验证或启动失败时恢复上一版本。浏览器设备只同步安装意图，新设备不会静默下载可执行代码。

## 准备性能

聊天发送先将原始用户消息写入 Zustand 与 IndexedDB。检索、路由、语义改写和 Skills 设定 80–300ms 截止时间，超时使用原始输入；精确 tokenizer 超时后使用同步估算。长期摘要和标题在回复后后台维护。必要的非原生搜索、推理或图片回退会显示阶段，并允许“立即发送，跳过增强”。

SSE 会发出 `accepted`、`upstream_connected`、`first_token` 和 `timing`。停止按钮通过 `AbortController` 同时取消准备和聊天 fetch，失败或取消的用户消息保留在原位并支持重试。

## 数据库升级

部署前备份 D1，再按顺序应用 `migrations/0004_project_marketplace.sql`。该 migration 只新增项目元数据、市场来源、安全公告和用户插件状态表，不重建现有用户、会话或管理数据。
