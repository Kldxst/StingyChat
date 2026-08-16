import type { ChatAttachment } from '../types';
import { estimateTokens } from './tokens';

export function estimateAttachmentTokens(attachments: ChatAttachment[] | undefined): number {
  return (attachments ?? []).reduce((total, attachment) => total + (
    attachment.kind === 'image'
      ? Math.max(85, Math.ceil(attachment.size / 750))
      : estimateTokens(attachment.text ?? '')
  ), 0);
}
