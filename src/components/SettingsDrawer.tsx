import {
  BrainCircuit,
  KeyRound,
  LoaderCircle,
  Plus,
  Settings2,
  ShieldCheck,
  Sparkles,
  Trash2,
  X,
  Zap,
} from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useRef, useState } from 'react';
import { compressConversation, generateSystemPrompt } from '../lib/api';
import {
  loadPersonalGlmSecret,
  loadProviderSecret,
  removePersonalGlmSecret,
  savePersonalGlmSecret,
  saveProviderSecret,
} from '../lib/crypto';
import { memoryToPrompt } from '../lib/optimization';
import { requiresUserApiKey } from '../lib/providerAuth';
import { useAppStore } from '../store';
import type { OptimizationSettings, ProviderProfile } from '../types';
import { FieldLabel, IconButton, Toggle } from './ui';
import { ModelPicker } from './ModelPicker';

type SettingsTab = 'connection' | 'optimization' | 'system' | 'advanced';

const TOGGLES: Array<{ key: keyof OptimizationSettings; label: string; note: string }> = [
  { key: 'ruleCompression', label: '规则压缩', note: '空白、冗余短语与重复指令' },
  { key: 'removePoliteness', label: '移除客套语', note: '清理麻烦、辛苦、谢谢等表达' },
  { key: 'structuredPrompt', label: '结构化指令', note: '转换为任务、输入、输出和格式' },
  { key: 'chipProtocol', label: 'CHIP 风格协议', note: '使用高密度中文字段' },
  { key: 'concisePersona', label: '惜字如金', note: '禁止寒暄、复述和总结性废话' },
  { key: 'automaticContextCompression', label: '自动压缩上下文', note: '超出阈值时生成长期摘要' },
  { key: 'promptCache', label: 'Prompt Cache', note: '保持固定前缀并映射供应商缓存' },
  { key: 'semanticCache', label: '同会话语义缓存', note: '命中后由你确认是否复用' },
  { key: 'semanticHitEnhancement', label: '语义命中增强', note: '发送前规范化语义，提高缓存复用率' },
  { key: 'modelRouting', label: '自动模型路由', note: '简单和复杂任务使用不同模型' },
  { key: 'jitRetrieval', label: 'JIT 资料检索', note: '只注入最相关资料片段' },
  { key: 'toonStructured', label: 'TOON 结构化压缩', note: '紧凑编码长期记忆与结构化上下文' },
];

export function SettingsDrawer() {
  const open = useAppStore((state) => state.settingsOpen);
  const setOpen = useAppStore((state) => state.setSettingsOpen);
  const activeId = useAppStore((state) => state.activeConversationId);
  const conversations = useAppStore((state) => state.conversations);
  const profiles = useAppStore((state) => state.profiles);
  const settings = useAppStore((state) => state.settings);
  const updateSettings = useAppStore((state) => state.updateSettings);
  const toggleExtreme = useAppStore((state) => state.toggleExtreme);
  const updateConversation = useAppStore((state) => state.updateConversation);
  const saveProfile = useAppStore((state) => state.saveProfile);
  const conversation = conversations.find((item) => item.id === activeId);
  const activeProfile = profiles.find((item) => item.id === conversation?.providerProfileId) ?? profiles[0];

  const [tab, setTab] = useState<SettingsTab>('connection');
  const [keyValue, setKeyValue] = useState('');
  const [hasKey, setHasKey] = useState(false);
  const [personalGlmKey, setPersonalGlmKey] = useState('');
  const [hasPersonalGlmKey, setHasPersonalGlmKey] = useState(false);
  const [baseUrl, setBaseUrl] = useState(activeProfile?.baseUrl ?? '');
  const [systemPrompt, setSystemPrompt] = useState(conversation?.systemPrompt ?? '');
  const [description, setDescription] = useState('');
  const [generating, setGenerating] = useState(false);
  const [compressing, setCompressing] = useState(false);
  const [notice, setNotice] = useState('');
  const [fewInput, setFewInput] = useState('');
  const [fewOutput, setFewOutput] = useState('');
  const drawerRef = useRef<HTMLElement>(null);

  useEffect(() => {
    setBaseUrl(activeProfile?.baseUrl ?? '');
    setKeyValue('');
    if (activeProfile && !requiresUserApiKey(activeProfile)) setHasKey(true);
    else if (activeProfile) void loadProviderSecret(activeProfile.id).then((value) => setHasKey(Boolean(value)));
  }, [activeProfile?.id]);

  useEffect(() => setSystemPrompt(conversation?.systemPrompt ?? ''), [conversation?.id, conversation?.systemPrompt]);

  useEffect(() => {
    if (!open) return;
    void loadPersonalGlmSecret().then((value) => setHasPersonalGlmKey(Boolean(value)));
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const previousFocus = document.activeElement as HTMLElement | null;
    const frame = requestAnimationFrame(() => drawerRef.current?.querySelector<HTMLElement>('button')?.focus());
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); setOpen(false); return; }
      if (event.key !== 'Tab' || !drawerRef.current) return;
      const focusable = [...drawerRef.current.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [href], [tabindex]:not([tabindex="-1"])')];
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable.at(-1)!;
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => { cancelAnimationFrame(frame); document.removeEventListener('keydown', onKeyDown); previousFocus?.focus(); };
  }, [open, setOpen]);

  if (!activeProfile || !conversation) return null;

  const persistConnection = async () => {
    const updated: ProviderProfile = {
      ...activeProfile,
      baseUrl: activeProfile.kind === 'custom' ? baseUrl.trim() : activeProfile.baseUrl,
    };
    if (keyValue.trim()) {
      await saveProviderSecret(activeProfile.id, keyValue.trim());
      setHasKey(true);
      setKeyValue('');
    }
    await saveProfile(updated);
    setNotice('连接配置已保存在此设备');
  };

  const addCustomProvider = async () => {
    const id = crypto.randomUUID();
    const custom: ProviderProfile = {
      id,
      name: `自定义 ${profiles.filter((item) => item.kind === 'custom').length + 1}`,
      kind: 'custom',
      model: 'custom-model',
      baseUrl: 'https://api.example.com/v1',
      protocol: 'openai-chat',
      contextWindow: 128_000,
      capabilities: {
        responses: false,
        webSearch: false,
        reasoning: false,
        reasoningEffort: false,
        promptCache: false,
        batch: false,
        structuredOutput: true,
        vision: false,
      },
    };
    await saveProfile(custom);
    await updateConversation(conversation.id, { providerProfileId: id });
  };

  const generate = async () => {
    if (!description.trim()) return;
    setGenerating(true);
    setNotice('');
    try {
      setSystemPrompt(await generateSystemPrompt(description));
    } catch (caught) {
      setNotice(caught instanceof Error ? caught.message : '生成失败');
    } finally {
      setGenerating(false);
    }
  };

  const compressNow = async () => {
    const previousIndex = conversation.memory.compressedThroughMessageId
      ? conversation.messages.findIndex((message) => message.id === conversation.memory.compressedThroughMessageId)
      : -1;
    const compressible = conversation.messages.slice(previousIndex + 1, Math.max(previousIndex + 1, conversation.messages.length - 4));
    if (compressible.length < 2) {
      setNotice('至少需要两条尚未压缩的早期消息');
      return;
    }
    setCompressing(true);
    setNotice('');
    try {
      const memory = await compressConversation(
        compressible.map(({ role, content }) => ({ role, content })),
        memoryToPrompt(conversation.memory),
      );
      memory.compressedThroughMessageId = compressible.at(-1)?.id;
      await updateConversation(conversation.id, { memory });
      setNotice(`已压缩 ${compressible.length} 条早期消息，最近 4 条保留原文`);
    } catch (caught) {
      setNotice(caught instanceof Error ? caught.message : '上下文压缩失败');
    } finally {
      setCompressing(false);
    }
  };

  const tabs: Array<{ id: SettingsTab; label: string }> = [
    { id: 'connection', label: '连接' },
    { id: 'optimization', label: '优化' },
    { id: 'system', label: '系统' },
    { id: 'advanced', label: '高级' },
  ];

  return (
    <AnimatePresence>
      {open ? (
        <>
          <motion.button
            className="drawer-scrim"
            aria-label="关闭设置"
            onClick={() => setOpen(false)}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          />
          <motion.aside
            ref={drawerRef}
            className="settings-drawer"
            role="dialog"
            aria-modal="true"
            aria-label="设置"
            initial={{ opacity: 0, y: 22, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.98 }}
            transition={{ type: 'spring', damping: 28, stiffness: 300 }}
          >
            <header className="settings-header">
              <div><Settings2 size={18} /><h2>设置</h2></div>
              <IconButton label="关闭设置" onClick={() => setOpen(false)}><X size={18} /></IconButton>
            </header>
            <div className="settings-tabs" role="tablist">
              {tabs.map((item) => (
                <button key={item.id} className={tab === item.id ? 'active' : ''} onClick={() => setTab(item.id)}>
                  {item.label}
                </button>
              ))}
            </div>

            <div className="settings-scroll">
              {tab === 'connection' ? (
                <div className="settings-section">
                  <div className="section-heading"><KeyRound size={16} /><h3>Provider</h3></div>
                  <div className="field">
                    <FieldLabel>供应商与模型</FieldLabel>
                    <ModelPicker conversationId={conversation.id} profile={activeProfile} variant="settings" />
                  </div>
                  {activeProfile.kind === 'custom' ? (
                    <>
                      <label className="field">
                        <FieldLabel>Base URL</FieldLabel>
                        <input value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} />
                      </label>
                      <label className="field">
                        <FieldLabel>协议</FieldLabel>
                        <select
                          value={activeProfile.protocol}
                          onChange={(event) => void saveProfile({
                            ...activeProfile,
                            protocol: event.target.value as ProviderProfile['protocol'],
                            capabilities: {
                              ...activeProfile.capabilities,
                              responses: event.target.value === 'openai-responses',
                              webSearch: event.target.value === 'openai-responses',
                            },
                          })}
                        >
                          <option value="openai-chat">OpenAI Chat Completions</option>
                          <option value="openai-responses">OpenAI Responses</option>
                        </select>
                      </label>
                    </>
                  ) : null}
                  {!requiresUserApiKey(activeProfile) ? (
                    <div className="settings-notice">免费模型已由 StingyChat 安全配置，无需填写 API Key。</div>
                  ) : (
                    <label className="field">
                      <FieldLabel>API Key {hasKey ? '· 已保存' : ''}</FieldLabel>
                      <input
                        type="password"
                        value={keyValue}
                        onChange={(event) => setKeyValue(event.target.value)}
                        placeholder={hasKey ? '输入新 Key 可替换' : '仅加密保存在当前浏览器'}
                        autoComplete="off"
                      />
                    </label>
                  )}
                  <button className="primary-button full" onClick={() => void persistConnection()}>
                    <ShieldCheck size={15} /> 保存连接
                  </button>
                  <button className="secondary-button full" onClick={() => void addCustomProvider()}>
                    <Plus size={15} /> 添加自定义 Provider
                  </button>
                  <div className="section-divider" />
                  <div className="section-heading"><Sparkles size={16} /><h3>个人智能辅助 GLM</h3></div>
                  <div className="privacy-note">
                    配置后，所有内置 GLM 调用都会使用你的 Key，包括 StingyChat、提示词优化、语义增强、摘要、搜索、图片理解与辅助推演。Key 仅加密保存在此浏览器并在当前 HTTPS 请求中转发，不写入 Worker 日志、数据库或缓存。官方服务不收费、无广告，也不出售 Key。
                  </div>
                  <label className="field">
                    <FieldLabel>GLM API Key {hasPersonalGlmKey ? '· 已保存' : ''}</FieldLabel>
                    <input
                      type="password"
                      value={personalGlmKey}
                      onChange={(event) => setPersonalGlmKey(event.target.value)}
                      placeholder={hasPersonalGlmKey ? '输入新 Key 可替换' : 'bigmodel.cn API Key'}
                      autoComplete="off"
                    />
                  </label>
                  <div className="personal-key-actions">
                    <button
                      className="primary-button"
                      disabled={!personalGlmKey.trim()}
                      onClick={() => void savePersonalGlmSecret(personalGlmKey.trim()).then(() => {
                        setPersonalGlmKey('');
                        setHasPersonalGlmKey(true);
                        setNotice('个人 GLM Key 已加密保存在此设备，所有内置 GLM 功能将优先使用它');
                      })}
                    >
                      <ShieldCheck size={15} /> 保存个人 Key
                    </button>
                    {hasPersonalGlmKey ? (
                      <button
                        className="secondary-button"
                        onClick={() => void removePersonalGlmSecret().then(() => {
                          setHasPersonalGlmKey(false);
                          setNotice('已删除个人 GLM Key，将恢复使用内置队列');
                        })}
                      >移除</button>
                    ) : null}
                  </div>
                </div>
              ) : null}

              {tab === 'optimization' ? (
                <div className="settings-section">
                  <div className={`extreme-row ${settings.extremeMode ? 'active' : ''}`}>
                    <div><Zap size={18} /><span><b>极省模式</b><small>启用全部优化并压缩表达</small></span></div>
                    <Toggle checked={settings.extremeMode} onChange={(value) => void toggleExtreme(value)} label="极省模式" />
                  </div>
                  {settings.extremeMode ? <div className="warning-note">可能压缩文风、减少细节、复用旧结果或切换模型。</div> : null}
                  <div className="toggle-list">
                    {TOGGLES.map((item) => (
                      <div className="setting-row" key={item.key}>
                        <span><b>{item.label}</b><small>{item.note}</small></span>
                        <Toggle
                          checked={Boolean(settings[item.key])}
                          onChange={(value) => void updateSettings({ [item.key]: value } as Partial<OptimizationSettings>)}
                          label={item.label}
                        />
                      </div>
                    ))}
                  </div>
                  <label className="field">
                    <FieldLabel>输出契约</FieldLabel>
                    <select
                      value={settings.outputContract}
                      onChange={(event) => void updateSettings({ outputContract: event.target.value as OptimizationSettings['outputContract'] })}
                    >
                      <option value="concise">精简回答</option>
                      <option value="json">仅 JSON</option>
                      <option value="code">仅代码</option>
                      <option value="choice">仅选项字母</option>
                      <option value="free">自由输出</option>
                    </select>
                  </label>
                  {settings.modelRouting ? (
                    <div className="route-grid">
                      <label className="field"><FieldLabel>轻量模型</FieldLabel><select value={settings.simpleProfileId ?? ''} onChange={(event) => void updateSettings({ simpleProfileId: event.target.value })}><option value="">未设置</option>{profiles.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.model}</option>)}</select></label>
                      <label className="field"><FieldLabel>复杂模型</FieldLabel><select value={settings.complexProfileId ?? ''} onChange={(event) => void updateSettings({ complexProfileId: event.target.value })}><option value="">未设置</option>{profiles.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.model}</option>)}</select></label>
                    </div>
                  ) : null}
                </div>
              ) : null}

              {tab === 'system' ? (
                <div className="settings-section">
                  <div className="section-heading"><Sparkles size={16} /><h3>System Prompt</h3></div>
                  <label className="field"><FieldLabel>当前提示词</FieldLabel><textarea rows={9} value={systemPrompt} onChange={(event) => setSystemPrompt(event.target.value)} /></label>
                  <button className="primary-button full" onClick={() => void updateConversation(conversation.id, { systemPrompt })}>保存 System Prompt</button>
                  <div className="section-divider" />
                  <div className="section-heading"><BrainCircuit size={16} /><h3>长期记忆</h3></div>
                  <div className="memory-status">
                    {conversation.memory.summary
                      ? <span>{conversation.memory.summary}</span>
                      : <span>尚未生成长期摘要</span>}
                  </div>
                  <button
                    className="secondary-button full"
                    onClick={() => void compressNow()}
                    disabled={compressing || conversation.messages.length < 6}
                  >
                    {compressing ? <LoaderCircle size={15} className="spin" /> : <BrainCircuit size={15} />}
                    手动压缩早期对话
                  </button>
                  <div className="section-divider" />
                  <label className="field"><FieldLabel>描述想要的角色</FieldLabel><textarea rows={4} value={description} onChange={(event) => setDescription(event.target.value)} placeholder="例如：严谨的 TypeScript 代码审查助手…" /></label>
                  <button className="secondary-button full" onClick={() => void generate()} disabled={generating || !description.trim()}>
                    {generating ? <LoaderCircle size={15} className="spin" /> : <Sparkles size={15} />} 生成提示词
                  </button>
                  <div className="section-divider" />
                  <div className="section-heading"><BrainCircuit size={16} /><h3>Few-shot 风格示例</h3></div>
                  {settings.fewShotExamples.map((example) => (
                    <div className="few-shot-row" key={example.id}>
                      <span><b>问：{example.input}</b><small>答：{example.output}</small></span>
                      <IconButton label="删除示例" onClick={() => void updateSettings({ fewShotExamples: settings.fewShotExamples.filter((item) => item.id !== example.id) })}><Trash2 size={14} /></IconButton>
                    </div>
                  ))}
                  <div className="few-shot-editor">
                    <label className="field"><FieldLabel>示例提问</FieldLabel><input value={fewInput} onChange={(event) => setFewInput(event.target.value)} /></label>
                    <label className="field"><FieldLabel>精简回答</FieldLabel><textarea rows={3} value={fewOutput} onChange={(event) => setFewOutput(event.target.value)} /></label>
                    <button
                      className="secondary-button full"
                      disabled={!fewInput.trim() || !fewOutput.trim()}
                      onClick={() => {
                        void updateSettings({ fewShotExamples: [...settings.fewShotExamples, { id: crypto.randomUUID(), input: fewInput.trim(), output: fewOutput.trim() }] });
                        setFewInput('');
                        setFewOutput('');
                      }}
                    >
                      <Plus size={15} /> 添加示例
                    </button>
                  </div>
                </div>
              ) : null}

              {tab === 'advanced' ? (
                <div className="settings-section">
                  <div className="section-heading"><Sparkles size={16} /><h3>外观</h3></div>
                  <div className="field"><FieldLabel>主题</FieldLabel><div className="settings-segmented" role="group" aria-label="主题">{([['system', '跟随系统'], ['light', '浅色'], ['dark', '深色']] as const).map(([value, label]) => <button type="button" key={value} className={settings.theme === value ? 'active' : ''} onClick={() => void updateSettings({ theme: value })}>{label}</button>)}</div></div>
                  <div className="section-divider" />
                  <div className="section-heading"><BrainCircuit size={16} /><h3>生成参数</h3></div>
                  <label className="field"><FieldLabel>Temperature · {settings.temperature.toFixed(1)}</FieldLabel><input type="range" min="0" max="2" step="0.1" value={settings.temperature} onChange={(event) => void updateSettings({ temperature: Number(event.target.value) })} /></label>
                  <label className="field"><FieldLabel>Top P · {settings.topP.toFixed(1)}</FieldLabel><input type="range" min="0.1" max="1" step="0.1" value={settings.topP} onChange={(event) => void updateSettings({ topP: Number(event.target.value) })} /></label>
                  <label className="field"><FieldLabel>上下文压缩阈值 · {Math.round(settings.compressionThreshold * 100)}%</FieldLabel><input type="range" min="0.4" max="0.9" step="0.05" value={settings.compressionThreshold} onChange={(event) => void updateSettings({ compressionThreshold: Number(event.target.value) })} /></label>
                  <label className="field"><FieldLabel>检索片段数 · {settings.retrievalTopK}</FieldLabel><input type="range" min="1" max="10" step="1" value={settings.retrievalTopK} onChange={(event) => void updateSettings({ retrievalTopK: Number(event.target.value) })} /></label>
                  <div className="field"><FieldLabel>思考强度</FieldLabel><div className="settings-segmented four" role="group" aria-label="思考强度">{([['minimal', '最低'], ['low', '低'], ['medium', '中'], ['high', '高']] as const).map(([value, label]) => <button type="button" key={value} className={settings.reasoningEffort === value ? 'active' : ''} onClick={() => void updateSettings({ reasoningEffort: value })}>{label}</button>)}</div></div>
                  <label className="field"><FieldLabel>停止词（每行一个）</FieldLabel><textarea rows={3} value={settings.stopSequences.join('\n')} onChange={(event) => void updateSettings({ stopSequences: event.target.value.split('\n').map((item) => item.trim()).filter(Boolean).slice(0, 8) })} /></label>
                </div>
              ) : null}
              {notice ? <div className="settings-notice">{notice}</div> : null}
            </div>
          </motion.aside>
        </>
      ) : null}
    </AnimatePresence>
  );
}
