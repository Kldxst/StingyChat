import { Index } from 'flexsearch';
import type { KnowledgeChunk, KnowledgeCitation, KnowledgeDocument } from '../types';
import { db } from './db';

const CHUNK_SIZE = 900;
const OVERLAP = 120;

export function tokenizeForSearch(text: string): string[] {
  const normalized = text.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  const words = normalized.split(/\s+/u).filter(Boolean);
  const cjk = [...normalized.replace(/[^\u3400-\u9fff]/gu, '')];
  const bigrams = cjk.slice(0, -1).map((char, index) => `${char}${cjk[index + 1]}`);
  return [...new Set([...words, ...cjk, ...bigrams])];
}

export function chunkText(text: string, documentId: string, documentName: string): KnowledgeChunk[] {
  const clean = text.replace(/\r\n/gu, '\n').replace(/\n{3,}/gu, '\n\n').trim();
  if (!clean) return [];
  const chunks: KnowledgeChunk[] = [];
  let offset = 0;
  let index = 0;
  while (offset < clean.length) {
    let end = Math.min(clean.length, offset + CHUNK_SIZE);
    if (end < clean.length) {
      const paragraph = clean.lastIndexOf('\n', end);
      if (paragraph > offset + CHUNK_SIZE * 0.55) end = paragraph;
    }
    const value = clean.slice(offset, end).trim();
    if (value) {
      chunks.push({
        id: `${documentId}:${index}`,
        documentId,
        documentName,
        index,
        text: value,
        terms: tokenizeForSearch(value),
      });
      index += 1;
    }
    if (end >= clean.length) break;
    offset = Math.max(offset + 1, end - OVERLAP);
  }
  return chunks;
}

async function extractPdf(file: File): Promise<string> {
  const pdfjs = await import('pdfjs-dist');
  pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    'pdfjs-dist/build/pdf.worker.min.mjs',
    import.meta.url,
  ).toString();
  const pdf = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
  const pages: string[] = [];
  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const content = await page.getTextContent();
    pages.push(content.items.map((item) => ('str' in item ? item.str : '')).join(' '));
  }
  return pages.join('\n\n');
}

async function extractDocx(file: File): Promise<string> {
  const mammoth = await import('mammoth/mammoth.browser');
  const result = await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() });
  return result.value;
}

export async function extractFileText(file: File): Promise<string> {
  const extension = file.name.split('.').pop()?.toLocaleLowerCase();
  if (extension === 'pdf') return extractPdf(file);
  if (extension === 'docx') return extractDocx(file);
  if (extension === 'txt' || extension === 'md' || file.type.startsWith('text/')) return file.text();
  throw new Error('仅支持 TXT、Markdown、PDF 和 DOCX 文件');
}

export async function importKnowledgeFile(file: File): Promise<KnowledgeDocument> {
  const id = crypto.randomUUID();
  const text = await extractFileText(file);
  const chunks = chunkText(text, id, file.name);
  if (!chunks.length) throw new Error('文件中没有可索引的文本');
  const document: KnowledgeDocument = {
    id,
    name: file.name,
    type: file.type || file.name.split('.').pop() || 'text',
    size: file.size,
    createdAt: Date.now(),
    chunkCount: chunks.length,
  };
  await db.transaction('rw', db.documents, db.chunks, async () => {
    await db.documents.put(document);
    await db.chunks.bulkPut(chunks);
  });
  return document;
}

function bm25Score(queryTerms: string[], chunk: KnowledgeChunk, averageLength: number): number {
  const termFrequency = new Map<string, number>();
  for (const term of chunk.terms) termFrequency.set(term, (termFrequency.get(term) ?? 0) + 1);
  const k1 = 1.2;
  const b = 0.75;
  return queryTerms.reduce((score, term) => {
    const frequency = termFrequency.get(term) ?? 0;
    if (!frequency) return score;
    const denominator = frequency + k1 * (1 - b + b * (chunk.terms.length / averageLength));
    return score + (frequency * (k1 + 1)) / denominator;
  }, 0);
}

export async function retrieveKnowledge(query: string, topK: number): Promise<KnowledgeCitation[]> {
  const chunks = await db.chunks.toArray();
  if (!chunks.length || !query.trim()) return [];
  const index = new Index({ tokenize: 'forward', cache: false });
  for (const chunk of chunks) index.add(chunk.id, chunk.terms.join(' '));
  const queryTerms = tokenizeForSearch(query);
  const hits = (await index.search(queryTerms.join(' '), { limit: Math.max(topK * 4, 12) })) as string[];
  const hitSet = new Set(hits.map(String));
  const candidates = chunks.filter((chunk) => hitSet.has(chunk.id));
  const pool = candidates.length ? candidates : chunks;
  const averageLength = pool.reduce((sum, chunk) => sum + chunk.terms.length, 0) / pool.length || 1;
  return pool
    .map((chunk) => ({ chunk, score: bm25Score(queryTerms, chunk, averageLength) }))
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK)
    .map(({ chunk, score }) => ({
      chunkId: chunk.id,
      documentName: chunk.documentName,
      excerpt: chunk.text.slice(0, 280),
      score: Number(score.toFixed(3)),
    }));
}

export async function knowledgeCorpusTextLength(): Promise<number> {
  const chunks = await db.chunks.toArray();
  const byDocument = new Map<string, number>();
  for (const chunk of chunks) {
    const overlap = chunk.index > 0 ? OVERLAP : 0;
    byDocument.set(chunk.documentId, (byDocument.get(chunk.documentId) ?? 0) + Math.max(0, chunk.text.length - overlap));
  }
  return [...byDocument.values()].reduce((total, length) => total + length, 0);
}

export async function removeKnowledgeDocument(documentId: string): Promise<void> {
  await db.transaction('rw', db.documents, db.chunks, async () => {
    await db.documents.delete(documentId);
    await db.chunks.where('documentId').equals(documentId).delete();
  });
}
