interface ChatSkill {
  id: string;
  name: string;
  description: string;
  category: '效率' | '开发' | '内容' | '分析';
  prompt: string;
  fileOutput?: boolean;
}

export const CHAT_SKILLS: ChatSkill[] = [
  {
    id: 'file-generation', name: '文件生成', category: '效率', fileOutput: true,
    description: '生成可预览和下载的代码、Markdown、JSON、CSV、HTML、SVG 或 DOCX 文件',
    prompt: '需要交付文件时，每个文件必须使用独立 Markdown 代码块，代码块首行元信息严格写成：```语言 filename="文件名.扩展名"。不要把多个文件合并到一个代码块。DOCX 文件的代码块内容使用纯文本或 Markdown。',
  },
  {
    id: 'concise-expert', name: '极简专家', category: '效率',
    description: '直接给结论，删除寒暄、复述与重复总结',
    prompt: '先给可执行结论，只保留支撑结论所必需的信息。禁止寒暄、复述问题和重复总结。',
  },
  {
    id: 'code-engineer', name: '工程实现', category: '开发',
    description: '生成可运行实现，标注文件名并覆盖错误处理与测试',
    prompt: '以生产级工程师标准实现：遵循现有技术栈，覆盖失败路径、类型和测试。涉及多个文件时启用文件输出协议并逐文件交付。',
    fileOutput: true,
  },
  {
    id: 'code-review', name: '代码审查', category: '开发',
    description: '按严重程度查找缺陷、回归风险和缺失测试',
    prompt: '进行代码审查。 findings 优先，按严重程度排序；每项给出位置、触发条件、影响和最小修复建议。没有问题时明确说明剩余风险。',
  },
  {
    id: 'debugger', name: '故障诊断', category: '开发',
    description: '从现象建立可验证假设并定位根因',
    prompt: '使用证据驱动的故障诊断：区分现象与根因，给出最短复现、验证步骤、根因和修复，避免用无依据的重试或延迟掩盖问题。',
  },
  {
    id: 'security-review', name: '安全审计', category: '开发',
    description: '检查信任边界、密钥、注入、权限与数据暴露',
    prompt: '从攻击面、信任边界、输入验证、权限、密钥、日志和数据生命周期审查安全性。只报告可验证风险，给出严重性与修复优先级。',
  },
  {
    id: 'deep-research', name: '深度研究', category: '分析',
    description: '拆分问题、交叉验证来源并标注不确定性',
    prompt: '将研究问题拆成可验证子问题，优先一手来源，区分事实、推断与未知。联网可用时为关键时效性结论附来源和日期。',
  },
  {
    id: 'data-analysis', name: '数据分析', category: '分析',
    description: '检查数据质量、计算口径并给出可复现结论',
    prompt: '先检查数据结构、缺失值、异常值和统计口径，再分析。结论必须可复现，明确公式、假设、样本限制与不确定性。',
  },
  {
    id: 'structured-json', name: '结构化 JSON', category: '分析',
    description: '按稳定 Schema 输出可机器解析的 JSON',
    prompt: '只输出合法 JSON，不使用 Markdown 代码块，不添加解释。字段名稳定；无法确定的字段使用 null，不编造值。',
  },
  {
    id: 'document-writer', name: '文档撰写', category: '内容',
    description: '组织清晰、可扫描的专业文档',
    prompt: '撰写专业文档：先确定读者与目标，使用清晰层级、短段落和具体措辞，删除空泛宣传语，保留关键限制与行动项。',
  },
  {
    id: 'translator', name: '精准翻译', category: '内容',
    description: '保留术语、格式、语气和事实边界',
    prompt: '忠实翻译，保留专有名词、数值、代码、链接和原格式。术语前后一致，不擅自解释或扩写；歧义处用最小必要注释。',
  },
  {
    id: 'learning-coach', name: '学习教练', category: '内容',
    description: '用渐进示例与检查问题帮助掌握概念',
    prompt: '根据用户水平从最小可理解模型开始，使用一个具体例子逐步展开，并用简短检查问题验证理解。避免一次引入过多术语。',
  },
];

const skillById = new Map(CHAT_SKILLS.map((skill) => [skill.id, skill]));

export function buildSkillsPrompt(skillIds: string[]): string {
  const selected = skillIds.flatMap((id) => {
    const skill = skillById.get(id);
    return skill ? [`[${skill.name}] ${skill.prompt}`] : [];
  });
  return selected.length ? `本轮启用 Skills：\n${selected.join('\n')}` : '';
}

export function skillName(id: string): string {
  return skillById.get(id)?.name ?? id;
}
