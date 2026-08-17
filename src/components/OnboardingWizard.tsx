import { ArrowLeft, ArrowRight, Check, Gauge, Sparkles } from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useMemo, useState } from 'react';
import { completeOnboarding, updateUserPreferences } from '../lib/auth';
import { useAppStore } from '../store';
import type { OnboardingAnswers, PersonalizationProfile, UserPreferencesEnvelope } from '../types';

type ChoiceKey = Exclude<keyof OnboardingAnswers, 'useCase'>;
export const ONBOARDING_QUESTIONS: Array<{ key: keyof OnboardingAnswers; title: string; note: string; options?: Array<[string, string]> }> = [
  { key: 'useCase', title: '你主要用 AI 完成什么工作？', note: '可以填写多个场景，例如编程、研究、写作或日常决策。' },
  { key: 'expertise', title: '你的专业熟练度', note: '用于调整术语密度和基础概念说明。', options: [['beginner', '入门'], ['intermediate', '熟练'], ['advanced', '专业']] },
  { key: 'answerLength', title: '默认回答长度', note: '遇到复杂问题时仍会保留必要细节。', options: [['brief', '精简'], ['balanced', '适中'], ['detailed', '详细']] },
  { key: 'reasoningDepth', title: '解释与推理深度', note: '控制解题说明和验证过程的展开程度。', options: [['minimal', '结论优先'], ['balanced', '平衡'], ['deep', '深入']] },
  { key: 'tone', title: '交流语气', note: '仅影响表达方式，不影响事实标准。', options: [['formal', '正式'], ['neutral', '中性'], ['friendly', '友好']] },
  { key: 'structure', title: '首选内容结构', note: '模型会在适合任务的前提下优先采用。', options: [['prose', '连贯正文'], ['bullets', '要点列表'], ['steps', '分步说明']] },
  { key: 'proactivity', title: '主动建议程度', note: '决定是否主动指出风险、替代方案和下一步。', options: [['low', '按需回答'], ['medium', '适度建议'], ['high', '积极建议']] },
  { key: 'evidencePreference', title: '证据、引用与联网偏好', note: '联网仍取决于当前模型和你的即时开关。', options: [['none', '默认不检索'], ['when-needed', '必要时'], ['always', '优先核验']] },
  { key: 'creativity', title: '创造性与确定性', note: '用于生成温度等参数的安全初始值。', options: [['deterministic', '稳定确定'], ['balanced', '平衡'], ['creative', '开放创意']] },
  { key: 'priority', title: '速度、成本与质量', note: '用于选择默认优化预设，不会替你购买任何服务。', options: [['speed', '速度优先'], ['cost', '成本优先'], ['quality', '质量优先']] },
];

const INITIAL: OnboardingAnswers = { useCase: '', expertise: 'intermediate', answerLength: 'balanced', reasoningDepth: 'balanced', tone: 'neutral', structure: 'bullets', proactivity: 'medium', evidencePreference: 'when-needed', creativity: 'balanced', priority: 'quality' };

export function OnboardingWizard() {
  const reduceMotion = useReducedMotion();
  const applyPreferences = useAppStore((state) => state.applyPreferences);
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState(INITIAL);
  const [working, setWorking] = useState(false);
  const [proposal, setProposal] = useState<PersonalizationProfile>();
  const [saved, setSaved] = useState<UserPreferencesEnvelope>();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const question = ONBOARDING_QUESTIONS[step];
  const canContinue = question.key !== 'useCase' || answers.useCase.trim().length > 0;
  const summary = useMemo(() => proposal ? [proposal.answerLength, proposal.tone, proposal.structure, proposal.optimizationPreset].join(' · ') : '', [proposal]);

  const next = async () => {
    if (!canContinue) return;
    if (step < ONBOARDING_QUESTIONS.length - 1) { setStep((value) => value + 1); return; }
    setWorking(true); setError('');
    try {
      const result = await completeOnboarding(answers);
      setProposal(result.profile); setPending(result.pending); setSaved(result.preferences);
    } catch (caught) { setError(caught instanceof Error ? caught.message : '个性配置生成失败'); }
    finally { setWorking(false); }
  };

  const apply = async () => {
    if (!saved || !proposal) return;
    setWorking(true); setError('');
    try {
      if (pending) { applyPreferences(saved); return; }
      const value = await updateUserPreferences({
        ...saved,
        settings: { ...saved.settings, temperature: proposal.temperature, topP: proposal.topP, reasoningEffort: proposal.reasoningEffort, webSearch: proposal.webSearch, autoSkills: proposal.autoSkills },
        personalization: proposal,
        onboardingStatus: 'complete',
      });
      applyPreferences(value);
    } catch (caught) { setError(caught instanceof Error ? caught.message : '应用配置失败'); }
    finally { setWorking(false); }
  };

  return <main className="onboarding-shell">
    <div className="onboarding-ambient" aria-hidden="true" />
    <section className="onboarding-card" aria-live="polite">
      <header><div className="onboarding-brand"><span><Sparkles size={18} /></span><div><strong>建立你的 StingyChat</strong><small>个性参数仅用于改善回答体验</small></div></div><b>{proposal ? '预览' : `${step + 1} / 10`}</b></header>
      <div className="onboarding-track"><motion.i animate={{ width: proposal ? '100%' : `${((step + 1) / 10) * 100}%` }} transition={reduceMotion ? { duration: 0 } : { type: 'spring', stiffness: 180, damping: 24 }} /></div>
      <AnimatePresence mode="wait">
        {proposal ? <motion.div key="preview" className="personalization-preview" initial={reduceMotion ? false : { opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
          <div className="preview-icon"><Gauge size={28} /></div><h1>{pending ? '基础配置已准备就绪' : '个性配置已生成'}</h1>
          <p>{pending ? '智能服务当前繁忙。答案已加密保存，你可以先使用基础配置，稍后在设置中重新生成。' : '应用前请确认以下配置。你可以随时在设置中逐项调整或重新生成。'}</p>
          <div className="preview-grid"><span><small>风格组合</small><b>{summary}</b></span><span><small>随机性</small><b>{proposal.temperature.toFixed(1)} / {proposal.topP.toFixed(2)}</b></span><span><small>推理强度</small><b>{proposal.reasoningEffort}</b></span><span><small>自动能力</small><b>{proposal.autoSkills ? 'Skills' : '按需'} · {proposal.webSearch ? '建议联网' : '本地优先'}</b></span></div>
          <blockquote>{proposal.systemPromptPrefix}</blockquote>
          <button className="onboarding-primary" disabled={working} onClick={() => void apply()}>{working ? '正在应用…' : pending ? '使用基础配置进入' : '确认并进入'}<Check size={17} /></button>
        </motion.div> : <motion.div key={question.key} className="onboarding-question" initial={reduceMotion ? false : { opacity: 0, x: 24 }} animate={{ opacity: 1, x: 0 }} exit={reduceMotion ? { opacity: 0 } : { opacity: 0, x: -20 }} transition={{ duration: 0.22 }}>
          <span className="question-kicker">个性引导</span><h1>{question.title}</h1><p>{question.note}</p>
          {question.key === 'useCase' ? <textarea autoFocus rows={5} maxLength={500} value={answers.useCase} onChange={(event) => setAnswers({ ...answers, useCase: event.target.value })} placeholder="例如：前端工程、技术调研和中文写作" /> : <div className="onboarding-options" role="radiogroup">{question.options!.map(([value, label]) => <button key={value} role="radio" aria-checked={answers[question.key as ChoiceKey] === value} className={answers[question.key as ChoiceKey] === value ? 'active' : ''} onClick={() => setAnswers({ ...answers, [question.key]: value })}><span>{label}</span>{answers[question.key as ChoiceKey] === value ? <Check size={17} /> : null}</button>)}</div>}
          <footer><button className="onboarding-back" disabled={step === 0 || working} onClick={() => setStep((value) => value - 1)}><ArrowLeft size={17} />返回</button><button className="onboarding-primary" disabled={!canContinue || working} onClick={() => void next()}>{working ? '正在生成…' : step === 9 ? '生成个性配置' : '继续'}<ArrowRight size={17} /></button></footer>
        </motion.div>}
      </AnimatePresence>
      {error ? <div className="onboarding-error" role="alert">{error}</div> : null}
      <small className="onboarding-privacy">十项答案使用 AES-GCM 加密后保存；API Key 不会同步到用户数据库。</small>
    </section>
  </main>;
}
