import type { ChatRequest } from '../src/types';
import { executeGlmTask, GlmUpstreamError, glmCandidates, type GlmCandidate, type GlmTask, type WorkerEnv } from './glm';
import { ProviderUpstreamError, streamProvider } from './providers';

interface BaseJob {
  requestId: string;
  operation: string;
  queuedAt: number;
  attempted: Set<string>;
  resolve: (response: Response) => void;
}

interface AssistJob extends BaseJob {
  kind: 'assist';
  task: GlmTask;
}

interface StreamJob extends BaseJob {
  kind: 'stream';
  request: ChatRequest;
}

type PendingJob = AssistJob | StreamJob;

interface HealthState {
  recent429: number[];
  cooldownUntil: number;
}

interface StatusRecord {
  state: 'waiting' | 'running' | 'completed' | 'failed';
  operation: string;
  queuedAt: number;
  poolExhausted?: boolean;
}

const json = (value: unknown, status = 200) => Response.json(value, { status, headers: { 'Cache-Control': 'no-store' } });

export class GlmScheduler {
  private readonly queue: PendingJob[] = [];
  private readonly running = new Set<string>();
  private readonly health = new Map<string, HealthState>();
  private readonly statuses = new Map<string, StatusRecord>();
  private averageDurationMs = 8_000;

  constructor(_state: DurableObjectState, private readonly env: WorkerEnv) {}

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === 'GET' && url.pathname.startsWith('/status/')) return this.status(url);
    if (request.method === 'POST' && url.pathname === '/run') {
      const task = await request.json<GlmTask>();
      if (!task.requestId || !task.operation || !task.system || !task.user) return json({ error: 'GLM 任务格式无效' }, 400);
      return this.enqueue({ kind: 'assist', requestId: task.requestId, operation: task.operation, task });
    }
    if (request.method === 'POST' && url.pathname === '/stream') {
      const body = await request.json<{ requestId?: string; operation?: string; request?: ChatRequest }>();
      if (!body.requestId || !body.operation || !body.request?.conversationId) return json({ error: 'GLM 流式任务格式无效' }, 400);
      return this.enqueue({ kind: 'stream', requestId: body.requestId, operation: body.operation, request: body.request });
    }
    return json({ error: 'Not found' }, 404);
  }

  private status(url: URL): Response {
    const requestId = decodeURIComponent(url.pathname.slice('/status/'.length));
    const status = this.statuses.get(requestId);
    if (!status) return json({ error: '队列任务不存在或已过期' }, 404);
    const position = status.state === 'waiting'
      ? Math.max(1, this.queue.findIndex((job) => job.requestId === requestId) + 1)
      : 0;
    const slots = Math.max(1, glmCandidates(this.env).length);
    return json({
      requestId,
      state: status.state,
      operation: status.operation,
      position,
      queuedAt: status.queuedAt,
      estimatedWaitMs: Math.ceil(position / slots) * this.averageDurationMs,
      poolExhausted: status.poolExhausted,
    });
  }

  private enqueue(job: Omit<AssistJob, 'queuedAt' | 'attempted' | 'resolve'> | Omit<StreamJob, 'queuedAt' | 'attempted' | 'resolve'>): Promise<Response> {
    return new Promise<Response>((resolve) => {
      const queuedAt = Date.now();
      const pending = { ...job, queuedAt, attempted: new Set<string>(), resolve } as PendingJob;
      this.queue.push(pending);
      this.statuses.set(job.requestId, { state: 'waiting', operation: job.operation, queuedAt });
      this.dispatch();
    });
  }

  private dispatch(): void {
    const now = Date.now();
    const candidates = glmCandidates(this.env).filter((candidate) => {
      const health = this.health.get(candidate.id);
      return !this.running.has(candidate.id) && (!health || health.cooldownUntil <= now);
    });
    for (const candidate of candidates) {
      const index = this.queue.findIndex((job) => !job.attempted.has(candidate.id));
      if (index < 0) continue;
      const [job] = this.queue.splice(index, 1);
      job.attempted.add(candidate.id);
      this.running.add(candidate.id);
      this.statuses.set(job.requestId, { state: 'running', operation: job.operation, queuedAt: job.queuedAt });
      void this.run(job, candidate);
    }
    if (this.queue.length && !candidates.length && !this.running.size) {
      const availableSoon = glmCandidates(this.env).some((candidate) => (this.health.get(candidate.id)?.cooldownUntil ?? 0) <= now);
      if (!availableSoon) this.failExhausted();
    }
  }

  private async run(job: PendingJob, candidate: GlmCandidate): Promise<void> {
    const started = Date.now();
    try {
      if (job.kind === 'assist') {
        const result = await executeGlmTask(candidate, job.task);
        this.health.delete(candidate.id);
        this.finish(job, json(result), 'completed');
        this.release(candidate.id, started);
        return;
      }
      const response = await streamProvider(job.request, candidate.apiKey, candidate.baseUrl);
      this.health.delete(candidate.id);
      this.resolveStream(job, candidate.id, response, started);
    } catch (error) {
      if ((error instanceof GlmUpstreamError || error instanceof ProviderUpstreamError) && error.status === 429) this.record429(candidate.id);
      const candidateCount = glmCandidates(this.env).length;
      if (job.attempted.size < candidateCount) {
        this.queue.unshift(job);
        this.statuses.set(job.requestId, { state: 'waiting', operation: job.operation, queuedAt: job.queuedAt });
      } else {
        const limited = (error instanceof GlmUpstreamError || error instanceof ProviderUpstreamError) && error.status === 429;
        this.finish(job, json({ error: limited ? '内置 GLM 请求已达到频率限制' : '内置 GLM 暂不可用', code: 'GLM_POOL_EXHAUSTED' }, 503), 'failed', true);
      }
      this.release(candidate.id, started, false);
    }
  }

  private resolveStream(job: StreamJob, candidateId: string, response: Response, started: number): void {
    const reader = response.body!.getReader();
    let released = false;
    const release = (state: 'completed' | 'failed') => {
      if (released) return;
      released = true;
      this.rememberStatus(job, state);
      this.release(candidateId, started, state === 'completed');
    };
    const stream = new ReadableStream<Uint8Array>({
      async pull(controller) {
        try {
          const { done, value } = await reader.read();
          if (done) {
            controller.close();
            release('completed');
          } else {
            controller.enqueue(value);
          }
        } catch (error) {
          controller.error(error);
          release('failed');
        }
      },
      async cancel(reason) {
        await reader.cancel(reason);
        release('failed');
      },
    });
    job.resolve(new Response(stream, { status: response.status, headers: response.headers }));
  }

  private release(candidateId: string, started: number, updateDuration = true): void {
    if (updateDuration) this.averageDurationMs = Math.round(this.averageDurationMs * 0.75 + (Date.now() - started) * 0.25);
    this.running.delete(candidateId);
    this.dispatch();
  }

  private record429(candidateId: string): void {
    const now = Date.now();
    const previous = this.health.get(candidateId) ?? { recent429: [], cooldownUntil: 0 };
    const recent429 = [...previous.recent429.filter((value) => now - value <= 5 * 60_000), now];
    this.health.set(candidateId, {
      recent429,
      cooldownUntil: recent429.length >= 3 ? now + 10 * 60_000 : previous.cooldownUntil,
    });
  }

  private rememberStatus(job: PendingJob, state: 'completed' | 'failed', poolExhausted = false): void {
    this.statuses.set(job.requestId, { state, operation: job.operation, queuedAt: job.queuedAt, poolExhausted });
    setTimeout(() => this.statuses.delete(job.requestId), 2 * 60_000);
  }

  private finish(job: PendingJob, response: Response, state: 'completed' | 'failed', poolExhausted = false): void {
    this.rememberStatus(job, state, poolExhausted);
    job.resolve(response);
  }

  private failExhausted(): void {
    while (this.queue.length) {
      const job = this.queue.shift()!;
      this.finish(job, json({ error: '所有内置 GLM 凭据均在冷却中', code: 'GLM_POOL_EXHAUSTED' }, 503), 'failed', true);
    }
  }
}
