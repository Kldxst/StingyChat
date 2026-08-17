import { Check, LoaderCircle, RefreshCw, Sparkles } from 'lucide-react';
import { useEffect, useState } from 'react';
import { getUserPreferences, regeneratePersonalization, updateUserPreferences } from '../lib/auth';
import { useAppStore } from '../store';
import type { PersonalizationProfile, UserPreferencesEnvelope } from '../types';

export function PersonalizationSettings() {
  const applyPreferences = useAppStore((state) => state.applyPreferences);
  const current = useAppStore((state) => state.personalization);
  const [envelope, setEnvelope] = useState<UserPreferencesEnvelope>();
  const [proposal, setProposal] = useState<PersonalizationProfile>();
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  useEffect(() => { void getUserPreferences().then(setEnvelope).catch((error) => setNotice(error instanceof Error ? error.message : '无法读取个性设置')); }, []);
  const regenerate = async () => {
    setBusy(true); setNotice('');
    try { const result = await regeneratePersonalization(envelope?.onboardingAnswers); setProposal(result.profile); setNotice(result.pending ? '智能服务暂时不可用，已生成安全基础配置。' : '已生成预览，确认前不会覆盖现有配置。'); }
    catch (error) { setNotice(error instanceof Error ? error.message : '重新生成失败'); }
    finally { setBusy(false); }
  };
  const apply = async () => {
    if (!proposal || !envelope) return;
    setBusy(true);
    try { const saved = await updateUserPreferences({ ...envelope, settings: { ...envelope.settings, temperature: proposal.temperature, topP: proposal.topP, reasoningEffort: proposal.reasoningEffort, webSearch: proposal.webSearch, autoSkills: proposal.autoSkills }, personalization: proposal, onboardingStatus: 'complete' }); setEnvelope(saved); applyPreferences(saved); setProposal(undefined); setNotice('个性配置已应用。'); }
    catch (error) { setNotice(error instanceof Error ? error.message : '应用失败'); }
    finally { setBusy(false); }
  };
  const shown = proposal ?? current;
  return <div className="settings-section personalization-settings">
    <div className="section-heading"><Sparkles size={16} /><h3>个性配置</h3></div>
    <div className="privacy-note">引导答案在写入 D1 前使用 AES-GCM 加密。重新生成仅创建预览，确认后才会替换当前配置。</div>
    {shown ? <div className="personalization-summary"><span><small>回答风格</small><b>{shown.answerLength} · {shown.tone} · {shown.structure}</b></span><span><small>生成参数</small><b>T {shown.temperature.toFixed(1)} · P {shown.topP.toFixed(2)}</b></span><span><small>推理与能力</small><b>{shown.reasoningEffort} · {shown.autoSkills ? '自动 Skills' : '按需 Skills'}</b></span><p>{shown.systemPromptPrefix}</p></div> : <div className="settings-notice">正在读取个性配置…</div>}
    <button className="secondary-button full" disabled={busy || !envelope?.onboardingAnswers} onClick={() => void regenerate()}>{busy ? <LoaderCircle size={15} className="spin" /> : <RefreshCw size={15} />}重新生成预览</button>
    {proposal ? <button className="primary-button full" disabled={busy} onClick={() => void apply()}><Check size={15} />确认应用</button> : null}
    {notice ? <div className="settings-notice">{notice}</div> : null}
  </div>;
}
