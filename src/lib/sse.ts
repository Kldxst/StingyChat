import type { StreamEvent } from '../types';

export class ChatResponseError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code?: string,
    public readonly issues?: Array<{ path: string; code: string; message: string }>,
  ) {
    super(message);
  }
}

export async function consumeEventStream(
  response: Response,
  onEvent: (event: StreamEvent) => void,
): Promise<void> {
  if (!response.ok) {
    const body = (await response.json().catch(() => undefined)) as {
      error?: string;
      code?: string;
      issues?: Array<{ path: string; code: string; message: string }>;
    } | undefined;
    throw new ChatResponseError(body?.error || `请求失败 (${response.status})`, response.status, body?.code, body?.issues);
  }
  if (!response.body) throw new Error('服务器未返回流');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const frames = buffer.split('\n\n');
    buffer = frames.pop() ?? '';
    for (const frame of frames) {
      const data = frame
        .split('\n')
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).trim())
        .join('');
      if (!data) continue;
      onEvent(JSON.parse(data) as StreamEvent);
    }
  }
}
