interface DeadlineResult<T> {
  value: T;
  timedOut: boolean;
  durationMs: number;
}

export async function withinDeadline<T>(
  task: Promise<T>,
  timeoutMs: number,
  fallback: T,
  signal?: AbortSignal,
): Promise<DeadlineResult<T>> {
  const startedAt = performance.now();
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<DeadlineResult<T>>((resolve) => {
    timer = setTimeout(() => resolve({ value: fallback, timedOut: true, durationMs: performance.now() - startedAt }), timeoutMs);
  });
  let abortHandler: (() => void) | undefined;
  const aborted = new Promise<never>((_resolve, reject) => {
    abortHandler = () => reject(new DOMException('Aborted', 'AbortError'));
    signal?.addEventListener('abort', abortHandler, { once: true });
  });
  try {
    return await Promise.race([
      task.then((value) => ({ value, timedOut: false, durationMs: performance.now() - startedAt })),
      timeout,
      aborted,
    ]);
  } finally {
    if (timer) clearTimeout(timer);
    if (abortHandler) signal?.removeEventListener('abort', abortHandler);
  }
}

export function heuristicTokenEstimate(text: string) {
  const cjk = (text.match(/[\u3400-\u9fff]/gu) ?? []).length;
  const rest = text.replace(/[\u3400-\u9fff]/gu, '').length;
  return cjk + Math.max(0, Math.ceil(rest / 4));
}
