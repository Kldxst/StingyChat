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
  normalizeForSemanticCache,
  loginAdmin,
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
import { requiresUserApiKey } from '../lib/providerAuth';
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
  candidate: SemanticCacheEntry;
  fingerprint: string;
  routeReason?: string;
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

function makeMessage(role: 'user' | 'assistant', content: string, attachments?: ChatAttachment[]): ChatMessage {
  return { id: crypto.randomUUID(), role, content, createdAt: Date.now(), attachments };
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
  const appendMessage = useAppStore((state) => state.appendMessage);
  const updateConversation = useAppStore((state) => state.updateConversation);
  const setSettingsOpen = useAppStore((state) => state.setSettingsOpen);
  const setAdminToken = useAppStore((state) => state.setAdminToken);
  const conversation = useMemo(
    () => conversations.find((item) => item.id === activeId),
    [activeId, conversations],
  );
  const profile = profiles.find((item) => item.id === conversation?.providerProfileId) ?? profiles[0];

  const [busy, setBusy] = useState(false);
  const [liveText, setLiveText] = useState('');
  const [liveReasoning, setLiveReasoning] = useState('');
  const [error, setError] = useState('');
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
  const clearReplacement = useCallback(() => setReplacement(undefined), []);

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
      const count = Math.min(4, revealQueueRef.current.length);
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

  const sendMessage = async (rawPrompt: string, attachments: ChatAttachment[] = [], skipCache = false): Promise<void> => {
    if (!conversation || !profile || busy) return;
    if (rawPrompt.startsWith('Admin')) {
      try {
        setAdminToken(await loginAdmin(rawPrompt));
      } catch {
        setError('管理员凭据无效');
      }
      return;
    }
    shouldFollowRef.current = true;
    scrollToBottom();
    setBusy(true);
    setError('');
    setLiveText('');
    setLiveReasoning('');
    revealQueueRef.current = [];
    revealTextRef.current = '';
    try {
      const route = await chooseRoute(rawPrompt);
      const apiKey = requiresUserApiKey(route.profile) ? await loadProviderSecret(route.profile.id) : '';
      if (requiresUserApiKey(route.profile) && !apiKey) {
        setSettingsOpen(true);
        throw new Error(`请先在设置中保存 ${route.profile.name} API Key`);
      }
      let citations = settings.jitRetrieval
        ? await retrieveKnowledge(rawPrompt, settings.retrievalTopK)
        : [];
      const attachmentCitations = retrieveAttachmentText(attachments, rawPrompt, settings.retrievalTopK);
      const knowledgeTextLength = settings.jitRetrieval ? await knowledgeCorpusTextLength() : 0;
      citations = [...attachmentCitations, ...citations].slice(0, 20);
      const cachePrompt = settings.semanticHitEnhancement
        ? await normalizeForSemanticCache(
            rawPrompt,
            [memoryToPrompt(conversation.memory), ...conversation.messages.slice(-6).map((message) => `${message.role}: ${message.content}`)]
              .filter(Boolean)
              .join('\n')
              .slice(-20_000),
          ).catch(() => rawPrompt)
        : rawPrompt;
      const fingerprint = await conversationFingerprint(
        conversation,
        `${route.profile.kind}:${route.profile.model}`,
        citations.map((citation) => citation.chunkId),
      );
      if (settings.semanticCache && !skipCache) {
        const candidate = await findCacheCandidate(conversation.id, fingerprint, cachePrompt);
        if (candidate) {
          const match = await validateCacheMatch(cachePrompt, candidate.prompt, fingerprint).catch(() => ({
            equivalent: false,
            reason: '验证失败',
          }));
          if (match.equivalent) {
            setCacheProposal({ prompt: rawPrompt, candidate, fingerprint, routeReason: route.reason });
            setBusy(false);
            return;
          }
        }
      }

      const optimized = optimizePromptLocally(rawPrompt, settings);
      let memory = conversation.memory;
      const rawHistory = [...conversation.messages, makeMessage('user', rawPrompt, attachments)];
      const initialSelection = selectContext(
        rawHistory,
        memory,
        route.profile.contextWindow,
        settings.compressionThreshold,
      );
      if (settings.automaticContextCompression && initialSelection.shouldCompress) {
        const compressible = rawHistory.slice(0, Math.max(0, rawHistory.length - 4));
        if (compressible.length >= 2) {
          try {
            memory = await compressConversation(
              compressible.map(({ role, content }) => ({ role, content })),
              memoryToPrompt(memory),
            );
            memory.compressedThroughMessageId = compressible.at(-1)?.id;
            await updateConversation(conversation.id, { memory });
          } catch {
            route.reason = [route.reason, '摘要失败，使用滑动窗口'].filter(Boolean).join(' · ');
          }
        }
      }

      const baseSystem = buildSystemPrompt(conversation.systemPrompt, settings);
      const compactMemory = memoryToCompactPrompt(memory, settings.toonStructured);
      const assistContext = [compactMemory, ...conversation.messages.slice(-6).map((message) => `${message.role}: ${message.content}`)]
        .filter(Boolean).join('\n').slice(-20_000);
      let auxiliaryReasoning = '';
      let webBlock = '';
      const imageBlocks: string[] = [];
      if (settings.reasoningEnabled && !route.profile.capabilities.reasoning) {
        auxiliaryReasoning = await reasonWithGlm(rawPrompt, assistContext);
        setLiveReasoning(auxiliaryReasoning);
      }
      if (settings.webSearch && !route.profile.capabilities.webSearch) {
        const searched = await searchWithGlm(rawPrompt);
        webBlock = searched.text;
        citations = [...searched.citations, ...citations].slice(0, 20);
      }
      if (!route.profile.capabilities.vision) {
        for (const image of attachments.filter((attachment) => attachment.kind === 'image' && attachment.dataUrl)) {
          imageBlocks.push(`${image.name}：${await understandImageWithGlm(rawPrompt, image.dataUrl!)}`);
        }
      }
      const referenceBlock = citations.length
        ? `即时检索资料（仅在相关时引用）：\n${citations
            .map((citation, index) => `[${index + 1}] ${citation.documentName}\n${citation.excerpt}`)
            .join('\n\n')}`
        : '';
      const systemPrompt = [
        baseSystem,
        compactMemory,
        auxiliaryReasoning ? `辅助推演（GLM 生成的可公开规划，不是目标模型私有思维链）：\n${auxiliaryReasoning}` : '',
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
      const fullAttachmentTokens = attachments.reduce((total, attachment) => total + estimateTokens(attachment.text ?? ''), 0);
      const fullKnowledgeTokens = Math.ceil(knowledgeTextLength / 3);
      const baselineText = [conversation.systemPrompt, ...rawHistory.map((message) => `${message.role}: ${message.content}`)].join('\n');
      const sentText = [systemPrompt, ...selection.messages.map((message) => `${message.role}: ${message.content}`)].join('\n');
      const [baselineEstimate, sentEstimate] = await Promise.all([
        estimateTokensForModel(baselineText, route.profile.model),
        estimateTokensForModel(sentText, route.profile.model),
      ]);
      const baseline = baselineEstimate.tokens + fullAttachmentTokens + fullKnowledgeTokens;
      const sent = sentEstimate.tokens;
      const fullOptimizedHistory = estimateMessages(historyForSend);
      const sentAttachmentTokens = attachmentCitations.reduce((total, citation) => total + estimateTokens(citation.excerpt), 0);
      const savings = {
        promptCompression: optimized.saved,
        contextPruning: Math.max(0, fullOptimizedHistory - estimateMessages(selection.messages)),
        jitRetrieval: Math.max(0, fullAttachmentTokens + fullKnowledgeTokens - sentAttachmentTokens),
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

      const userMessage = makeMessage('user', rawPrompt, attachments);
      userMessage.rawPrompt = optimized.optimized !== rawPrompt ? optimized.optimized : undefined;
      await appendMessage(conversation.id, userMessage);

      let answer = '';
      let reasoning = '';
      let usage: TokenTelemetry | undefined;
      let responseCitations: KnowledgeCitation[] = citations;
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
        },
        apiKey ?? '',
        (event) => {
          if (event.type === 'delta') {
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
      );
      if (!answer.trim()) throw new Error('Provider 没有返回文本内容');
      await new Promise<void>((resolve) => {
        const started = performance.now();
        const waitForPaint = () => {
          if (!revealQueueRef.current.length || performance.now() - started > 1200) {
            if (revealQueueRef.current.length) {
              revealTextRef.current += revealQueueRef.current.splice(0).join('');
              setLiveText(revealTextRef.current);
            }
            resolve();
          } else requestAnimationFrame(waitForPaint);
        };
        waitForPaint();
      });
      const assistantMessage = makeMessage('assistant', answer);
      assistantMessage.telemetry = usage;
      assistantMessage.reasoningContent = reasoning || auxiliaryReasoning || undefined;
      assistantMessage.reasoningSource = reasoning ? 'provider' : auxiliaryReasoning ? 'glm' : undefined;
      assistantMessage.routeReason = route.reason;
      assistantMessage.citations = responseCitations;
      await appendMessage(conversation.id, assistantMessage);
      setLiveText('');
      setLiveReasoning('');
      if (settings.semanticCache) {
        await saveCacheEntry({
          conversationId: conversation.id,
          fingerprint,
          prompt: cachePrompt,
          answer,
        });
      }
    } catch (caught) {
      revealQueueRef.current = [];
      setError(caught instanceof Error ? caught.message : '发送失败');
      setLiveText('');
      setLiveReasoning('');
    } finally {
      setBusy(false);
    }
  };

  const acceptCache = async () => {
    if (!conversation || !cacheProposal) return;
    const user = makeMessage('user', cacheProposal.prompt);
    const assistant = makeMessage('assistant', cacheProposal.candidate.answer);
    const estimate = estimateMessages([...conversation.messages, makeMessage('user', cacheProposal.prompt)])
      + estimateTokens(conversation.systemPrompt);
    const reused = estimateTokens(cacheProposal.candidate.answer);
    assistant.telemetry = {
      inputTokens: 0,
      outputTokens: 0,
      reasoningTokens: 0,
      cachedTokens: reused,
      actualTotal: 0,
      estimatedBaseline: estimate,
      estimatedSent: 0,
      estimatedSaved: estimate,
      source: 'estimated',
      tokenizer: 'heuristic',
      savings: { promptCompression: 0, contextPruning: 0, jitRetrieval: 0, semanticCache: estimate, promptCache: 0 },
    };
    assistant.routeReason = '复用同会话语义缓存';
    await appendMessage(conversation.id, user);
    await appendMessage(conversation.id, assistant);
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
            <h1>把问题说短一点</h1>
            <p>StingyChat 会在发送前整理上下文，并把节省结果留在每条回复旁。</p>
            <div className="quick-prompts">
              {['将这段需求整理为 JSON', '只给我可运行的代码', '从资料库中检索要点'].map((text) => (
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
              transition={{ duration: 0.2 }}
            >
              <div className="message-avatar">
                {message.role === 'assistant' ? <Bot size={16} /> : <User size={16} />}
              </div>
              <div className="message-body">
              {message.reasoningContent ? (
                  <details className="reasoning-panel">
                    <summary><BrainCircuit size={15} /> {message.reasoningSource === 'glm' ? 'GLM 辅助推演' : '思考摘要'}</summary>
                    <div className="reasoning-content"><MarkdownContent>{message.reasoningContent}</MarkdownContent></div>
                  </details>
                ) : null}
                <MarkdownContent>{message.content}</MarkdownContent>
                {message.attachments?.length ? (
                  <div className="message-attachments">
                    {message.attachments.map((attachment) => attachment.kind === 'image' && attachment.dataUrl
                      ? <img key={attachment.id} src={attachment.dataUrl} alt={attachment.name} />
                      : <span key={attachment.id}><FileText size={13} /> {attachment.name}</span>)}
                  </div>
                ) : null}
                {message.citations?.length ? (
                  <div className="citation-row">
                    {groupCitations(message.citations).map((citation) => (
                      <details key={citation.documentName}>
                        <summary><FileText size={12} /> {citation.sourceType === 'web' ? '网页' : citation.sourceType === 'attachment' ? '附件' : '资料'} · {citation.documentName}{citation.chunkCount > 1 ? ` · ${citation.chunkCount} 段` : ''}</summary>
                        <div>
                          {citation.excerpts.map((excerpt) => <p key={excerpt}>{excerpt}</p>)}
                          {citation.url ? <a href={citation.url} target="_blank" rel="noreferrer">打开来源</a> : null}
                        </div>
                      </details>
                    ))}
                  </div>
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
          <div className="thinking-line"><LoaderCircle size={16} className="spin" /> 正在组织上下文</div>
        ) : null}
        {error ? <div className="inline-error">{error}</div> : null}
        </div>
      </div>

      <Composer
        profile={profile}
        busy={busy}
        onSend={sendMessage}
        onOptimize={requestOptimization}
        replacement={replacement}
        onReplacementApplied={clearReplacement}
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

      <Modal open={Boolean(cacheProposal)} title="发现可复用回答" onClose={() => setCacheProposal(undefined)}>
        {cacheProposal ? (
          <div className="modal-content">
            <p>同一会话状态下有一个语义等价的历史提问。复用不会调用聊天 Provider。</p>
            <blockquote>{cacheProposal.candidate.answer.slice(0, 420)}</blockquote>
            <div className="modal-actions">
              <button
                className="secondary-button"
                onClick={() => {
                  const prompt = cacheProposal.prompt;
                  setCacheProposal(undefined);
                  void sendMessage(prompt, [], true);
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
