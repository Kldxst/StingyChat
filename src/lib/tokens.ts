import type { ChatMessage } from '../types';

const CJK = /[\u3400-\u9fff\uf900-\ufaff]/u;
let encodingPromise: Promise<import('js-tiktoken').Tiktoken> | undefined;

export function estimateTokens(text: string): number {
  if (!text.trim()) return 0;
  let cjk = 0;
  let ascii = '';
  for (const char of text) {
    if (CJK.test(char)) cjk += 1;
    else ascii += char;
  }
  const words = ascii.trim().split(/\s+/u).filter(Boolean);
  const wordTokens = words.reduce((total, word) => total + Math.max(1, Math.ceil(word.length / 4)), 0);
  const punctuation = (ascii.match(/[^\p{L}\p{N}\s]/gu) ?? []).length;
  return Math.max(1, cjk + wordTokens + Math.ceil(punctuation / 2));
}

export async function estimateTokensForModel(text: string, model: string): Promise<{ tokens: number; source: 'tiktoken' | 'heuristic' }> {
  if (!/^(?:gpt-|o\d|chatgpt-)/iu.test(model)) return { tokens: estimateTokens(text), source: 'heuristic' };
  try {
    encodingPromise ??= import('js-tiktoken').then(({ getEncoding }) => getEncoding('cl100k_base'));
    const encoding = await encodingPromise;
    return { tokens: encoding.encode(text).length, source: 'tiktoken' };
  } catch {
    return { tokens: estimateTokens(text), source: 'heuristic' };
  }
}

export function estimateMessages(messages: Array<Pick<ChatMessage, 'role' | 'content'>>): number {
  return messages.reduce((total, message) => total + estimateTokens(message.content) + 4, 2);
}

export function formatTokenCount(value: number): string {
  return new Intl.NumberFormat('zh-CN').format(Math.max(0, Math.round(value)));
}
