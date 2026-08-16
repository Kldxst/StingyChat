import type { GeneratedArtifact } from '../types';

const MIME_TYPES: Record<string, string> = {
  css: 'text/css', csv: 'text/csv', html: 'text/html', js: 'text/javascript', json: 'application/json',
  jsx: 'text/jsx', md: 'text/markdown', mjs: 'text/javascript', svg: 'image/svg+xml', ts: 'text/typescript',
  tsx: 'text/tsx', txt: 'text/plain', xml: 'application/xml', yaml: 'application/yaml', yml: 'application/yaml',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
};

function safeName(value: string): string {
  return value.trim().replace(/^['"]|['"]$/gu, '').replace(/[\\/:*?"<>|]/gu, '_').slice(0, 180);
}

function extension(name: string): string {
  return name.split('.').pop()?.toLowerCase() ?? 'txt';
}

export function extractGeneratedArtifacts(markdown: string, sourceMessageId: string): GeneratedArtifact[] {
  const artifacts: GeneratedArtifact[] = [];
  const fence = /```([^\n`]*)\n([\s\S]*?)```/gu;
  for (const match of markdown.matchAll(fence)) {
    const info = match[1].trim();
    const content = match[2].replace(/\n$/u, '');
    const filename = info.match(/(?:^|\s)filename=(?:"([^"]+)"|'([^']+)'|([^\s]+))/iu);
    if (!filename) continue;
    const name = safeName(filename[1] ?? filename[2] ?? filename[3] ?? '');
    if (!name || !name.includes('.')) continue;
    const language = info.split(/\s+/u)[0] || extension(name);
    artifacts.push({
      id: `${sourceMessageId}:${artifacts.length}:${name}`,
      sourceMessageId,
      name,
      language,
      mimeType: MIME_TYPES[extension(name)] ?? 'application/octet-stream',
      content,
    });
  }
  return artifacts;
}

export async function downloadArtifact(artifact: GeneratedArtifact): Promise<void> {
  const { saveAs } = await import('file-saver');
  if (extension(artifact.name) === 'docx') {
    const { Document, Packer, Paragraph } = await import('docx');
    const document = new Document({
      sections: [{ children: artifact.content.split(/\r?\n/u).map((line) => new Paragraph({ text: line })) }],
    });
    saveAs(await Packer.toBlob(document), artifact.name);
    return;
  }
  saveAs(new Blob([artifact.content], { type: `${artifact.mimeType};charset=utf-8` }), artifact.name);
}
