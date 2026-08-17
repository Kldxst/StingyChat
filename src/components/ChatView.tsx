import { Bot, BrainCircuit, Check, Copy, FileText, LoaderCircle, RotateCcw, Sparkles, User } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { isValidElement, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ComponentPropsWithoutRef, type ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import rehypeHighlight from 'rehype-highlight';
import rehypeKatex from 'rehype-katex';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import {
  compressConversation,
  generateConversationTitle,
  normalizeForSemanticCache,
  optimizeWithGlm,
  routePrompt,
  streamChat,
  validateCacheMatch,
  reasonWithGlm,
  searchWithGlm,
  understandImageWithGlm,
} from '../lib/api';
import { loadProviderSecret } from '../lib/crypto';
import { knowledgeCorpusTextLength, retrieveKnowledge } from '../lib/knowledge';
import { retrieveAttachmentText } from '../lib/attachments';
import {
  buildSystemPrompt,
  memoryToPrompt,
  memoryToCompactPrompt,
  optimizePromptLocally,
  selectContext,
} from '../lib/optimization';
import {
  conversationFingerprint,
  findCacheCandidate,
  saveCacheEntry,
} from '../lib/semantic';
import { estimateMessages, estimateTokens, estimateTokensForModel } from '../lib/tokens';
import { estimateAttachmentTokens } from '../lib/tokenLedger';
import { heuristicTokenEstimate, withinDeadline } from '../lib/preparation';
import { autoSelectSkillIds, buildSkillsPrompt, executePostflightSkills, executePreflightSkills, skillName } from '../lib/skills';
import { captureClientRuntimeContext, runtimeContextPrompt } from '../lib/runtimeContext';
import { requiresUserApiKey } from '../lib/providerAuth';
import { ChatResponseError } from '../lib/sse';
import { useAppStore } from '../store';
import type {
  ChatMessage,
  ChatAttachment,
  KnowledgeCitation,
  ProviderProfile,
  SemanticCacheEntry,
  TokenTelemetry,
} from '../types';
import { Composer } from './Composer';
import { TokenInfo } from './TokenInfo';
import { IconButton, Modal } from './ui';

interface PromptPreview {
  original: string;
  optimized: string;
  localSaved: number;
}

interface CacheProposal {
  prompt: string;
  userMessageId: string;
  attachments: ChatAttachment[];
  skillIds: string[];
  candidate: SemanticCacheEntry;
  fingerprint: string;
  routeReason?: string;
}

const QUICK_PROMPT_POOL = [
  '把这段会议记录整理成行动项', '修复这段 JSON 并只返回结果', '计算这组数据的增长率',
  '审查这段代码中的潜在缺陷', '从附件中提取关键结论', '把需求拆成可执行任务',
  '生成一个可下载的 Markdown 报告', '比较两个方案的成本与风险', '将这段内容准确翻译成英文',
  '搜索最新资料并列出来源', '用三句话解释这个概念', '把表格数据整理成摘要',
];

function quickPromptsFor(id: string): string[] {
  let seed = 0;
  for (const char of id) seed = (seed * 31 + char.charCodeAt(0)) >>> 0;
  const pool = [...QUICK_PROMPT_POOL];
  const result: string[] = [];
  while (result.length < 3 && pool.length) {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    result.push(...pool.splice(seed % pool.length, 1));
  }
  return result;
}

export interface GroupedCitation {
  documentName: string;
  bestScore: number;
  excerpts: string[];
  chunkCount: number;
  url?: string;
  sourceType?: KnowledgeCitation['sourceType'];
}

export function groupCitations(citations: KnowledgeCitation[]): GroupedCitation[] {
  const groups = new Map<string, GroupedCitation>();
  for (const citation of citations) {
    const current = groups.get(citation.documentName);
    if (current) {
      current.chunkCount += 1;
      current.bestScore = Math.max(current.bestScore, citation.score);
      if (!current.excerpts.includes(citation.excerpt)) current.excerpts.push(citation.excerpt);
    } else {
      groups.set(citation.documentName, {
        documentName: citation.documentName,
        bestScore: citation.score,
        excerpts: [citation.excerpt],
        chunkCount: 1,
        url: citation.url,
        sourceType: citation.sourceType,
      });
    }
  }
  return [...groups.values()].toSorted((a, b) => b.bestScore - a.bestScore);
}

function makeMessage(role: 'user' | 'assistant', content: string, attachments?: ChatAttachment[], skillIds?: string[]): ChatMessage {
  return { id: crypto.randomUUID(), role, content, createdAt: Date.now(), attachments, skillIds };
}

function textFromNode(node: ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textFromNode).join('');
  if (isValidElement<{ children?: ReactNode }>(node)) return textFromNode(node.props.children);
  return '';
}

function CodeBlock({ children }: { children?: ReactNode }) {
  const [copied, setCopied] = useState(false);
  const text = textFromNode(children).replace(/\n$/u, '');
  return (
    <div className="code-block-shell">
      <button
        type="button"
        className="code-copy"
        onClick={() => {
          void navigator.clipboard.writeText(text);
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1200);
        }}
        aria-label="复制代码"
      >
        {copied ? <Check size={14} /> : <Copy size={14} />}
      </button>
      <pre>{children}</pre>
    </div>
  );
}

export function normalizeMathDelimiters(markdown: string): string {
  return markdown
    .split(/(```[\s\S]*?```|`[^`\n]*`)/gu)
    .map((part, index) => index % 2 === 1
      ? part
      : part
          .replace(/\\\[([\s\S]*?)\\\]/gu, (_match, formula: string) => `\n$$\n${formula.trim()}\n$$\n`)
          .replace(/\\\(([\s\S]*?)\\\)/gu, (_match, formula: string) => `$${formula.trim()}$`))
    .join('');
}

function MathSpan({ className, children, ...props }: ComponentPropsWithoutRef<'span'>) {
  const ref = useRef<HTMLSpanElement>(null);
  const display = className?.split(/\s+/u).includes('katex-display');
  if (!display) return <span className={className} {...props}>{children}</span>;
  return (
    <span className="math-shell">
      <span ref={ref} className={className} {...props}>{children}</span>
      <button
        type="button"
        className="math-copy"
        aria-label="复制公式"
        onClick={() => {
          const formula = ref.current?.querySelector('annotation[encoding="application/x-tex"]')?.textContent;
          if (formula) void navigator.clipboard.writeText(formula);
        }}
      >
        <Copy size={13} />
      </button>
    </span>
  );
}

export function MarkdownContent({ children }: { children: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm, remarkMath]}
      rehypePlugins={[[rehypeKatex, { throwOnError: false, strict: 'ignore' }], rehypeHighlight]}
      components={{ pre: CodeBlock, span: MathSpan }}
    >
      {normalizeMathDelimiters(children)}
    </ReactMarkdown>
  );
}

export function ChatView() {
  const activeId = useAppStore((state) => state.activeConversationId);
  const conversations = useAppStore((state) => state.conversations);
  const profiles = useAppStore((state) => state.profiles);
  const settings = useAppStore((state) => state.settings);
  const personalization = useAppStore((state) => state.personalization);
  const appendMessage = useAppStore((state) => state.appendMessage);
  const updateConversation = useAppStore((state) => state.updateConversation);
  const setSettingsOpen = useAppStore((state) => state.setSettingsOpen);
  const setActiveArtifact = useAppStore((state) => state.setActiveArtifact);
  const conversation = useMemo(
    () => conversations.find((item) => item.id === activeId),
    [activeId, conversations],
  );
  const profile = profiles.find((item) => item.id === conversation?.providerProfileId) ?? profiles[0];

  const [busy, setBusy] = useState(false);
  const [liveText, setLiveText] = useState('');
  const [liveReasoning, setLiveReasoning] = useState('');
  const [error, setError] = useState('');
  const [errorDetails, setErrorDetails] = useState<string[]>([]);
  const [preparationPhase, setPreparationPhase] = useState('');
  const [preview, setPreview] = useState<PromptPreview>();
  const [sentPromptPreview, setSentPromptPreview] = useState<ChatMessage>();
  const [replacement, setReplacement] = useState<string>();
  const [cacheProposal, setCacheProposal] = useState<CacheProposal>();
  const messagesRef = useRef<HTMLDivElement>(null);
  const messagesContentRef = useRef<HTMLDivElement>(null);
  const shouldFollowRef = useRef(true);
  const forceFollowUntilRef = useRef(0);
  const scrollFrameRef = useRef<number[]>([]);
  const revealQueueRef = useRef<string[]>([]);
  const revealTextRef = useRef('');
  const revealFrameRef = useRef<number | undefined>(undefined);
  const abortRef = useRef<AbortController | undefined>(undefined);
  const skipEnhancementRef = useRef<(() => void) | undefined>(undefined);
  const clearReplacement = useCallback(() => setReplacement(undefined), []);
  const quickPrompts = useMemo(() => quickPromptsFor(conversation?.id ?? ''), [conversation?.id]);

  const scrollToBottom = useCallback(() => {
    scrollFrameRef.current.forEach(cancelAnimationFrame);
    const first = requestAnimationFrame(() => {
      const second = requestAnimationFrame(() => {
        const container = messagesRef.current;
        if (container) container.scrollTop = container.scrollHeight;
      });
      scrollFrameRef.current = [second];
    });
    scrollFrameRef.current = [first];
  }, []);

  useLayoutEffect(() => {
    shouldFollowRef.current = true;
    forceFollowUntilRef.current = performance.now() + 550;
    scrollToBottom();
    const timers = [120, 360].map((delay) => window.setTimeout(scrollToBottom, delay));
    return () => timers.forEach(window.clearTimeout);
  }, [activeId, scrollToBottom]);

  useEffect(() => {
    const content = messagesContentRef.current;
    if (!content) return;
    const observer = new ResizeObserver(() => {
      if (shouldFollowRef.current) scrollToBottom();
    });
    observer.observe(content);
    return () => {
      observer.disconnect();
      scrollFrameRef.current.forEach(cancelAnimationFrame);
    };
  }, [scrollToBottom]);

  const scheduleReveal = useCallback(() => {
    if (revealFrameRef.current !== undefined) return;
    const paint = () => {
      const queued = revealQueueRef.current.length;
      // Drain a burst in at most five frames so rendering does not lag a fast upstream.
      const count = Math.min(queued, Math.max(12, Math.ceil(queued / 5)));
      if (count) {
        revealTextRef.current += revealQueueRef.current.splice(0, count).join('');
        setLiveText(revealTextRef.current);
      }
      if (revealQueueRef.current.length) revealFrameRef.current = requestAnimationFrame(paint);
      else revealFrameRef.current = undefined;
    };
    revealFrameRef.current = requestAnimationFrame(paint);
  }, []);

  const runOptimization = useCallback(
    async (text: string) => {
      setError('');
      const local = optimizePromptLocally(text, settings);
      try {
        const optimized = await optimizeWithGlm(local.optimized);
        setPreview({ original: text, optimized, localSaved: local.saved });
      } catch (caught) {
        setPreview({ original: text, optimized: local.optimized, localSaved: local.saved });
        setError(caught instanceof Error ? `${caught.message}，已显示本地优化结果` : '智能优化失败');
      }
    },
    [settings],
  );

  const requestOptimization = useCallback(
    async (text: string) => {
      await runOptimization(text);
    },
    [runOptimization],
  );

  const chooseRoute = async (rawPrompt: string): Promise<{ profile: ProviderProfile; reason?: string }> => {
    if (!settings.modelRouting || settings.pinModel) return { profile };
    if (!settings.simpleProfileId || !settings.complexProfileId) {
      return { profile, reason: '路由未配置，沿用当前模型' };
    }
    try {
      const decision = await routePrompt(rawPrompt, settings.webSearch, settings.reasoningEnabled);
      const targetId = decision.route === 'simple' ? settings.simpleProfileId : settings.complexProfileId;
      const target = profiles.find((item) => item.id === targetId);
      if (!target) return { profile, reason: '目标模型不可用，沿用当前模型' };
      const targetKey = requiresUserApiKey(target) ? await loadProviderSecret(target.id) : 'internal';
      if (!targetKey) return { profile, reason: '路由目标缺少密钥，沿用当前模型' };
      return { profile: target, reason: `${decision.route === 'simple' ? '轻量' : '复杂'}任务 · ${decision.reason}` };
    } catch {
      return { profile, reason: '路由判断失败，沿用当前模型' };
    }
  };

  const patchDelivery = useCallback((conversationId: string, messageId: string, status: ChatMessage['deliveryStatus'], deliveryError?: string) => {
    const current = useAppStore.getState().conversations.find((item) => item.id === conversationId);
    if (!current) return;
    void updateConversation(conversationId, {
      messages: current.messages.map((message) => message.id === messageId
        ? { ...message, deliveryStatus: status, deliveryError }
        : message),
    });
  }, [updateConversation]);

  const sendMessage = async (rawPrompt: string, attachments: ChatAttachment[] = [], skillIds: string[] = [], skipCache = false, retryMessageId?: string): Promise<boolean> => {
    if (!conversation || !profile || busy) return false;
    shouldFollowRef.current = true;
    scrollToBottom();
    setBusy(true);
    setError('');
    setErrorDetails([]);
    setLiveText('');
    setLiveReasoning('');
    setPreparationPhase('正在接收消息');
    const controller = new AbortController();
    abortRef.current = controller;
    revealQueueRef.current = [];
    revealTextRef.current = '';
    const autoSkillIds = settings.autoSkills ? autoSelectSkillIds(rawPrompt, attachments) : [];
    const effectiveSkillIds = [...new Set([...skillIds, ...autoSkillIds])];
    const transientUser = retryMessageId
      ? { ...useAppStore.getState().conversations.find((item) => item.id === conversation.id)?.messages.find((item) => item.id === retryMessageId)!, deliveryStatus: 'preparing' as const, deliveryError: undefined }
      : { ...makeMessage('user', rawPrompt, attachments, effectiveSkillIds), deliveryStatus: 'preparing' as const };
    if (!retryMessageId) await appendMessage(conversation.id, transientUser);
    else patchDelivery(conversation.id, transientUser.id, 'preparing');
    try {
      const assistContext = [memoryToPrompt(conversation.memory), ...conversation.messages.slice(-6).map((message) => `${message.role}: ${message.content}`)]
        .filter(Boolean).join('\n').slice(-20_000);
      setPreparationPhase('正在选择能力与上下文');
      const routePromise = withinDeadline(chooseRoute(rawPrompt), 300, { profile, reason: '路由超时，沿用当前模型' }, controller.signal);
      const retrievalPromise = settings.jitRetrieval ? retrieveKnowledge(rawPrompt, settings.retrievalTopK) : Promise.resolve([]);
      const knowledgeLengthPromise = settings.jitRetrieval ? knowledgeCorpusTextLength() : Promise.resolve(0);
      const cachePromptPromise = settings.semanticHitEnhancement
        ? normalizeForSemanticCache(rawPrompt, assistContext).catch(() => rawPrompt)
        : Promise.resolve(rawPrompt);
      const skillsPromise = executePreflightSkills(effectiveSkillIds, rawPrompt, attachments);
      const [routeResult, retrievalResult, knowledgeResult, cacheResult, skillsResult] = await Promise.all([
        routePromise,
        withinDeadline(retrievalPromise, 150, [], controller.signal),
        withinDeadline(knowledgeLengthPromise, 80, 0, controller.signal),
        withinDeadline(cachePromptPromise, 250, rawPrompt, controller.signal),
        withinDeadline(skillsPromise, 200, { skillIds: [], contextBlocks: [], executions: [] }, controller.signal),
      ]);
      const route = routeResult.value;
      const retrieved = retrievalResult.value;
      const knowledgeTextLength = knowledgeResult.value;
      const cachePrompt = cacheResult.value;
      const skillRun = skillsResult.value;
      const apiKey = requiresUserApiKey(route.profile) ? await loadProviderSecret(route.profile.id) : '';
      if (requiresUserApiKey(route.profile) && !apiKey) {
        setSettingsOpen(true);
        throw new Error(`请先在设置中保存 ${route.profile.name} API Key`);
      }
      let citations = retrieved;
      const attachmentCitations = retrieveAttachmentText(attachments, rawPrompt, settings.retrievalTopK);
      citations = [...attachmentCitations, ...citations].slice(0, 20);
      const fingerprint = await conversationFingerprint(
        conversation,
        `${route.profile.kind}:${route.profile.model}`,
        citations.map((citation) => citation.chunkId),
      );
      if (settings.semanticCache && !skipCache) {
        const candidate = await findCacheCandidate(conversation.id, fingerprint, cachePrompt);
        if (candidate) {
          const matchResult = await withinDeadline(validateCacheMatch(cachePrompt, candidate.prompt, fingerprint).catch(() => ({
            equivalent: false,
            reason: '验证失败',
          })), 220, { equivalent: false, reason: '缓存判定超时' }, controller.signal);
          const match = matchResult.value;
          if (match.equivalent) {
            setCacheProposal({ prompt: rawPrompt, userMessageId: transientUser.id, attachments, skillIds: effectiveSkillIds, candidate, fingerprint, routeReason: route.reason });
            patchDelivery(conversation.id, transientUser.id, 'sent');
            return true;
          }
        }
      }

      const optimized = optimizePromptLocally(rawPrompt, settings);
      const memory = conversation.memory;
      const rawHistory = [...conversation.messages, makeMessage('user', rawPrompt, attachments)];
      const initialSelection = selectContext(
        rawHistory,
        memory,
        route.profile.contextWindow,
        settings.compressionThreshold,
      );
      if (initialSelection.shouldCompress) route.reason = [route.reason, '本轮使用显著性窗口，摘要将在后台更新'].filter(Boolean).join(' · ');

      const baseSystem = buildSystemPrompt([personalization?.systemPromptPrefix, conversation.systemPrompt].filter(Boolean).join('\n\n'), settings);
      const clientContext = captureClientRuntimeContext();
      const skillsPrompt = buildSkillsPrompt(skillRun.skillIds, skillRun.contextBlocks);
      const compactMemory = memoryToCompactPrompt(memory, settings.toonStructured);
      const currentAssistContext = [compactMemory, ...conversation.messages.slice(-6).map((message) => `${message.role}: ${message.content}`)]
        .filter(Boolean).join('\n').slice(-20_000);
      const reasoningPromise = settings.reasoningEnabled && !route.profile.capabilities.reasoning
        ? reasonWithGlm(rawPrompt, currentAssistContext).catch(() => '')
        : Promise.resolve('');
      const searchPromise = settings.webSearch && !route.profile.capabilities.webSearch
        ? searchWithGlm(rawPrompt).catch(() => ({ text: '', citations: [] }))
        : Promise.resolve({ text: '', citations: [] as KnowledgeCitation[] });
      const imagePromise = !route.profile.capabilities.vision
        ? Promise.all(attachments.filter((attachment) => attachment.kind === 'image' && attachment.dataUrl).map(async (image) => {
            const description = await understandImageWithGlm(rawPrompt, image.dataUrl!)
              .catch((caught) => `图片理解失败：${caught instanceof Error ? caught.message : '智能视觉服务暂不可用'}`);
            return `${image.name}：${description}`;
          }))
        : Promise.resolve([] as string[]);
      const needsFallback = settings.reasoningEnabled && !route.profile.capabilities.reasoning
        || settings.webSearch && !route.profile.capabilities.webSearch
        || attachments.some((attachment) => attachment.kind === 'image') && !route.profile.capabilities.vision;
      if (needsFallback) setPreparationPhase('正在执行必要的兼容增强');
      let skip!: () => void;
      const skipped = new Promise<'skip'>((resolve) => { skip = () => resolve('skip'); });
      const aborted = new Promise<never>((_resolve, reject) => controller.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true }));
      skipEnhancementRef.current = skip;
      const enhanced = await Promise.race([
        Promise.all([reasoningPromise, searchPromise, imagePromise]),
        skipped.then(() => ['', { text: '', citations: [] as KnowledgeCitation[] }, [] as string[]] as const),
        aborted,
      ]);
      skipEnhancementRef.current = undefined;
      const [auxiliaryReasoning, searched, imageBlocks] = enhanced;
      if (auxiliaryReasoning) setLiveReasoning(auxiliaryReasoning);
      const webBlock = searched.text;
      citations = [...searched.citations, ...citations].slice(0, 20);
      const referenceBlock = citations.length
        ? `即时检索资料（仅在相关时引用）：\n${citations
            .map((citation, index) => `[${index + 1}] ${citation.documentName}\n${citation.excerpt}`)
            .join('\n\n')}`
        : '';
      const systemPrompt = [
        baseSystem,
        runtimeContextPrompt(clientContext),
        skillsPrompt,
        compactMemory,
        auxiliaryReasoning ? `智能助手推演（用于补充任务规划，不代表目标模型的私有思维过程）：\n${auxiliaryReasoning}` : '',
        webBlock ? `实时联网搜索摘要（回答时引用下面的来源）：\n${webBlock}` : '',
        imageBlocks.length ? `图片理解摘要：\n${imageBlocks.join('\n')}` : '',
        referenceBlock,
      ].filter(Boolean).join('\n\n');
      const historyForSend = [...conversation.messages, makeMessage('user', optimized.optimized, attachments)];
      const selection = selectContext(
        historyForSend,
        memory,
        route.profile.contextWindow,
        settings.compressionThreshold,
      );
      const rawAttachments = rawHistory.flatMap((message) => message.attachments ?? []);
      const fullAttachmentTokens = estimateAttachmentTokens(rawAttachments);
      const fullKnowledgeTokens = Math.ceil(knowledgeTextLength / 3);
      const baselineText = [conversation.systemPrompt, ...rawHistory.map((message) => `${message.role}: ${message.content}`)].join('\n');
      const sentText = [systemPrompt, ...selection.messages.map((message) => `${message.role}: ${message.content}`)].join('\n');
      const [baselineResult, sentResult, rawPromptResult, optimizedPromptResult] = await Promise.all([
        withinDeadline(estimateTokensForModel(baselineText, route.profile.model), 60, { tokens: heuristicTokenEstimate(baselineText), source: 'heuristic' as const }, controller.signal),
        withinDeadline(estimateTokensForModel(sentText, route.profile.model), 60, { tokens: heuristicTokenEstimate(sentText), source: 'heuristic' as const }, controller.signal),
        withinDeadline(estimateTokensForModel(rawPrompt, route.profile.model), 60, { tokens: heuristicTokenEstimate(rawPrompt), source: 'heuristic' as const }, controller.signal),
        withinDeadline(estimateTokensForModel(optimized.optimized, route.profile.model), 60, { tokens: heuristicTokenEstimate(optimized.optimized), source: 'heuristic' as const }, controller.signal),
      ]);
      const baselineEstimate = baselineResult.value;
      const sentEstimate = sentResult.value;
      const rawPromptEstimate = rawPromptResult.value;
      const optimizedPromptEstimate = optimizedPromptResult.value;
      const baseline = baselineEstimate.tokens + fullAttachmentTokens + fullKnowledgeTokens;
      const nativeImageTokens = route.profile.capabilities.vision
        ? estimateAttachmentTokens(attachments.filter((attachment) => attachment.kind === 'image'))
        : 0;
      const sent = sentEstimate.tokens + nativeImageTokens;
      const fullOptimizedHistory = estimateMessages(historyForSend);
      const injectedRetrievalTokens = citations.reduce((total, citation) => total + estimateTokens(citation.excerpt), 0);
      const currentDocumentTokens = estimateAttachmentTokens(attachments.filter((attachment) => attachment.kind === 'document'));
      const savings = {
        promptCompression: Math.max(0, rawPromptEstimate.tokens - optimizedPromptEstimate.tokens),
        contextPruning: Math.max(0, fullOptimizedHistory - estimateMessages(selection.messages)),
        jitRetrieval: Math.max(0, currentDocumentTokens + fullKnowledgeTokens - injectedRetrievalTokens),
        semanticCache: 0,
        promptCache: 0,
      };
      const effectiveSettings = {
        ...settings,
        reasoningEnabled: settings.reasoningEnabled && route.profile.capabilities.reasoning,
        webSearch: settings.webSearch && route.profile.capabilities.webSearch,
      };
      const providerMessages = selection.messages.map((message, index, messages) => ({
        role: message.role,
        content: message.content,
        attachments: message.attachments?.map(({ id, name, mimeType, size, kind, dataUrl }) => ({
          id,
          name,
          mimeType,
          size,
          kind,
          dataUrl: index === messages.length - 1 && kind === 'image' && route.profile.capabilities.vision ? dataUrl : undefined,
        })),
      }));

      const userMessage = transientUser;
      userMessage.rawPrompt = optimized.optimized !== rawPrompt ? optimized.optimized : undefined;

      let answer = '';
      let reasoning = '';
      let usage: TokenTelemetry | undefined;
      let responseCitations: KnowledgeCitation[] = citations;
      setPreparationPhase('正在连接模型');
      patchDelivery(conversation.id, transientUser.id, 'streaming');
      await streamChat(
        {
          conversationId: conversation.id,
          profile: route.profile,
          messages: providerMessages,
          systemPrompt,
          settings: effectiveSettings,
          estimatedBaseline: baseline,
          estimatedSent: sent,
          citations,
          savings,
          tokenizer: sentEstimate.source,
          clientContext,
        },
        apiKey ?? '',
        (event) => {
          if (event.type === 'accepted') setPreparationPhase('请求已接收');
          else if (event.type === 'upstream_connected') setPreparationPhase('模型已连接');
          else if (event.type === 'first_token') setPreparationPhase('正在生成');
          else if (event.type === 'delta') {
            answer += event.text;
            revealQueueRef.current.push(...Array.from(event.text));
            scheduleReveal();
          } else if (event.type === 'reasoning_delta') {
            reasoning += event.text;
            setLiveReasoning(reasoning);
          } else if (event.type === 'usage') usage = event.telemetry;
          else if (event.type === 'meta' && event.citations) responseCitations = event.citations;
          else if (event.type === 'error') throw new Error(event.message);
        },
        controller.signal,
      );
      if (!answer.trim()) throw new Error('Provider 没有返回文本内容');
      if (revealFrameRef.current !== undefined) cancelAnimationFrame(revealFrameRef.current);
      revealFrameRef.current = undefined;
      revealQueueRef.current = [];
      revealTextRef.current = answer;
      setLiveText(answer);
      const assistantMessage = makeMessage('assistant', answer);
      assistantMessage.telemetry = usage;
      assistantMessage.reasoningContent = reasoning || auxiliaryReasoning || undefined;
      assistantMessage.reasoningSource = reasoning ? 'provider' : auxiliaryReasoning ? 'glm' : undefined;
      assistantMessage.routeReason = route.reason;
      assistantMessage.citations = responseCitations;
      const postflight = executePostflightSkills(skillRun.skillIds, answer, assistantMessage.id);
      assistantMessage.artifacts = postflight.artifacts;
      assistantMessage.skillExecutions = [...skillRun.executions, ...postflight.executions];
      await appendMessage(conversation.id, assistantMessage);
      patchDelivery(conversation.id, userMessage.id, 'sent');
      if (assistantMessage.artifacts.length) setActiveArtifact(assistantMessage.artifacts[0].id);
      setLiveText('');
      setLiveReasoning('');
      if (settings.semanticCache) {
        void saveCacheEntry({
          conversationId: conversation.id,
          fingerprint,
          prompt: cachePrompt,
          answer,
        });
      }
      if (conversation.messages.length === 0 && !conversation.titleGenerated) {
        const fallbackTitle = rawPrompt.replace(/\s+/gu, ' ').trim().slice(0, 18) || '新对话';
        void generateConversationTitle(`用户：${rawPrompt}\n助手：${answer.slice(0, 4_000)}`)
          .catch(() => fallbackTitle)
          .then((title) => updateConversation(conversation.id, { title: title || fallbackTitle, titleGenerated: true }));
      }
      if (settings.automaticContextCompression && initialSelection.shouldCompress) {
        const compressible = rawHistory.slice(0, Math.max(0, rawHistory.length - 4));
        if (compressible.length >= 2) void compressConversation(
          compressible.map(({ role, content }) => ({ role, content })),
          memoryToPrompt(memory),
        ).then((nextMemory) => updateConversation(conversation.id, {
          memory: { ...nextMemory, compressedThroughMessageId: compressible.at(-1)?.id },
        })).catch(() => undefined);
      }
      return true;
    } catch (caught) {
      revealQueueRef.current = [];
      const cancelled = caught instanceof DOMException && caught.name === 'AbortError';
      const message = cancelled ? '已停止生成' : caught instanceof Error ? caught.message : '发送失败';
      setError(message);
      patchDelivery(conversation.id, transientUser.id, cancelled ? 'cancelled' : 'failed', message);
      if (caught instanceof ChatResponseError) {
        setErrorDetails(caught.issues?.map((issue) => `${issue.path || 'request'}：${issue.message}`) ?? []);
      }
      setLiveText('');
      setLiveReasoning('');
      return false;
    } finally {
      abortRef.current = undefined;
      skipEnhancementRef.current = undefined;
      setPreparationPhase('');
      setBusy(false);
    }
  };

  const acceptCache = async () => {
    if (!conversation || !cacheProposal) return;
    const assistant = makeMessage('assistant', cacheProposal.candidate.answer);
    const estimate = estimateMessages([...conversation.messages, makeMessage('user', cacheProposal.prompt)])
      + estimateTokens(conversation.systemPrompt);
    assistant.telemetry = {
      inputTokens: 0,
      outputTokens: 0,
      reasoningTokens: 0,
      cachedTokens: 0,
      actualTotal: 0,
      estimatedBaseline: estimate,
      estimatedSent: 0,
      estimatedSaved: estimate,
      contextSavedTokens: estimate,
      cacheReuseTokens: 0,
      estimatedGrossSaved: estimate,
      optimizationOverhead: 0,
      source: 'estimated',
      tokenizer: 'heuristic',
      savings: { promptCompression: 0, contextPruning: 0, jitRetrieval: 0, semanticCache: estimate, promptCache: 0 },
    };
    assistant.routeReason = '复用同会话语义缓存';
    await appendMessage(conversation.id, assistant);
    patchDelivery(conversation.id, cacheProposal.userMessageId, 'sent');
    setCacheProposal(undefined);
  };

  if (!conversation || !profile) return null;

  return (
    <main className="chat-view">
      <div
        ref={messagesRef}
        className="messages"
        aria-live="polite"
        onScroll={(event) => {
          if (performance.now() < forceFollowUntilRef.current) {
            shouldFollowRef.current = true;
            return;
          }
          const element = event.currentTarget;
          shouldFollowRef.current = element.scrollHeight - element.scrollTop - element.clientHeight < 72;
        }}
      >
        <div ref={messagesContentRef} className="messages-content">
        {conversation.messages.length === 0 ? (
          <motion.div className="empty-chat" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
            <div className="empty-glyph"><Sparkles size={26} /></div>
            <h1>从一个清晰的问题开始</h1>
            <p>StingyChat 会在发送前整理提示词与上下文，并在每条回复旁提供 Token 使用明细。</p>
            <div className="quick-prompts">
              {quickPrompts.map((text) => (
                <button key={text} onClick={() => void sendMessage(text)}>{text}</button>
              ))}
            </div>
          </motion.div>
        ) : null}
        <AnimatePresence initial={false}>
          {conversation.messages.map((message) => (
            <motion.article
              className={`message ${message.role}`}
              key={message.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.16 }}
            >
              <div className="message-avatar">
                {message.role === 'assistant' ? <Bot size={16} /> : <User size={16} />}
              </div>
              <div className="message-body">
              {message.reasoningContent ? (
                  <details className="reasoning-panel">
                    <summary><BrainCircuit size={15} /> {message.reasoningSource === 'glm' ? '智能助手推演' : '思考摘要'}</summary>
                    <div className="reasoning-content"><MarkdownContent>{message.reasoningContent}</MarkdownContent></div>
                  </details>
                ) : null}
                <MarkdownContent>{message.content}</MarkdownContent>
                {message.role === 'user' && (message.deliveryStatus === 'failed' || message.deliveryStatus === 'cancelled') ? (
                  <div className="delivery-failed">
                    <small>{message.deliveryError || '发送未完成'}</small>
                    <button onClick={() => void sendMessage(message.content, message.attachments ?? [], message.skillIds ?? [], false, message.id)}>
                      <RotateCcw size={13} /> 原地重试
                    </button>
                  </div>
                ) : null}
                {message.attachments?.length ? (
                  <div className="message-attachments">
                    {message.attachments.map((attachment) => attachment.kind === 'image' && attachment.dataUrl
                      ? <img key={attachment.id} src={attachment.dataUrl} alt={attachment.name} />
                      : <span key={attachment.id}><FileText size={13} /> {attachment.name}</span>)}
                  </div>
                ) : null}
                {message.skillIds?.length ? <div className="message-skills">{message.skillIds.map((id) => <span key={id}>{skillName(id)}</span>)}</div> : null}
                {message.citations?.length ? (
                  <details className="citation-group">
                    <summary><FileText size={13} /> {groupCitations(message.citations).length} 个来源</summary>
                    <div className="citation-list">
                      {groupCitations(message.citations).map((citation) => (
                        <section key={citation.documentName}>
                          <b>{citation.sourceType === 'web' ? '网页' : citation.sourceType === 'attachment' ? '附件' : '资料'} · {citation.documentName}</b>
                          {citation.chunkCount > 1 ? <small>{citation.chunkCount} 个相关片段</small> : null}
                          {citation.excerpts.map((excerpt) => <p key={excerpt}>{excerpt}</p>)}
                          {citation.url ? <a href={citation.url} target="_blank" rel="noreferrer">打开来源</a> : null}
                        </section>
                      ))}
                    </div>
                  </details>
                ) : null}
                {message.skillExecutions?.length ? (
                  <details className="skill-executions">
                    <summary><Sparkles size={13} /> Skills 执行 {message.skillExecutions.filter((item) => item.status === 'completed').length}/{message.skillExecutions.length}</summary>
                    <div>{message.skillExecutions.map((item) => <p key={`${item.phase}:${item.id}`}><b>{item.name}</b><span>{item.summary}</span><small>{item.source} · {item.durationMs}ms</small></p>)}</div>
                  </details>
                ) : null}
                <div className="message-meta">
                  {message.routeReason ? <span>{message.routeReason}</span> : null}
                  <IconButton label="复制" onClick={() => void navigator.clipboard.writeText(message.content)}>
                    <Copy size={13} />
                  </IconButton>
                  {message.rawPrompt ? (
                    <button className="prompt-diff-trigger" onClick={() => setSentPromptPreview(message)}>
                      已压缩提示词
                    </button>
                  ) : null}
                  {message.telemetry ? <TokenInfo telemetry={message.telemetry} /> : null}
                </div>
              </div>
            </motion.article>
          ))}
        </AnimatePresence>
        {liveText || liveReasoning ? (
          <article className="message assistant is-streaming">
            <div className="message-avatar"><Bot size={16} /></div>
            <div className="message-body">
              {liveReasoning ? (
                <details className="reasoning-panel" open>
                  <summary><BrainCircuit size={15} /> 正在思考</summary>
                  <div className="reasoning-content"><MarkdownContent>{liveReasoning}</MarkdownContent></div>
                </details>
              ) : null}
              {liveText ? <MarkdownContent>{liveText}</MarkdownContent> : null}
            </div>
          </article>
        ) : null}
        {busy && !liveText && !liveReasoning ? (
          <div className="thinking-line"><LoaderCircle size={16} className="spin" /> {preparationPhase || '正在准备'}{skipEnhancementRef.current ? <button onClick={() => skipEnhancementRef.current?.()}>立即发送，跳过增强</button> : null}</div>
        ) : null}
        {error ? <div className="inline-error"><b>{error}</b>{errorDetails.length ? <details><summary>查看不兼容字段</summary>{errorDetails.map((detail) => <p key={detail}>{detail}</p>)}</details> : null}<small>输入和附件仍保留在编辑框中，可修改后重试。</small></div> : null}
        </div>
      </div>

      <Composer
        conversationId={conversation.id}
        profile={profile}
        busy={busy}
        onSend={sendMessage}
        onOptimize={requestOptimization}
        replacement={replacement}
        onReplacementApplied={clearReplacement}
        onStop={() => abortRef.current?.abort()}
      />

      <Modal open={Boolean(preview)} title="提示词优化" onClose={() => setPreview(undefined)} wide>
        {preview ? (
          <div className="modal-content">
            <div className="diff-grid">
              <section><label>原文</label><pre>{preview.original}</pre></section>
              <section><label>优化稿</label><pre>{preview.optimized}</pre></section>
            </div>
            <div className="preview-note">本地规则预估节省 {preview.localSaved} Token；最终账单以 Provider usage 为准。</div>
            <div className="modal-actions">
              <button className="secondary-button" onClick={() => setPreview(undefined)}>保留原文</button>
              <button
                className="primary-button"
                onClick={() => {
                  setReplacement(preview.optimized);
                  setPreview(undefined);
                }}
              >
                应用优化稿
              </button>
            </div>
          </div>
        ) : null}
      </Modal>

      <Modal open={Boolean(sentPromptPreview)} title="提示词发送差异" onClose={() => setSentPromptPreview(undefined)} wide>
        {sentPromptPreview?.rawPrompt ? (
          <div className="modal-content">
            <div className="diff-grid">
              <section><label>原文</label><pre>{sentPromptPreview.content}</pre></section>
              <section><label>实际发送</label><pre>{sentPromptPreview.rawPrompt}</pre></section>
            </div>
            <div className="modal-actions">
              <button className="secondary-button" onClick={() => setSentPromptPreview(undefined)}>关闭</button>
              <button
                className="primary-button"
                onClick={() => {
                  setReplacement(sentPromptPreview.content);
                  setSentPromptPreview(undefined);
                }}
              >
                将原文放回输入框
              </button>
            </div>
          </div>
        ) : null}
      </Modal>

      <Modal open={Boolean(cacheProposal)} title="发现可复用回答" onClose={() => {
        if (cacheProposal) patchDelivery(conversation.id, cacheProposal.userMessageId, 'failed', '已取消缓存选择');
        setCacheProposal(undefined);
      }}>
        {cacheProposal ? (
          <div className="modal-content">
            <p>同一会话状态下有一个语义等价的历史提问。复用不会调用聊天 Provider。</p>
            <blockquote>{cacheProposal.candidate.answer.slice(0, 420)}</blockquote>
            <div className="modal-actions">
              <button
                className="secondary-button"
                onClick={() => {
                  const proposal = cacheProposal;
                  setCacheProposal(undefined);
                  void sendMessage(proposal.prompt, proposal.attachments, proposal.skillIds, true, proposal.userMessageId);
                }}
              >
                <RotateCcw size={14} /> 重新生成
              </button>
              <button className="primary-button" onClick={() => void acceptCache()}>复用回答</button>
            </div>
          </div>
        ) : null}
      </Modal>
    </main>
  );
}
