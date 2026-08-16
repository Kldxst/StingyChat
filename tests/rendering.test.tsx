import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { MarkdownContent, normalizeMathDelimiters } from '../src/components/ChatView';

describe('rich message rendering', () => {
  it('renders GFM, LaTeX and highlighted code blocks', () => {
    const html = renderToStaticMarkup(
      <MarkdownContent>{`| A | B |
| - | - |
| 1 | 2 |

$$E = mc^2$$

\`\`\`ts
const answer: number = 42;
\`\`\``}</MarkdownContent>,
    );

    expect(html).toContain('<table>');
    expect(html).toContain('class="katex-display"');
    expect(html).toContain('aria-label="复制公式"');
    expect(html).toContain('class="hljs language-ts"');
    expect(html).toContain('aria-label="复制代码"');
  });

  it('supports parenthesized LaTeX delimiters without rewriting code', () => {
    const source = String.raw`Inline \(a+b\), display \[c=d\], and \`\(literal\)\``;
    const normalized = normalizeMathDelimiters(source);
    expect(normalized).toContain('$a+b$');
    expect(normalized).toContain('$$\nc=d\n$$');
    expect(normalized).toContain(String.raw`\`\(literal\)\``);
  });
});
