import imageCompression from 'browser-image-compression';
import type { ChatAttachment, KnowledgeCitation } from '../types';
import { chunkText, extractFileText, tokenizeForSearch } from './knowledge';

const MAX_FILE_BYTES = 20 * 1024 * 1024;
const MAX_ATTACHMENTS = 8;

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('无法读取图片'));
    reader.readAsDataURL(blob);
  });
}

export async function prepareChatAttachments(files: File[]): Promise<ChatAttachment[]> {
  if (files.length > MAX_ATTACHMENTS) throw new Error(`每次最多添加 ${MAX_ATTACHMENTS} 个附件`);
  return Promise.all(files.map(async (file) => {
    if (file.size > MAX_FILE_BYTES) throw new Error(`${file.name} 超过 20 MB`);
    const id = crypto.randomUUID();
    if (file.type.startsWith('image/')) {
      const compressed = await imageCompression(file, {
        maxSizeMB: 4,
        maxWidthOrHeight: 2048,
        useWebWorker: true,
        fileType: file.type === 'image/png' ? 'image/png' : 'image/jpeg',
      });
      return {
        id,
        name: file.name,
        mimeType: compressed.type || file.type,
        size: compressed.size,
        kind: 'image' as const,
        dataUrl: await blobToDataUrl(compressed),
      };
    }
    const text = await extractFileText(file);
    return { id, name: file.name, mimeType: file.type || 'text/plain', size: file.size, kind: 'document' as const, text };
  }));
}

export function retrieveAttachmentText(attachments: ChatAttachment[], query: string, topK: number): KnowledgeCitation[] {
  const queryTerms = new Set(tokenizeForSearch(query));
  return attachments
    .filter((attachment) => attachment.kind === 'document' && attachment.text)
    .flatMap((attachment) => chunkText(attachment.text!, attachment.id, attachment.name))
    .map((chunk) => {
      const overlap = chunk.terms.reduce((total, term) => total + (queryTerms.has(term) ? 1 : 0), 0);
      return { chunk, score: overlap / Math.max(1, Math.sqrt(chunk.terms.length)) };
    })
    .filter(({ score }) => score > 0)
    .toSorted((left, right) => right.score - left.score)
    .slice(0, topK)
    .map(({ chunk, score }) => ({
      chunkId: chunk.id,
      documentName: chunk.documentName,
      excerpt: chunk.text.slice(0, 800),
      score: Number(score.toFixed(3)),
      sourceType: 'attachment' as const,
    }));
}
