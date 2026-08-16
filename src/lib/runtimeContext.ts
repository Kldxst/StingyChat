import type { ClientRuntimeContext } from '../types';

export function captureClientRuntimeContext(now = new Date()): ClientRuntimeContext {
  const resolved = Intl.DateTimeFormat().resolvedOptions();
  return {
    nowIso: now.toISOString(),
    localTime: new Intl.DateTimeFormat(resolved.locale || 'zh-CN', {
      dateStyle: 'full', timeStyle: 'long', timeZone: resolved.timeZone,
    }).format(now),
    timeZone: resolved.timeZone || 'UTC',
    locale: resolved.locale || navigator.language || 'zh-CN',
    utcOffsetMinutes: -now.getTimezoneOffset(),
  };
}

export function runtimeContextPrompt(context: ClientRuntimeContext): string {
  const absoluteOffset = Math.abs(context.utcOffsetMinutes);
  const sign = context.utcOffsetMinutes >= 0 ? '+' : '-';
  const offset = `${sign}${String(Math.floor(absoluteOffset / 60)).padStart(2, '0')}:${String(absoluteOffset % 60).padStart(2, '0')}`;
  return [
    '当前运行上下文（回答日期、时间和时效性问题时以此为准）：',
    `- 当前 UTC 时间：${context.nowIso}`,
    `- 用户本地时间：${context.localTime}`,
    `- 用户时区：${context.timeZone}（UTC${offset}）`,
    `- 用户语言区域：${context.locale}`,
    '- 若任务依赖最新事实但未启用联网，请明确说明知识时效边界，不要猜测当前日期。',
  ].join('\n');
}
