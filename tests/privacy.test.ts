import { describe, expect, it } from 'vitest';
import { auditMessages } from '../worker/index';

describe('chat audit privacy', () => {
  it('stores attachment metadata without image or document bodies', () => {
    const audited = auditMessages([{
      role: 'user',
      content: '分析附件',
      attachments: [{
        id: 'attachment', name: 'private.png', mimeType: 'image/png', size: 128, kind: 'image',
        dataUrl: 'data:image/png;base64,PRIVATE', text: 'PRIVATE OCR',
      }],
    }]);
    const serialized = JSON.stringify(audited);
    expect(serialized).toContain('private.png');
    expect(serialized).not.toContain('PRIVATE');
    expect(serialized).not.toContain('dataUrl');
    expect(serialized).not.toContain('text');
  });
});
