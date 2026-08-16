import type { ChatAttachment, GeneratedArtifact, SkillExecution } from '../types';
import { extractGeneratedArtifacts } from './artifacts';

interface ChatSkill {
  id: string;
  name: string;
  description: string;
  category: '效率' | '开发' | '内容' | '分析';
  prompt: string;
  source: string;
  sourceUrl: string;
  runtime: 'workflow' | 'browser' | 'postprocess';
  autoPatterns: RegExp[];
  fileOutput?: boolean;
}

interface SkillRunResult {
  skillIds: string[];
  contextBlocks: string[];
  executions: SkillExecution[];
}

const anthropicSkills = 'https://github.com/anthropics/skills';

export const CHAT_SKILLS: ChatSkill[] = [
  {
    id: 'file-generation', name: '文件生成', category: '效率', runtime: 'postprocess', fileOutput: true,
    description: '将模型代码块转换为可预览、下载的真实文件', source: 'Anthropic Agent Skills / 本地 artifact 处理器', sourceUrl: `${anthropicSkills}/tree/main/skills`,
    prompt: '需要交付文件时，每个文件使用独立 Markdown 代码块，元信息写成 ```语言 filename="文件名.扩展名"。不要合并多个文件。',
    autoPatterns: [/生成.{0,8}(?:文件|网页|脚本|组件)/u, /(?:创建|导出|下载).{0,8}(?:csv|json|md|html|svg|代码)/iu, /\bfile\b|downloadable/iu],
  },
  {
    id: 'calculator', name: '精确计算', category: '分析', runtime: 'browser',
    description: '使用 mathjs 计算表达式，再把结果交给模型解释', source: 'mathjs', sourceUrl: 'https://www.npmjs.com/package/mathjs',
    prompt: '优先采用工具返回的精确计算结果；不要重新心算覆盖工具结果。',
    autoPatterns: [/(?:计算|求值|等于多少|百分比|换算).{0,80}\d/u, /\d\s*(?:\+|-|\*|\/|\^|%|×|÷)\s*\d/u, /\b(?:calculate|compute|evaluate)\b/iu],
  },
  {
    id: 'json-repair', name: 'JSON 修复', category: '开发', runtime: 'browser',
    description: '使用 jsonrepair 修复并验证不规范 JSON', source: 'jsonrepair', sourceUrl: 'https://www.npmjs.com/package/jsonrepair',
    prompt: '使用工具提供的已修复 JSON；不得再次引入注释、尾逗号或非 JSON 文本。',
    autoPatterns: [/(?:修复|整理|校验|格式化).{0,12}json/iu, /json.{0,12}(?:报错|无效|解析|repair|invalid)/iu],
  },
  {
    id: 'data-analysis', name: '数据分析', category: '分析', runtime: 'browser',
    description: '用 PapaParse 对 CSV 做结构、缺失值和样本概览', source: 'PapaParse', sourceUrl: 'https://www.npmjs.com/package/papaparse',
    prompt: '先采用工具返回的数据列、行数和缺失值统计，再分析口径与异常。',
    autoPatterns: [/(?:csv|表格|数据集).{0,16}(?:分析|统计|列|缺失|异常)/iu, /(?:分析|统计).{0,16}(?:csv|表格|数据)/iu],
  },
  {
    id: 'document-reader', name: '文档理解', category: '分析', runtime: 'workflow',
    description: '结合 PDF.js、Mammoth 与本地 JIT 检索读取附件', source: 'PDF.js + Mammoth', sourceUrl: 'https://github.com/mozilla/pdf.js',
    prompt: '只依据已注入的附件片段回答，区分原文、推断与未找到的信息，并标明附件名。',
    autoPatterns: [/(?:附件|文档|pdf|docx).{0,16}(?:总结|分析|读取|提取|查找)/iu],
  },
  {
    id: 'code-engineer', name: '工程实现', category: '开发', runtime: 'workflow', fileOutput: true,
    description: '按成熟 Agent Skills 工作流交付可运行实现', source: 'Anthropic Agent Skills', sourceUrl: `${anthropicSkills}/tree/main/skills/web-artifacts-builder`,
    prompt: '遵循现有技术栈，覆盖失败路径、类型和测试；多文件实现逐文件交付并标注文件名。',
    autoPatterns: [/(?:实现|开发|编写|重构|修复).{0,20}(?:代码|组件|接口|应用|函数|bug)/iu, /\b(?:implement|build|refactor|fix)\b.{0,30}\b(?:code|component|api|app|bug)\b/iu],
  },
  {
    id: 'code-review', name: '代码审查', category: '开发', runtime: 'workflow',
    description: '按严重程度定位缺陷、回归风险与缺失测试', source: 'Anthropic Agent Skills workflow', sourceUrl: anthropicSkills,
    prompt: 'findings 优先并按严重程度排序；每项给出位置、触发条件、影响和最小修复。',
    autoPatterns: [/(?:审查|review|检查).{0,16}(?:代码|提交|pr|diff)/iu, /code review/iu],
  },
  {
    id: 'deep-research', name: '深度研究', category: '分析', runtime: 'workflow',
    description: '拆分问题、交叉验证来源并标注不确定性', source: 'Anthropic Agent Skills workflow', sourceUrl: anthropicSkills,
    prompt: '拆成可验证子问题，优先一手来源，区分事实、推断与未知，并为时效性结论附来源日期。',
    autoPatterns: [/(?:深入|深度|全面).{0,8}(?:研究|调研|对比|分析)/u, /\bdeep research\b/iu],
  },
  {
    id: 'structured-json', name: '结构化 JSON', category: '分析', runtime: 'workflow',
    description: '按稳定 Schema 输出机器可解析 JSON', source: 'Agent Skills specification', sourceUrl: `${anthropicSkills}/blob/main/spec/agent-skills-spec.md`,
    prompt: '只输出合法 JSON，不使用 Markdown；字段稳定，无法确定的值用 null。',
    autoPatterns: [/(?:只|输出|返回).{0,8}json/iu, /json.{0,8}(?:格式|schema|结构)/iu],
  },
  {
    id: 'concise-expert', name: '极简专家', category: '效率', runtime: 'workflow',
    description: '删除寒暄、复述和重复总结', source: 'StingyChat curated workflow', sourceUrl: 'https://github.com/Kldxst/StingyChat',
    prompt: '先给可执行结论，只保留必要依据；禁止寒暄、复述问题和重复总结。',
    autoPatterns: [/(?:简短|简洁|精简|只要结论|不要废话)/u, /\b(?:concise|brief|short answer)\b/iu],
  },
  {
    id: 'document-writer', name: '文档撰写', category: '内容', runtime: 'workflow',
    description: '采用文档协作工作流组织专业文档', source: 'Anthropic Doc Coauthoring Skill', sourceUrl: `${anthropicSkills}/tree/main/skills/doc-coauthoring`,
    prompt: '先确定读者与目标，使用清晰层级、短段落和具体措辞，保留限制与行动项。',
    autoPatterns: [/(?:撰写|编写|起草).{0,12}(?:文档|说明|报告|readme|方案)/iu],
  },
  {
    id: 'translator', name: '精准翻译', category: '内容', runtime: 'workflow',
    description: '保留术语、格式、语气与事实边界', source: 'StingyChat curated workflow', sourceUrl: 'https://github.com/Kldxst/StingyChat',
    prompt: '忠实翻译，保留专有名词、数值、代码、链接和格式；术语前后一致，不擅自扩写。',
    autoPatterns: [/(?:翻译|译成|中译英|英译中)/u, /\btranslate\b/iu],
  },
];

const skillById = new Map(CHAT_SKILLS.map((skill) => [skill.id, skill]));

export function autoSelectSkillIds(prompt: string, attachments: ChatAttachment[] = []): string[] {
  const selected = new Set<string>();
  for (const skill of CHAT_SKILLS) {
    if (skill.autoPatterns.some((pattern) => pattern.test(prompt))) selected.add(skill.id);
  }
  if (attachments.some((item) => item.kind === 'document')) selected.add('document-reader');
  if (attachments.some((item) => /(?:csv|comma-separated-values)/iu.test(`${item.name} ${item.mimeType}`))) selected.add('data-analysis');
  return [...selected].slice(0, 4);
}

function execution(skill: ChatSkill, startedAt: number, status: SkillExecution['status'], summary: string, phase: SkillExecution['phase'] = 'preflight'): SkillExecution {
  return { id: skill.id, name: skill.name, source: skill.source, phase, status, summary, durationMs: Math.max(0, Math.round(performance.now() - startedAt)) };
}

function jsonCandidate(prompt: string, attachments: ChatAttachment[]): string | undefined {
  const fenced = prompt.match(/```(?:json)?\s*([\s\S]*?)```/iu)?.[1];
  if (fenced?.trim()) return fenced.trim();
  const attachment = attachments.find((item) => item.text && /json/iu.test(`${item.name} ${item.mimeType}`));
  if (attachment?.text) return attachment.text;
  const start = Math.min(...['{', '['].map((char) => { const index = prompt.indexOf(char); return index < 0 ? Infinity : index; }));
  return Number.isFinite(start) ? prompt.slice(start).trim() : undefined;
}

function expressionCandidate(prompt: string): string | undefined {
  const normalized = prompt.replace(/[，。？?]/gu, ' ').replace(/×/gu, '*').replace(/÷/gu, '/');
  return normalized.match(/(?:^|\s)([-+*/^().,%\d\s]{3,})(?:$|\s)/u)?.[1]?.trim();
}

export async function executePreflightSkills(skillIds: string[], prompt: string, attachments: ChatAttachment[]): Promise<SkillRunResult> {
  const unique = [...new Set(skillIds)].filter((id) => skillById.has(id));
  const contextBlocks: string[] = [];
  const executions: SkillExecution[] = [];
  await Promise.all(unique.map(async (id) => {
    const skill = skillById.get(id)!;
    if (skill.runtime !== 'browser') return;
    const startedAt = performance.now();
    try {
      if (id === 'calculator') {
        const expression = expressionCandidate(prompt);
        if (!expression) throw new Error('未识别到可安全计算的表达式');
        const { evaluate, format } = await import('mathjs/number');
        const value = evaluate(expression);
        const result = typeof value === 'object' ? format(value, { precision: 14 }) : String(value);
        contextBlocks.push(`[精确计算工具]\n表达式：${expression}\n结果：${result}`);
        executions.push(execution(skill, startedAt, 'completed', `${expression} = ${result}`));
      } else if (id === 'json-repair') {
        const candidate = jsonCandidate(prompt, attachments);
        if (!candidate) throw new Error('未找到 JSON 内容');
        const { jsonrepair } = await import('jsonrepair');
        const repaired = jsonrepair(candidate);
        JSON.parse(repaired);
        contextBlocks.push(`[JSON 修复工具]\n${repaired.slice(0, 24_000)}`);
        executions.push(execution(skill, startedAt, 'completed', `已修复并验证 ${repaired.length} 字符`));
      } else if (id === 'data-analysis') {
        const csv = attachments.find((item) => item.text && /(?:csv|comma-separated-values)/iu.test(`${item.name} ${item.mimeType}`));
        if (!csv?.text) throw new Error('未附带可读取的 CSV');
        const Papa = (await import('papaparse')).default;
        const parsed = Papa.parse<Record<string, string>>(csv.text, { header: true, skipEmptyLines: true, preview: 5_001 });
        const fields = parsed.meta.fields ?? [];
        const missing = Object.fromEntries(fields.map((field) => [field, parsed.data.reduce((total, row) => total + (String(row[field] ?? '').trim() ? 0 : 1), 0)]));
        const summary = { file: csv.name, rowsScanned: parsed.data.length, columns: fields, missing, truncated: parsed.data.length === 5_001 };
        contextBlocks.push(`[CSV 分析工具]\n${JSON.stringify(summary)}`);
        executions.push(execution(skill, startedAt, 'completed', `${parsed.data.length} 行，${fields.length} 列`));
      }
    } catch (error) {
      executions.push(execution(skill, startedAt, 'failed', error instanceof Error ? error.message : '执行失败'));
    }
  }));
  return { skillIds: unique, contextBlocks, executions };
}

export function buildSkillsPrompt(skillIds: string[], contextBlocks: string[] = []): string {
  const selected = skillIds.flatMap((id) => {
    const skill = skillById.get(id);
    return skill ? [`[${skill.name}] 来源：${skill.source}。${skill.prompt}`] : [];
  });
  return [...(selected.length ? [`本轮启用可执行 Skills：\n${selected.join('\n')}`] : []), ...contextBlocks].join('\n\n');
}

export function executePostflightSkills(skillIds: string[], markdown: string, sourceMessageId: string): { artifacts: GeneratedArtifact[]; executions: SkillExecution[] } {
  if (!skillIds.includes('file-generation') && !skillIds.includes('code-engineer')) return { artifacts: [], executions: [] };
  const skill = skillById.get('file-generation')!;
  const startedAt = performance.now();
  const artifacts = extractGeneratedArtifacts(markdown, sourceMessageId, true);
  return {
    artifacts,
    executions: [execution(skill, startedAt, artifacts.length ? 'completed' : 'failed', artifacts.length ? `已生成 ${artifacts.length} 个可下载文件` : '回复中没有可转换的代码块', 'postflight')],
  };
}

export function skillName(id: string): string {
  return skillById.get(id)?.name ?? id;
}
