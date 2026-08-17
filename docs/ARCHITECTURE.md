# 架构与工作原理

工程模式、本地桥与 Codex/DeepSeek Harness 插件适配的详细边界见 [PROJECT_MODE.md](PROJECT_MODE.md)。

## 请求链路

1. 浏览器从 IndexedDB 读取会话、设置、长期记忆、资料索引和加密凭据。
2. 输入先经过规则压缩；可选调用 GLM 做提示词优化或语义缓存规范化。
3. JIT 检索只选择资料库与附件中最相关的 Top-K 片段。
4. 上下文选择器组合稳定 System Prompt、结构化长期记忆、最近原文窗口、搜索摘要、辅助推演与检索片段。
5. Worker 以 Provider 对应协议转发并把上游流统一为 `meta`、`delta`、`reasoning_delta`、`usage`、`done`、`error` SSE 事件。
6. 浏览器逐字呈现回答，先写账号命名空间内的 IndexedDB，再由离线队列把可同步历史写入 D1。

## 设置与历史同步

设置开关采用乐观更新：Zustand 与 IndexedDB 在交互帧内更新，远端写入以 200ms 合并。任一时刻只有一个偏好请求在途；遇到 `409` 时以服务器版本为基准重放本地脏字段，断网或 5xx 则保留本地状态并自动重试。

云端会话以 `revision` 做乐观并发，消息按 UUID 合并。附件提取文本与生成产物按 128KiB 分块；原始二进制、Provider Key、私人助手 Key 与 CryptoKey 永不上传。删除操作先硬删除正文，再写入 30 天无内容墓碑。每账号默认配额 100MB，超限内容继续保留在本机并标记为未同步。

## OAuth RBAC

OAuth 会话只使用 Secure、HttpOnly、SameSite=Lax Cookie。角色为 `owner/admin/support/member`，并可叠加单项权限覆盖。Worker 对 Skills、智能辅助、思考、联网、模型路由、批处理和历史同步逐项强制鉴权。`OWNER_CP_SUB` 在每次会话解析时强制 Owner 身份，Owner 不可降级、停用或删除；只有 Owner 可读取聊天正文和永久删除用户。

浏览器还会把 ISO 时间、本地时间、IANA 时区、语言区域写入运行上下文；Worker 追加 Cloudflare 基于请求 IP 推断的城市、地区、国家和时区。该位置只用于改善地域相关回答，并明确标记为粗略推断。

## Token 基线

账本的“原始基线”由原始 System Prompt、未优化提示词、完整可见历史、完整本地资料文本和附件文本估算构成。“实际发送”只包含最终 System Prompt、长期记忆、最近窗口与 Top-K 片段。节省值是这两个可见输入的估算差，不声称是无法观察的反事实账单。

Provider 返回 usage 时，输入、输出、推理与缓存命中完全采用 Provider 数值；没有 usage 才显示估算。Few-shot 已进入 System Prompt，因此它会增加实际发送量，不会被虚报为节省。

## 搜索与推理

OpenAI/xAI Responses、Anthropic Web Search、Gemini Google Search 和兼容的 Provider 使用原生工具。其他模型先由内置或个人 GLM 搜索，搜索摘要和 HTTPS 来源作为引用上下文注入。用户开关表达允许使用搜索，最终是否调用原生工具仍由模型和 Provider 决定。

推理开关同理：支持的 Provider 映射官方参数；不支持时 GLM 只生成可公开、可验证的辅助规划，不请求或展示目标模型私有思维链。

## GLM Durable Object

所有开发者凭据仅存在 Worker Secret。`GlmScheduler` 从环境变量构建去重槽池；每槽同一时间只处理一个辅助任务或一条尚未消费完成的聊天流。任务在内存队列中 FIFO 排队，状态接口提供位置和估计等待。429 健康状态和冷却在 Durable Object 实例内维护。

个人 GLM Key 是请求级覆盖：存在时 `callGlmTask` 和 StingyChat 均直接使用个人 Key，绝不把任务放入开发者池，也不会在个人 Key 失败后回退到开发者凭据。

## 本地资料与附件

TXT、Markdown、PDF、DOCX 在浏览器解析并分块。Dexie 保存文件元数据、文本块和索引，不上传原文件。发送时只把相关摘录放入 System Prompt。图片压缩后仅在最新消息且目标模型支持视觉时发送；否则 GLM 先生成描述/OCR，目标 Provider 不接收图片数据。

超过 6,000 字的粘贴文本会直接转成临时 TXT 附件，并沿用同一分块与 Top-K 检索链路。Skills 是可组合、可审计的提示模块，输入 `$$` 打开选择器；它们不在浏览器中执行第三方代码。具名 Markdown 围栏会被解析为生成文件，右侧栏只展示明确包含 `filename="..."` 的内容，避免把普通代码块误判为下载文件。

## 安全边界

- 自定义端点必须是 HTTPS，禁止 URL 凭据、localhost、私有 IPv4、IPv6 与重定向。
- API 响应统一 `Cache-Control: no-store`，并设置 CSP、HSTS、Referrer Policy、Permissions Policy 与 frame 限制。
- Worker 不主动记录请求头；错误文本经过凭据模式脱敏。
- 管理员 D1 审计剔除附件正文与 Data URL，但仍包含聊天正文，必须由部署者披露和治理。
- 浏览器本地加密不能防御已控制页面上下文或终端的攻击者。

## 主要模块

- `src/components/ChatView.tsx`：聊天编排、流式渲染、缓存确认、搜索/推理/视觉回退与账本。
- `src/lib/optimization.ts`：规则压缩、模板、上下文窗口与记忆格式。
- `src/lib/knowledge.ts`：文件解析、分块、FlexSearch 与 BM25。
- `worker/providers.ts`：Provider 请求映射、SSE 归一化、引用与 usage。
- `worker/glm.ts`：GLM 任务协议与个人 Key 覆盖。
- `worker/glmScheduler.ts`：FIFO、槽并发、429 断路器与流生命周期。
- `worker/history.ts`：云端会话、分块载荷、配额、revision 与删除墓碑。
- `worker/auth.ts`：CP OAuth、本地会话、RBAC 与加密个性偏好。
- `worker/index.ts`：Hono 路由、权限中间件、管理与批处理接口。
