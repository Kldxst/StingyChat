# StingyChat

StingyChat 是运行在 Cloudflare Workers 上的 Token 优化 AI 聊天工作台。它把提示词压缩、长期记忆、资料即时检索、语义缓存、模型路由和 Provider 缓存遥测组合到同一条可观测链路中，同时原生适配 OpenAI、Anthropic、Gemini、DeepSeek、xAI、Mistral、通义千问、Kimi、MiniMax 与自定义 OpenAI 兼容端点。

项目采用 **GNU General Public License v3.0 only（GPL-3.0-only）**。分发本项目的源码、修改版或二进制副本时，须遵守 GPL-3.0 的相应条款；仅在服务器上运行而不向用户分发副本，通常不会触发 GPL 特有的对应源码提供义务。

## 核心能力

- 流式聊天与逐字呈现，Markdown、GFM 表格、代码高亮、代码复制和 KaTeX 公式渲染。
- 支持 `$...$`、`$$...$$`、`\(...\)`、`\[...\]`，宽公式局部滚动并可复制 TeX。
- 提示词规则压缩、结构化模板、CHIP 风格、Few-shot、输出契约和 TOON 紧凑记忆。
- 原始历史、结构化长期摘要与最近窗口组成的分层上下文；达到预算阈值时自动调用 GLM 摘要。
- TXT、Markdown、PDF、DOCX 本地解析，Orama 长生命周期中英文 n-gram Top-K 检索。
- 图片压缩、原生视觉内容块，以及不支持视觉模型的 GLM 描述/OCR 回退。
- Provider 原生搜索优先；不支持时使用 GLM `web_search` 回退，并统一显示 URL 来源与执行方。
- 所有模型都显示思考开关与强度。原生支持时映射官方参数，否则注入 GLM 生成的公开辅助推演，不冒充私有思维链。
- 同会话语义缓存先提示用户确认再复用；候选受 Provider、模型、System Prompt、摘要与资料指纹约束。
- Token 账本区分 Provider 实际 usage 与本地估算，并显示提示词、历史、JIT、语义缓存和 Prompt Cache 分项。
- OpenAI 与 Anthropic 批处理工作台；其他 Provider 按能力表明确禁用。
- 桌面侧栏、移动抽屉、响应式模型选择器、玻璃组件及 `prefers-reduced-motion` 降级。
- 浏览器时间、时区与 Cloudflare IP 粗略位置会注入每轮上下文，用于纠正日期和地域判断；粗略位置不视为精确定位。
- 输入 `$$` 打开可组合 Skills 面板；长于 6,000 字的粘贴内容自动转为仅在浏览器处理的文本附件。
- 模型按具名 Markdown 代码围栏协议（例如 `filename="app.ts"`）生成文件，右侧文件栏可审查、复制并下载；DOCX 在浏览器生成。
- `/project` 工程模式提供本地项目树、Monaco 编辑器、差异审查、自动检查点、工程助手事件流、终端桥接与插件市场；Monaco 和工程依赖仅在进入该路由时懒加载。
- 插件市场识别 StingyChat、Codex Agent Plugin、DeepSeek Harness bundle、MCP 与 Agent Skill，并在安装前展示兼容等级、许可证和权限。

## 技术架构

- 前端：React 19、Vite、TypeScript、Zustand、Dexie、Motion、React Markdown、KaTeX。
- Worker：Hono、Zod、Cloudflare Workers Static Assets。
- 调度：`GlmScheduler` Durable Object，每个开发者 GLM Key 一个并发槽，FIFO 排队。
- 存储：资料、索引、语义缓存和用户 Key 位于浏览器 IndexedDB；登录用户的可同步会话、版本化偏好、加密个性答案与 RBAC 审计保存到 D1。
- Token：OpenAI 类模型按需动态加载 `js-tiktoken`，其他模型明确使用估算。

详见 [架构说明](docs/ARCHITECTURE.md) 与 [Cloudflare 部署指南](docs/DEPLOYMENT.md)。

## 本地开发

要求 Node.js 20+、npm 10+。

```powershell
npm install
npm run build
npx wrangler d1 execute stingy-chat-admin --local --file worker/schema.sql
npm run dev:worker
```

浏览器访问 `http://127.0.0.1:8787`。仅开发前端时可运行 `npm run dev`，Vite 会将 `/api` 代理到本地 Worker。

需要本机 Shell、Git、stdio MCP 或 DSH runtime 时，在工程模式的“桥接”页下载独立脚本，然后在需要授权的项目根目录运行：

```powershell
node "$env:USERPROFILE\Downloads\stingy-bridge.mjs" --root .
```

不需要在用户项目中安装 StingyChat，也不需要该项目定义 `bridge` npm 脚本。桥只监听 `127.0.0.1:47321`，终端会显示一次性六位配对码。完整权限模型、插件格式和故障恢复见 [工程模式与插件](docs/PROJECT_MODE.md)。

复制 `.dev.vars.example` 为 `.dev.vars` 后只能填入新轮换的开发凭据：

```env
GLM_API_KEY=
FREE_GLM_API_KEY=
GLM_FALLBACK_API_KEYS=[]
GLM_VISION_MODEL=GLM-4.6V-Flash
OWNER_CP_SUB=CP OAuth user subject for the permanent Owner
```

`GLM_FALLBACK_API_KEYS` 是 JSON 字符串数组。不要把 `.dev.vars`、真实 Key、管理员密码或 Wrangler 状态目录提交到 Git。

## Cloudflare 配置

`wrangler.jsonc` 已声明：

- Workers Static Assets：`dist/`
- Durable Object：`GLM_SCHEDULER`
- SQLite Durable Object migration：`v1-glm-scheduler`
- D1 binding：`APP_DB`，并在一个发布周期内兼容 `ADMIN_DB`
- 非敏感变量：GLM 模型名与 HTTPS Base URL

生产 Secret：

```powershell
npx wrangler secret put GLM_API_KEY
npx wrangler secret put FREE_GLM_API_KEY
npx wrangler secret put GLM_FALLBACK_API_KEYS
npx wrangler secret put OWNER_CP_SUB
npx wrangler secret put CP_OAUTH_CLIENT_ID
npx wrangler secret put CP_OAUTH_CLIENT_SECRET
npx wrangler secret put SESSION_SECRET
npx wrangler secret put PROFILE_ENCRYPTION_KEY
```

所有曾出现在聊天、截图、日志或提交历史中的 Key 都视为已泄露，必须先在供应商后台撤销并重新生成。不要重新使用本项目开发对话中曾提供过的任何 Key。

完整的 D1 初始化、Access、WAF、限流、Secret 和部署后验证步骤见 [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)。

## Key 与隐私边界

用户 Provider Key 和个人 GLM Key通过 Web Crypto AES-GCM 加密后写入当前浏览器 IndexedDB；加密密钥为不可导出的 `CryptoKey`。明文只在发起 HTTPS 请求时由浏览器解密，并通过请求头交给 Worker 转发。

Worker 代码不会把这些 Key 写入 D1、缓存、错误响应或显式日志。个人 GLM Key 一旦配置，会替换所有开发者 GLM 调用，包括 StingyChat、提示词优化、System Prompt、语义增强、摘要、路由、搜索、推理和图片理解，并绕过开发者队列。该设计降低暴露面，但不能对浏览器扩展、恶意脚本、终端设备失陷或上游 Provider 作绝对安全保证。

CP OAuth 仅请求 `openid profile`。回调完成后不会保存 CP access token 或 refresh token；浏览器会话使用 Secure、HttpOnly、SameSite=Lax Cookie，D1 仅保存随机会话令牌的 SHA-256 哈希。十项引导答案以用户 ID 和设置版本作为 AAD，经 AES-GCM 加密后写入 D1。

云历史会保存消息正文、推理摘要、引用、Token 明细、长期记忆、System Prompt、附件提取文本与生成产物；超过 128KiB 的文本分块存放。原始图片、原始文件二进制、图片 Data URL 和任何 API Key 不写入 D1。删除对话会立即删除正文，仅保留 30 天的无内容 ID 墓碑。聊天审计只向 Owner 开放，部署者必须披露审计范围并以 Cloudflare Access 保护后台。

账号角色固定为 `owner/admin/support/member`。`OWNER_CP_SUB` 在每次鉴权时强制绑定永久 Owner，Owner 不可被降级、停用或删除；功能权限同时在前端与 Worker 中校验。默认云历史配额为每账号 100MB。

官方实例设计为免费、无广告，不出售用户 Key，也不从用户自带 Key 获利。GPL 许可证仍允许第三方按许可证条款独立运营或收费。

## GLM 调度

- 主 Key、免费 Key 与备用 Key 分别构成并发数为 1 的槽。
- 开发者池任务按 FIFO 分配到空闲健康槽；同一 Key 不并发。
- 一个 Key 在 5 分钟内连续 3 次收到 429 后冷却 10 分钟。
- 全部槽不可用时返回结构化 `GLM_POOL_EXHAUSTED`，前端建议配置个人 Key，不显示不透明的 524。
- 免费 StingyChat 的流式响应在消费结束前持续占用槽，防止“只限制建连、不限制生成”的伪并发控制。

## 验证

```powershell
npm test
npm run audit:dead-code
npm run build
npx tsc -p tsconfig.worker.json --noEmit
```

测试覆盖 Provider 参数映射、搜索来源、GLM 凭据隔离、FIFO 与每 Key 并发 1、429 断路器、提示词压缩、上下文窗口、资料检索、Token 遥测、自定义端点安全、管理员限制、附件审计脱敏、LaTeX 与响应式溢出。

## 许可证

Copyright (C) 2026 StingyChat contributors.

本项目仅按 [GPL-3.0-only](LICENSE) 提供，不附带任何担保。第三方服务的 API、模型、商标和使用条款归各自权利人所有。
