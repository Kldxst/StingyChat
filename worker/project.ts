import { z } from 'zod';
import type { PersonalAssistantCredentials, WorkerEnv } from './glm';
import { callGlm, parseJsonObject } from './glm';

export const projectAgentSchema = z.object({
  projectId: z.string().uuid(),
  prompt: z.string().min(1).max(100_000),
  permissionMode: z.enum(['read', 'workspace', 'full']),
  activeFile: z.object({ path: z.string().max(500), content: z.string().max(100_000), language: z.string().max(100) }).optional(),
  fileIndex: z.array(z.object({ path: z.string().max(500), language: z.string().max(100), size: z.number().int().nonnegative() })).max(2_000),
});

const projectResultSchema = z.object({ summary: z.string().min(1).max(100_000), files: z.array(z.object({ path: z.string().min(1).max(500), content: z.string().max(500_000) })).max(20).default([]) });

export async function runProjectAgent(env: WorkerEnv, input: z.infer<typeof projectAgentSchema>, personalAssistant?: PersonalAssistantCredentials | string, requestId?: string) {
  const canWrite = input.permissionMode !== 'read';
  const system = [
    '你是 StingyChat 工程智能助手。只输出严格 JSON：{"summary":"面向用户的简洁结果","files":[{"path":"相对路径","content":"完整文件内容"}]}。',
    '不得使用 ..、绝对路径或虚构已执行的命令。仅在给定活动文件足以安全修改时返回 files；信息不足时在 summary 中列出还需要读取的文件。',
    canWrite ? '当前允许提出授权项目根目录内的文件修改。' : '当前为只读模式，files 必须为空数组。',
  ].join('\n');
  const context = JSON.stringify({ task: input.prompt, permissionMode: input.permissionMode, activeFile: input.activeFile, fileIndex: input.fileIndex });
  const content = await callGlm(env, system, context, 0.15, personalAssistant, requestId, 'project-agent');
  const parsed = projectResultSchema.parse(parseJsonObject(content));
  return { ...parsed, files: canWrite ? parsed.files.filter((file) => !file.path.startsWith('/') && !file.path.includes('..')) : [] };
}

