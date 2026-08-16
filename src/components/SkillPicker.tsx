import { Check, Search, WandSparkles, X } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useMemo, useState } from 'react';
import { CHAT_SKILLS } from '../lib/skills';
import { IconButton } from './ui';

export function SkillPicker({
  open,
  selected,
  onChange,
  onClose,
}: {
  open: boolean;
  selected: string[];
  onChange: (ids: string[]) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState('');
  const visible = useMemo(() => {
    const keyword = query.trim().toLocaleLowerCase();
    return keyword
      ? CHAT_SKILLS.filter((skill) => `${skill.name} ${skill.description} ${skill.category}`.toLocaleLowerCase().includes(keyword))
      : CHAT_SKILLS;
  }, [query]);

  return (
    <AnimatePresence>
      {open ? (
        <motion.section
          className="skill-picker"
          role="dialog"
          aria-modal="false"
          aria-label="选择 Skills"
          initial={{ opacity: 0, y: 12, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 8, scale: 0.99 }}
          transition={{ duration: 0.18 }}
        >
          <header>
            <span><WandSparkles size={17} /><strong>Skills</strong><small>输入 $$ 可随时打开</small></span>
            <IconButton label="关闭 Skills" onClick={onClose}><X size={17} /></IconButton>
          </header>
          <label className="skill-search">
            <Search size={15} />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索能力" autoFocus />
          </label>
          <div className="skill-grid">
            {visible.map((skill) => {
              const active = selected.includes(skill.id);
              return (
                <button
                  type="button"
                  className={active ? 'active' : ''}
                  key={skill.id}
                  onClick={() => onChange(active ? selected.filter((id) => id !== skill.id) : [...selected, skill.id])}
                >
                  <span><b>{skill.name}</b><small>{skill.category}</small></span>
                  <p>{skill.description}</p>
                  <i>{active ? <Check size={14} /> : null}</i>
                </button>
              );
            })}
          </div>
          <footer><span>已启用 {selected.length} 项</span><button type="button" className="primary-button" onClick={onClose}>完成</button></footer>
        </motion.section>
      ) : null}
    </AnimatePresence>
  );
}
