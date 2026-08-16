# Cloudflare Workers 部署

## 前置要求

- Node.js 20+、npm 10+
- Wrangler 已登录目标 Cloudflare 账户
- 一个 D1 数据库
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
```

如不需要管理员审计，可删除 `ADMIN_DB` binding；后台会显示数据库未配置。

## 3. Durable Object

`wrangler.jsonc` 已包含 `GLM_SCHEDULER` binding 与 `v1-glm-scheduler` migration。首次部署会创建 SQLite Durable Object class。不要重复使用同一个 migration tag 声明不同 class。

## 4. Secret

```powershell
npx wrangler secret put GLM_API_KEY
npx wrangler secret put FREE_GLM_API_KEY
npx wrangler secret put GLM_FALLBACK_API_KEYS
npx wrangler secret put ADMIN_PASSWORD
```

非敏感的 `GLM_VISION_MODEL` 默认是 `GLM-4.6V-Flash`，用于目标模型不支持图片时的描述/OCR 回退。上线前应按智谱当前模型目录确认该名称在部署账户可用；若不同，在 `wrangler.jsonc` 或本地 `.dev.vars` 中覆盖。

备用 Key 的输入是 JSON，例如：

```json
["rotated-key-1","rotated-key-2"]
```

Secret 不应出现在 `wrangler.jsonc`、`.dev.vars.example`、GitHub Actions 日志或 README。开发对话中曾出现的 Key 一律先撤销，不能作为生产 Secret 继续使用。

## 5. 部署

```powershell
npm run deploy
```

部署后检查：

```powershell
Invoke-RestMethod https://YOUR_WORKER/api/health
```

然后在浏览器分别验证免费模型、个人 Key、提示词优化、System Prompt、语义增强、GLM 搜索回退、原生搜索、附件、长对话滚动和队列饱和提示。

## 6. Access 与 WAF

在 Zero Trust 中为 Beta 域名创建 Access Application，只允许指定邮箱或域名。管理员后台必须纳入同一策略，不应只依赖隐藏入口和密码。

建议设置：

- `/api/admin/login`：严格速率限制与 Bot 防护。
- `/api/assist/*`、`/api/conversation/compress`：按 IP 与会话限流。
- `/api/chat/stream`：限制并发连接与异常请求体。
- 最大请求体至少覆盖单张 4 MB 图片的 Base64，仍应拦截异常大请求。
- 对重复 4xx/5xx、429 与 Durable Object 排队时间设置告警，但不要记录请求头或请求正文。

## 7. 数据治理

D1 管理审计包含 IP、消息正文、System Prompt、模型与回复，但不包含附件正文或 Key。部署者应：

- 发布隐私说明并解释审计目的。
- 设置自动删除或明确保留周期。
- 限制 D1 与管理员接口的人员权限。
- 响应用户的数据访问与删除请求。
- 不把聊天内容发送到无关分析服务。

## 8. 回滚

Workers 代码可使用 Cloudflare 版本回滚。Durable Object migration 与 D1 schema 不能仅靠代码回滚恢复，因此在修改 migration 或 schema 前先导出 D1，并采用新的 migration tag。
