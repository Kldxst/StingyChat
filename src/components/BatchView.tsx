import { Archive, Download, LoaderCircle, Play, RefreshCw, Upload } from 'lucide-react';
import Papa from 'papaparse';
import { useMemo, useState } from 'react';
import { downloadBatchResults, getBatchStatus, submitBatch } from '../lib/api';
import { loadProviderSecret } from '../lib/crypto';
import { estimateTokens } from '../lib/tokens';
import { useAppStore } from '../store';

interface BatchInput {
  customId: string;
  prompt: string;
  systemPrompt?: string;
}

function parseBatchInput(text: string): BatchInput[] {
  const clean = text.trim();
  if (!clean) return [];
  if (clean.startsWith('{')) {
    return clean.split(/\n+/u).map((line, index) => {
      const item = JSON.parse(line) as Record<string, unknown>;
      const prompt = String(item.prompt ?? item.input ?? '');
      if (!prompt) throw new Error(`第 ${index + 1} 行缺少 prompt`);
      return { customId: String(item.customId ?? item.custom_id ?? `task-${index + 1}`), prompt, systemPrompt: item.systemPrompt ? String(item.systemPrompt) : undefined };
    });
  }
  const parsed = Papa.parse<Record<string, string>>(clean, { header: true, skipEmptyLines: true });
  if (parsed.errors.length) throw new Error(parsed.errors[0].message);
  return parsed.data.map((item, index) => ({ customId: item.customId || item.custom_id || `task-${index + 1}`, prompt: item.prompt || item.input, systemPrompt: item.systemPrompt })).filter((item) => Boolean(item.prompt));
}

export function BatchView() {
  const profiles = useAppStore((state) => state.profiles);
  const supported = profiles.filter((profile) => profile.capabilities.batch && (profile.kind === 'openai' || profile.kind === 'anthropic'));
  const [profileId, setProfileId] = useState(supported[0]?.id ?? '');
  const profile = supported.find((item) => item.id === profileId) ?? supported[0];
  const [input, setInput] = useState('customId,prompt\ntask-1,"用一句话解释提示词缓存"\ntask-2,"只输出三个节省 Token 的方法"');
  const [batchId, setBatchId] = useState('');
  const [status, setStatus] = useState<Record<string, unknown>>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [inputPrice, setInputPrice] = useState('0');
  const [outputPrice, setOutputPrice] = useState('0');
  const parseResult = useMemo(() => {
    try { return { items: parseBatchInput(input), error: '' }; }
    catch (caught) { return { items: [], error: caught instanceof Error ? caught.message : '输入格式无效' }; }
  }, [input]);
  const parsed = parseResult.items;
  const estimatedTokens = parsed.reduce((sum, item) => sum + estimateTokens(item.prompt), 0);
  const estimatedMaxOutputTokens = parsed.length * 1024;
  const estimatedPrice = (
    estimatedTokens * Math.max(0, Number(inputPrice) || 0)
    + estimatedMaxOutputTokens * Math.max(0, Number(outputPrice) || 0)
  ) / 1_000_000;

  const withKey = async <T,>(work: (key: string) => Promise<T>): Promise<T> => {
    if (!profile) throw new Error('没有支持批处理的 Provider');
    const key = await loadProviderSecret(profile.id);
    if (!key) throw new Error(`请先在设置中保存 ${profile.name} API Key`);
    return work(key);
  };

  const submit = async () => {
    setBusy(true); setError('');
    try {
      const items = parseBatchInput(input);
      if (!items.length) throw new Error('没有可提交的任务');
      const result = await withKey((key) => submitBatch(profile, key, items));
      const id = String(result.id ?? '');
      setBatchId(id); setStatus(result);
    } catch (caught) { setError(caught instanceof Error ? caught.message : '提交失败'); }
    finally { setBusy(false); }
  };

  const refresh = async () => {
    if (!batchId) return;
    setBusy(true); setError('');
    try { setStatus(await withKey((key) => getBatchStatus(profile, key, batchId))); }
    catch (caught) { setError(caught instanceof Error ? caught.message : '查询失败'); }
    finally { setBusy(false); }
  };

  const download = async () => {
    if (!batchId) return;
    setBusy(true); setError('');
    try {
      const blob = await withKey((key) => downloadBatchResults(profile, key, batchId));
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url; anchor.download = `${batchId}.jsonl`; anchor.click();
      URL.revokeObjectURL(url);
    } catch (caught) { setError(caught instanceof Error ? caught.message : '下载失败'); }
    finally { setBusy(false); }
  };

  return (
    <main className="workspace-view batch-view">
      <header className="workspace-heading">
        <div><Archive size={22} /><span><h1>批处理工作台</h1><p>非实时任务直接提交至 Provider</p></span></div>
      </header>
      <div className="batch-grid">
        <section className="batch-editor">
          <label>Provider<select value={profile?.id ?? ''} onChange={(event) => setProfileId(event.target.value)}>{supported.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.model}</option>)}</select></label>
          <label>JSONL 或带表头的 CSV<textarea value={input} onChange={(event) => setInput(event.target.value)} rows={14} spellCheck={false} /></label>
          <label className="secondary-button batch-upload">
            <Upload size={15} /> 导入 JSONL / CSV
            <input
              type="file"
              accept=".jsonl,.csv,application/json,text/csv"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (!file) return;
                void file.text().then(setInput).catch(() => setError('无法读取批处理文件'));
                event.target.value = '';
              }}
            />
          </label>
          <div className="batch-price-grid">
            <label>输入价格 / 百万 Token<input type="number" min="0" step="0.01" value={inputPrice} onChange={(event) => setInputPrice(event.target.value)} /></label>
            <label>输出价格 / 百万 Token<input type="number" min="0" step="0.01" value={outputPrice} onChange={(event) => setOutputPrice(event.target.value)} /></label>
          </div>
          <div className="batch-summary">
            <span>{parsed.length} 个任务 · 约 {estimatedTokens.toLocaleString('zh-CN')} 输入 Token</span>
            <span>{estimatedPrice > 0 ? `费用上限估算 $${estimatedPrice.toFixed(4)}` : '填写 Provider 单价后估算费用'}</span>
          </div>
          {parseResult.error ? <div className="inline-error">{parseResult.error}</div> : null}
          <button className="primary-button" onClick={() => void submit()} disabled={busy || !profile || !parsed.length}>{busy ? <LoaderCircle size={16} className="spin" /> : <Play size={16} />} 提交批处理</button>
        </section>
        <section className="batch-status">
          <h2>任务状态</h2>
          {status ? <pre>{JSON.stringify(status, null, 2)}</pre> : <div className="empty-panel"><Archive size={22} /><p>提交后在这里查看状态</p></div>}
          {batchId ? <div className="batch-actions"><button className="secondary-button" onClick={() => void refresh()} disabled={busy}><RefreshCw size={15} /> 刷新</button><button className="secondary-button" onClick={() => void download()} disabled={busy}><Download size={15} /> 下载结果</button></div> : null}
        </section>
      </div>
      {error ? <div className="inline-error">{error}</div> : null}
    </main>
  );
}
