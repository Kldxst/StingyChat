import { ArrowUp, BrainCircuit, FileCode2, FileText, Globe2, LoaderCircle, Paperclip, Sparkles, WandSparkles, X } from 'lucide-react';
import { useEffect, useRef, useState, type ClipboardEvent, type DragEvent, type KeyboardEvent } from 'react';
import type { ChatAttachment, ProviderProfile } from '../types';
import { useAppStore } from '../store';
import { IconButton } from './ui';
import { createPastedTextAttachment, LONG_PASTE_CHAR_THRESHOLD, prepareChatAttachments } from '../lib/attachments';
import { estimateTokens, formatTokenCount } from '../lib/tokens';
import { skillName } from '../lib/skills';
import { SkillPicker } from './SkillPicker';

export function Composer({
  conversationId,
  profile,
  busy,
  onSend,
  onOptimize,
  replacement,
  onReplacementApplied,
}: {
  conversationId: string;
  profile: ProviderProfile;
  busy: boolean;
  onSend: (text: string, attachments: ChatAttachment[], skillIds: string[]) => Promise<boolean>;
  onOptimize: (text: string) => Promise<void>;
  replacement?: string;
  onReplacementApplied?: () => void;
}) {
  const [text, setText] = useState('');
  const [optimizing, setOptimizing] = useState(false);
  const [attachments, setAttachments] = useState<ChatAttachment[]>([]);
  const [attachmentError, setAttachmentError] = useState('');
  const [dragging, setDragging] = useState(false);
  const [skillsOpen, setSkillsOpen] = useState(false);
  const [selectedSkillIds, setSelectedSkillIds] = useState<string[]>([]);
  const [composerNotice, setComposerNotice] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const settings = useAppStore((state) => state.settings);
  const auth = useAppStore((state) => state.auth);
  const updateSettings = useAppStore((state) => state.updateSettings);
  const estimatedTokens = estimateTokens(text) + attachments.reduce((total, attachment) => (
    total + (attachment.kind === 'image' ? Math.ceil(attachment.size / 750) : estimateTokens(attachment.text ?? ''))
  ), 0);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = '0px';
    textarea.style.height = `${Math.min(textarea.scrollHeight, 190)}px`;
  }, [text]);

  useEffect(() => {
    if (replacement === undefined) return;
    setText(replacement);
    onReplacementApplied?.();
  }, [onReplacementApplied, replacement]);

  useEffect(() => {
    setText('');
    setAttachments([]);
    setSelectedSkillIds([]);
    setSkillsOpen(false);
    setAttachmentError('');
    setComposerNotice('');
  }, [conversationId]);

  const submit = async () => {
    const value = text.trim();
    if ((!value && !attachments.length) || busy) return;
    const success = await onSend(value || '请分析附件。', attachments, selectedSkillIds);
    if (success) {
      setText('');
      setAttachments([]);
      setSelectedSkillIds([]);
      setComposerNotice('');
    }
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void submit();
    }
  };

  const optimize = async () => {
    if (!text.trim() || optimizing) return;
    setOptimizing(true);
    await onOptimize(text);
    setOptimizing(false);
  };

  const addFiles = async (files: File[]) => {
    if (!files.length) return;
    setAttachmentError('');
    try {
      const prepared = await prepareChatAttachments(files);
      setAttachments((current) => [...current, ...prepared].slice(0, 8));
    } catch (error) {
      setAttachmentError(error instanceof Error ? error.message : '附件处理失败');
    }
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(false);
    void addFiles([...event.dataTransfer.files]);
  };

  const handleTextChange = (value: string) => {
    if (/(^|\s)\$\$$/u.test(value)) {
      setText(value.slice(0, -2).trimEnd());
      if (auth.authenticated) setSkillsOpen(true);
      else setComposerNotice('登录后可使用 Skills 与自动工具。');
      return;
    }
    setText(value);
  };

  const handlePaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    const pasted = event.clipboardData.getData('text/plain');
    if (pasted.length < LONG_PASTE_CHAR_THRESHOLD) return;
    event.preventDefault();
    if (attachments.length >= 8) {
      setAttachmentError('每次最多添加 8 个附件');
      return;
    }
    setAttachments((current) => [...current, createPastedTextAttachment(pasted)]);
    setComposerNotice(`已将 ${pasted.length.toLocaleString('zh-CN')} 字的粘贴内容转换为本地附件`);
  };

  const toggleFileSkill = () => setSelectedSkillIds((current) => current.includes('file-generation')
    ? current.filter((id) => id !== 'file-generation')
    : [...current, 'file-generation']);

  return (
    <div className="composer-wrap">
      <div
        className={`composer ${dragging ? 'is-dragging' : ''}`}
        onDragEnter={(event) => { event.preventDefault(); setDragging(true); }}
        onDragOver={(event) => event.preventDefault()}
        onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setDragging(false); }}
        onDrop={handleDrop}
      >
        <SkillPicker open={skillsOpen} selected={selectedSkillIds} onChange={setSelectedSkillIds} onClose={() => setSkillsOpen(false)} />
        {selectedSkillIds.length ? (
          <div className="selected-skills">
            {selectedSkillIds.map((id) => <button type="button" key={id} onClick={() => setSelectedSkillIds((current) => current.filter((item) => item !== id))}>{skillName(id)} <X size={11} /></button>)}
          </div>
        ) : null}
        {attachments.length ? (
          <div className="attachment-strip">
            {attachments.map((attachment) => (
              <div className="attachment-chip" key={attachment.id}>
                {attachment.kind === 'image' && attachment.dataUrl
                  ? <img src={attachment.dataUrl} alt="" />
                  : <span><FileText size={15} /></span>}
                <b>{attachment.name}</b>
                <button type="button" aria-label={`移除 ${attachment.name}`} onClick={() => setAttachments((current) => current.filter((item) => item.id !== attachment.id))}><X size={13} /></button>
              </div>
            ))}
          </div>
        ) : null}
        <textarea
          ref={textareaRef}
          value={text}
          onChange={(event) => handleTextChange(event.target.value)}
          onPaste={handlePaste}
          onKeyDown={handleKeyDown}
          placeholder={`给 ${profile.name} 发送消息`}
          rows={1}
          aria-label="消息"
        />
        <div className="composer-toolbar">
          <div className="composer-tools">
            <IconButton label="添加图片或文件" onClick={() => fileRef.current?.click()} disabled={busy}>
              <Paperclip size={17} />
            </IconButton>
            <input
              ref={fileRef}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif,.txt,.md,.pdf,.docx,text/plain,text/markdown,application/pdf"
              multiple
              hidden
              onChange={(event) => {
                void addFiles([...(event.target.files ?? [])]);
                event.target.value = '';
              }}
            />
            <IconButton
              label="智能优化提示词"
              className={`spark-button ${optimizing ? 'is-loading' : ''}`}
              onClick={() => void optimize()}
              disabled={!auth.authenticated || !text.trim() || optimizing}
            >
              {optimizing ? <LoaderCircle size={17} className="spin" /> : <Sparkles size={17} />}
            </IconButton>
            <IconButton label={auth.authenticated ? '选择 Skills（也可输入 $$）' : '登录后可使用 Skills'} disabled={!auth.authenticated} className={selectedSkillIds.length ? 'active-tool' : ''} onClick={() => setSkillsOpen(true)}>
              <WandSparkles size={17} />
            </IconButton>
            <IconButton label="文件生成模式" disabled={!auth.authenticated} className={selectedSkillIds.includes('file-generation') ? 'active-tool' : ''} onClick={toggleFileSkill}>
              <FileCode2 size={17} />
            </IconButton>
            <button
              type="button"
              className={`tool-chip ${settings.reasoningEnabled ? 'active' : ''}`}
              disabled={!auth.authenticated}
              onClick={() => void updateSettings({ reasoningEnabled: !settings.reasoningEnabled })}
              title={profile.capabilities.reasoning ? '使用当前模型的原生思考能力' : '由智能助手生成可公开的辅助推演'}
            >
              <BrainCircuit size={15} /> 思考
            </button>
            {settings.reasoningEnabled ? (
              <div className="reasoning-effort-control" role="group" aria-label="思考强度">
                {([['minimal', '最低'], ['low', '低'], ['medium', '中'], ['high', '高']] as const).map(([value, label]) => (
                  <button
                    type="button"
                    key={value}
                    className={settings.reasoningEffort === value ? 'active' : ''}
                    aria-pressed={settings.reasoningEffort === value}
                    onClick={() => void updateSettings({ reasoningEffort: value })}
                  >{label}</button>
                ))}
              </div>
            ) : null}
            <button
              type="button"
              className={`tool-chip ${settings.webSearch ? 'active' : ''}`}
              disabled={!auth.authenticated}
              onClick={() => void updateSettings({ webSearch: !settings.webSearch })}
              title={profile.capabilities.webSearch ? '允许模型使用联网搜索' : '允许联网；当前模型可能忽略此选项'}
            >
              <Globe2 size={15} /> 联网
            </button>
          </div>
          <IconButton label="发送" className="send-button" onClick={() => void submit()} disabled={(!text.trim() && !attachments.length) || busy}>
            {busy ? <LoaderCircle size={17} className="spin" /> : <ArrowUp size={18} />}
          </IconButton>
        </div>
      </div>
      {attachmentError ? <small className="composer-error">{attachmentError}</small> : null}
      {composerNotice ? <small className="composer-notice">{composerNotice}</small> : null}
      <small className="composer-footnote">Enter 发送 · Shift + Enter 换行 <span>发送前约 {formatTokenCount(estimatedTokens)} Token</span></small>
    </div>
  );
}
