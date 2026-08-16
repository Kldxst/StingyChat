import { compress } from 'prompt-compressor';
import { encode as encodeToon } from '@toon-format/toon';
import type {
  ChatMessage,
  ConversationMemory,
  OptimizationSettings,
  OutputContract,
} from '../types';
import { estimateMessages, estimateTokens } from './tokens';

const POLITE_PATTERNS = [
  /(?:麻烦|劳烦|辛苦)(?:你)?(?:帮我|帮忙)?/gu,
  /请问(?:一下)?/gu,
  /(?:谢谢|感谢)(?:你|您的)?(?:解答|帮助)?[。！!]?/gu,
  /希望(?:你|您)能够/gu,
];

const OUTPUT_CONTRACTS: Record<OutputContract, string> = {
  concise: '惜字如金。直接回答，禁止寒暄、复述问题和总结性废话。',
  json: '只输出合法 JSON，不使用 Markdown 代码块，不添加解释。',
  code: '只输出代码本身，不使用 Markdown 代码块，不添加解释。',
  choice: '只输出选项字母，不添加解释。',
  free: '',
};

interface PromptOptimizationResult {
  original: string;
  optimized: string;
  tokensBefore: number;
  tokensAfter: number;
  saved: number;
  steps: string[];
}

export function removeChinesePoliteness(text: string): string {
  return POLITE_PATTERNS.reduce((value, pattern) => value.replace(pattern, ''), text)
    .replace(/^[，,、\s]+/u, '')
    .replace(/[ \t]+/gu, ' ')
    .replace(/\n{3,}/gu, '\n\n')
    .trim();
}

export function deduplicateInstructions(text: string): string {
  const seen = new Set<string>();
  return text
    .split(/(?<=[。！？!?\n])/u)
    .filter((part) => {
      const normalized = part.replace(/[\s，。！？,.!?]/gu, '').toLocaleLowerCase();
      if (!normalized || !seen.has(normalized)) {
        if (normalized) seen.add(normalized);
        return true;
      }
      return false;
    })
    .join('')
    .trim();
}

export function optimizePromptLocally(
  prompt: string,
  settings: OptimizationSettings,
): PromptOptimizationResult {
  let optimized = prompt;
  const steps: string[] = [];
  if (settings.ruleCompression) {
    const result = compress(optimized, settings.extremeMode ? 'low' : 'very-low');
    optimized = result.output;
    steps.push('规则压缩');
  }
  if (settings.removePoliteness) {
    optimized = removeChinesePoliteness(optimized);
    steps.push('移除客套语');
  }
  optimized = deduplicateInstructions(optimized);
  if (settings.structuredPrompt && optimized.length > 80) {
    optimized = `任务：完成下列请求\n输入：${optimized}\n输出：准确、直接的结果\n格式：${OUTPUT_CONTRACTS[settings.outputContract] || '遵循请求中的格式'}`;
    steps.push('结构化指令');
  }
  if (settings.chipProtocol) {
    optimized = optimized
      .replace(/^任务：/u, 'T:')
      .replace(/\n输入：/gu, '\nI:')
      .replace(/\n输出：/gu, '\nO:')
      .replace(/\n格式：/gu, '\nF:');
    steps.push('CHIP 风格高密度协议');
  }
  const tokensBefore = estimateTokens(prompt);
  const tokensAfter = estimateTokens(optimized);
  return {
    original: prompt,
    optimized,
    tokensBefore,
    tokensAfter,
    saved: Math.max(0, tokensBefore - tokensAfter),
    steps,
  };
}

export function buildSystemPrompt(base: string, settings: OptimizationSettings): string {
  const parts = [base.trim()];
  if (settings.concisePersona || settings.outputContract !== 'free') {
    parts.push(OUTPUT_CONTRACTS[settings.outputContract || 'concise']);
  }
  if (settings.fewShotExamples.length) {
    parts.push(
      `风格示例：\n${settings.fewShotExamples
        .map((example) => `问：${example.input}\n答：${example.output}`)
        .join('\n')}`,
    );
  }
  return parts.filter(Boolean).join('\n\n');
}

export function memoryToPrompt(memory: ConversationMemory): string {
  if (!memory.summary.trim()) return '';
  return [
    `对话长期记忆：${memory.summary}`,
    memory.facts.length ? `事实：${memory.facts.join('；')}` : '',
    memory.preferences.length ? `偏好：${memory.preferences.join('；')}` : '',
    memory.openTasks.length ? `未完成：${memory.openTasks.join('；')}` : '',
    memory.constraints.length ? `约束：${memory.constraints.join('；')}` : '',
    memory.citations.length ? `引用：${memory.citations.join('；')}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

export function memoryToCompactPrompt(memory: ConversationMemory, useToon: boolean): string {
  if (!useToon || !memory.summary.trim()) return memoryToPrompt(memory);
  return `对话长期记忆（TOON）：\n${encodeToon({
    summary: memory.summary,
    facts: memory.facts,
    preferences: memory.preferences,
    openTasks: memory.openTasks,
    constraints: memory.constraints,
    citations: memory.citations,
  })}`;
}

export function selectContext(
  messages: ChatMessage[],
  memory: ConversationMemory,
  contextWindow: number,
  threshold: number,
): { messages: Array<Pick<ChatMessage, 'role' | 'content' | 'attachments'>>; shouldCompress: boolean; estimatedTokens: number } {
  const budget = Math.max(512, Math.floor(contextWindow * threshold));
  const result: Array<Pick<ChatMessage, 'role' | 'content' | 'attachments'>> = [];
  let used = estimateTokens(memoryToPrompt(memory));
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    const cost = estimateTokens(message.content) + 4;
    if (result.length >= 4 && used + cost > budget) break;
    result.unshift({ role: message.role, content: message.content, attachments: message.attachments });
    used += cost;
  }
  const fullEstimate = estimateMessages(messages);
  return {
    messages: result,
    shouldCompress: messages.length > result.length && fullEstimate > budget,
    estimatedTokens: used,
  };
}

export function applyExtremeMode(settings: OptimizationSettings, enabled: boolean): OptimizationSettings {
  if (!enabled) return { ...settings, extremeMode: false };
  return {
    ...settings,
    ruleCompression: true,
    removePoliteness: true,
    structuredPrompt: true,
    chipProtocol: true,
    concisePersona: true,
    automaticContextCompression: true,
    promptCache: true,
    semanticCache: true,
    semanticHitEnhancement: true,
    modelRouting: true,
    jitRetrieval: true,
    toonStructured: true,
    outputContract: 'concise',
    temperature: Math.min(settings.temperature, 0.4),
    topP: Math.min(settings.topP, 0.8),
    extremeMode: true,
  };
}
