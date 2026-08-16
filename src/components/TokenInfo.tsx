import { Info } from 'lucide-react';
import type { TokenTelemetry } from '../types';
import { formatTokenCount } from '../lib/tokens';

export function TokenInfo({ telemetry }: { telemetry: TokenTelemetry }) {
  return (
    <span className="token-info">
      <button type="button" aria-label="查看 Token 用量">
        <Info size={13} />
      </button>
      <span className="token-popover" role="tooltip">
        <strong>{telemetry.source === 'provider' ? 'Provider 实际用量' : '本地估算用量'}</strong>
        <span><i>输入</i><b>{formatTokenCount(telemetry.inputTokens)}</b></span>
        <span><i>输出</i><b>{formatTokenCount(telemetry.outputTokens)}</b></span>
        {telemetry.reasoningTokens > 0 ? <span><i>推理</i><b>{formatTokenCount(telemetry.reasoningTokens)}</b></span> : null}
        {telemetry.cachedTokens > 0 ? <span><i>缓存命中</i><b>{formatTokenCount(telemetry.cachedTokens)}</b></span> : null}
        <hr />
        <span><i>实际发送</i><b>{formatTokenCount(telemetry.estimatedSent)}</b></span>
        <span className="saved"><i>估算节省</i><b>-{formatTokenCount(telemetry.estimatedSaved)}</b></span>
        {telemetry.savings ? (
          <span className="token-breakdown">
            <small>提示词 -{formatTokenCount(telemetry.savings.promptCompression)}</small>
            <small>历史 -{formatTokenCount(telemetry.savings.contextPruning)}</small>
            <small>JIT -{formatTokenCount(telemetry.savings.jitRetrieval)}</small>
            <small>语义缓存 -{formatTokenCount(telemetry.savings.semanticCache)}</small>
            <small>Prompt Cache {formatTokenCount(telemetry.savings.promptCache)}</small>
          </span>
        ) : null}
      </span>
    </span>
  );
}
