export function fallbackOptimizePrompt(text: string): string {
  return text
    .replace(/(?:麻烦|请问|劳驾|辛苦)(?:你)?(?:帮我|帮助我)?/gu, '')
    .replace(/(?:谢谢|感谢)(?:你)?[！!。.]*/gu, '')
    .replace(/[ \t]+/gu, ' ')
    .replace(/\n{3,}/gu, '\n\n')
    .trim();
}

export function fallbackSystemPrompt(description: string): string {
  const role = description.trim().replace(/\s+/gu, ' ');
  return [
    `角色：${role}`,
    '目标：准确完成用户任务，优先遵守明确约束和输出格式。',
    '执行：先识别目标、输入与限制；信息不足时明确指出，不虚构事实或工具结果。',
    '输出：直接给出可用结果，省略寒暄、复述和无信息总结。',
    '边界：不得扩大权限；涉及不确定信息时标注假设与依据。',
  ].join('\n');
}

export function fallbackCacheKey(text: string): string {
  return text.replace(/\s+/gu, ' ').trim();
}

export function fallbackRoute(prompt: string, needsWebSearch: boolean, needsReasoning: boolean) {
  const complex = needsWebSearch || needsReasoning || prompt.length > 240 || /分析|规划|证明|审查|推理|比较|架构/u.test(prompt);
  return { route: complex ? 'complex' as const : 'simple' as const, reason: complex ? '启发式判定为复杂任务' : '启发式判定为轻量任务' };
}

export function fallbackCacheMatch(prompt: string, candidatePrompt: string) {
  const normalize = (value: string) => value.replace(/\s+/gu, ' ').trim().toLowerCase();
  const equivalent = normalize(prompt) === normalize(candidatePrompt);
  return { equivalent, reason: equivalent ? '规范文本完全一致' : '降级模式仅接受精确匹配' };
}

export function fallbackMemory(messages: Array<{ role: string; content: string }>) {
  const summary = messages
    .slice(-10)
    .map((message) => `${message.role}: ${message.content.replace(/\s+/gu, ' ').trim()}`)
    .join('\n')
    .slice(-6_000);
  return { summary, facts: [], preferences: [], openTasks: [], constraints: [], citations: [] };
}
