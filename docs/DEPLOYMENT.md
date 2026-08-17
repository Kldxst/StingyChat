# Cloudflare Workers 部署

## 前置要求

- Node.js 20+、npm 10+
- Wrangler 已登录目标 Cloudflare 账户
- 一个绑定为 `APP_DB` 的 D1 数据库；`ADMIN_DB` 仅保留一个发布周期的兼容期
- 已在 CP OAuth 创建应用并登记正式回调地址
- 已轮换且从未出现在聊天、日志或 Git 历史中的 GLM Key
- 生产域名建议启用 Cloudflare Zero Trust Access

## 1. 安装与验证

```powershell
npm ci
npm test
npm run audit:dead-code
npm run build
```

任何检查失败都不要继续部署。

## 2. D1

创建数据库并把返回的 `database_id` 写入 `wrangler.jsonc`：

```powershell
npx wrangler d1 create stingy-chat-admin
npx wrangler d1 execute stingy-chat-admin --remote --file worker/schema.sql
npx wrangler d1 migrations apply stingy-chat-admin --remote
```

`migrations/0002_auth_preferences.sql` 新增 OAuth 用户、会话和偏好表；`0003_history_rbac.sql` 前向增加 RBAC、云端历史、分块载荷、删除墓碑、审计和用量表，不重建或清空现有数据。OAuth、偏好与历史同步依赖 `APP_DB`；兼容期结束后可删除 `ADMIN_DB` binding。

## 3. Durable Object

`wrangler.jsonc` 已包含 `GLM_SCHEDULER` binding 与 `v1-glm-scheduler` migration。首次部署会创建 SQLite Durable Object class。不要重复使用同一个 migration tag 声明不同 class。

## 4. Secret

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

非敏感的 `GLM_VISION_MODEL` 默认是 `GLM-4.6V-Flash`，用于目标模型不支持图片时的描述/OCR 回退。上线前应按智谱当前模型目录确认该名称在部署账户可用；若不同，在 `wrangler.jsonc` 或本地 `.dev.vars` 中覆盖。

备用 Key 的输入是 JSON，例如：

```json
["rotated-key-1","rotated-key-2"]
```

Secret 不应出现在 `wrangler.jsonc`、`.dev.vars.example`、GitHub Actions 日志或 README。开发对话中曾出现的 Key 一律先撤销，不能作为生产 Secret 继续使用。

`SESSION_SECRET` 和 `PROFILE_ENCRYPTION_KEY` 应分别使用独立的高熵随机值。前者签名十分钟 OAuth 状态并保护本地会话，后者派生 AES-GCM 密钥加密引导答案。

`OWNER_CP_SUB` 必须取自已完成一次 CP OAuth 登录的部署者账号。部署顺序为：先备份 D1、应用 migration、写入该 Secret、部署并验证会话返回 `owner`，最后删除遗留的 `ADMIN_PASSWORD` Secret。

## 5. CP OAuth

在 CP OAuth 开发者后台创建应用：

- 应用名：`StingyChat`
- Redirect URI：`https://chat.kldxst.me/api/auth/callback`
- Require verified email：关闭
- Scope：应用只请求 `openid profile`

将 Client ID 与只显示一次的 Client Secret 直接写入 Cloudflare Secret。不要把 Secret 粘贴到源码、终端命令参数或聊天记录。正式环境设置 `PUBLIC_ORIGIN=https://chat.kldxst.me`；回调严格使用该 Origin。

## 6. 部署

```powershell
npm run deploy
```

部署后检查：

```powershell
Invoke-RestMethod https://YOUR_WORKER/api/health
```

然后在浏览器分别验证免费模型、个人 Key、提示词优化、System Prompt、语义增强、GLM 搜索回退、原生搜索、附件、长对话滚动和队列饱和提示。

## 7. Access 与 WAF

在 Zero Trust 中为 Beta 域名创建 Access Application，只允许指定邮箱或域名。管理员后台必须纳入同一策略，不应只依赖隐藏入口和密码。

建议设置：

- `/api/admin/*`：仅接受现有 HttpOnly OAuth 会话，并由 RBAC 权限中间件逐项校验。
- `/api/assist/*`、`/api/conversation/compress`：按 IP 与会话限流。
- `/api/auth/login`、`/api/auth/callback`：限制异常跳转和重复授权；不得记录 code、state 或 Cookie。
- `/api/chat/stream`：限制并发连接与异常请求体。
- 最大请求体至少覆盖单张 4 MB 图片的 Base64，仍应拦截异常大请求。
- 对重复 4xx/5xx、429 与 Durable Object 排队时间设置告警，但不要记录请求头或请求正文。

## 8. 数据治理

D1 云历史包含同步消息、附件提取文本和生成产物；管理审计包含 IP、消息正文、System Prompt、模型与回复，但不包含原始附件二进制或 Key。部署者应：

- 发布隐私说明并解释审计目的。
- 设置自动删除或明确保留周期。
- 限制 D1 与管理员接口的人员权限。
- 响应用户的数据访问与删除请求。
- 不把聊天内容发送到无关分析服务。
- CP access/refresh token 仅用于回调期间获取 userinfo，不持久化；本地会话 D1 只保存 SHA-256 哈希。
- 引导答案以用户 ID 与版本为 AAD 加密保存，Provider Key 与私人助手 Key始终只保存在浏览器。
- 对话删除后正文立即移除，仅保留 30 天 ID 墓碑；定期清理过期墓碑和审计数据。

## 9. 回滚

Workers 代码可使用 Cloudflare 版本回滚。Durable Object migration 与 D1 schema 不能仅靠代码回滚恢复，因此在修改 migration 或 schema 前先导出 D1，并采用新的 migration tag。
