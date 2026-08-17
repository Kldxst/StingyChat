import { directoryOpen } from 'browser-fs-access';
import { db } from './db';
import type { ProjectCheckpoint, ProjectEvent, ProjectFile, ProjectPermissionMode, ProjectWorkspace } from '../types';

const IGNORED_DIRECTORIES = new Set(['.git', 'node_modules', 'dist', 'build', '.next', '.cache']);
const MAX_FILES = 2_000;
const MAX_TEXT_BYTES = 2 * 1024 * 1024;

interface DirectoryHandleWithAccess extends FileSystemDirectoryHandle {
  entries(): AsyncIterableIterator<[string, FileSystemFileHandle | DirectoryHandleWithAccess]>;
  requestPermission(options?: { mode?: 'read' | 'readwrite' }): Promise<PermissionState>;
  getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<DirectoryHandleWithAccess>;
}

function languageFor(path: string): string {
  const extension = path.split('.').pop()?.toLowerCase() ?? '';
  return ({ ts: 'typescript', tsx: 'typescript', js: 'javascript', jsx: 'javascript', json: 'json', css: 'css', html: 'html', md: 'markdown', py: 'python', rs: 'rust', go: 'go', java: 'java', yml: 'yaml', yaml: 'yaml', toml: 'ini', sql: 'sql', sh: 'shell', ps1: 'powershell' } as Record<string, string>)[extension] ?? 'plaintext';
}

function isTextFile(file: File): boolean {
  return file.type.startsWith('text/') || /\.(?:[cm]?[jt]sx?|json|md|css|scss|html?|xml|ya?ml|toml|ini|env|py|rs|go|java|kt|sql|sh|ps1|bat|c|h|cpp|hpp|txt)$/iu.test(file.name);
}

async function readDirectory(handle: DirectoryHandleWithAccess, prefix = '', output: ProjectFile[] = []): Promise<ProjectFile[]> {
  for await (const [name, entry] of handle.entries()) {
    if (output.length >= MAX_FILES) break;
    const path = prefix ? `${prefix}/${name}` : name;
    if (entry.kind === 'directory') {
      if (!IGNORED_DIRECTORIES.has(name)) await readDirectory(entry as DirectoryHandleWithAccess, path, output);
      continue;
    }
    const file = await entry.getFile();
    if (!isTextFile(file) || file.size > MAX_TEXT_BYTES) continue;
    output.push({ id: `${handle.name}:${path}`, projectId: '', path, content: await file.text(), language: languageFor(path), size: file.size, updatedAt: file.lastModified || Date.now() });
  }
  return output;
}

export async function openProjectDirectory(namespace: string, mode: ProjectPermissionMode = 'read'): Promise<ProjectWorkspace> {
  let rootHandle: DirectoryHandleWithAccess | undefined;
  let files: ProjectFile[] = [];
  let name = '导入的项目';
  let fallback = false;
  const showDirectoryPicker = (window as unknown as { showDirectoryPicker?: (options?: { mode?: 'read' | 'readwrite' }) => Promise<DirectoryHandleWithAccess> }).showDirectoryPicker;
  if (showDirectoryPicker) {
    rootHandle = await showDirectoryPicker({ mode: mode === 'read' ? 'read' : 'readwrite' });
    name = rootHandle.name;
    files = await readDirectory(rootHandle);
  } else {
    fallback = true;
    const selected = await directoryOpen({ recursive: true });
    const list = Array.isArray(selected) ? selected : [selected];
    files = (await Promise.all(list.slice(0, MAX_FILES).filter((file) => isTextFile(file) && file.size <= MAX_TEXT_BYTES).map(async (file) => ({
      id: '', projectId: '', path: file.webkitRelativePath || file.name, content: await file.text(), language: languageFor(file.name), size: file.size, updatedAt: file.lastModified || Date.now(),
    }))));
    name = files[0]?.path.split('/')[0] || name;
  }
  const now = Date.now();
  const project: ProjectWorkspace = { id: crypto.randomUUID(), namespace, name, permissionMode: fallback && mode === 'full' ? 'workspace' : mode, rootHandle: rootHandle as FileSystemDirectoryHandle | undefined, fallback, activeFilePath: files[0]?.path, createdAt: now, updatedAt: now };
  files = files.map((file) => ({ ...file, id: `${project.id}:${file.path}`, projectId: project.id }));
  await db.transaction('rw', db.projects, db.projectFiles, async () => { await db.projects.put(project); await db.projectFiles.bulkPut(files); });
  return project;
}

export async function listProjectFiles(projectId: string): Promise<ProjectFile[]> {
  return db.projectFiles.where('projectId').equals(projectId).sortBy('path');
}

async function writableFile(root: DirectoryHandleWithAccess, path: string): Promise<FileSystemFileHandle> {
  const parts = path.split('/').filter(Boolean);
  const fileName = parts.pop();
  if (!fileName || parts.some((part) => part === '..')) throw new Error('文件路径无效');
  let directory: DirectoryHandleWithAccess = root;
  for (const part of parts) directory = await directory.getDirectoryHandle(part, { create: true });
  return directory.getFileHandle(fileName, { create: true });
}

export async function saveProjectFile(project: ProjectWorkspace, file: ProjectFile, content: string): Promise<ProjectFile> {
  if (project.permissionMode === 'read') throw new Error('当前工程处于只读模式');
  if (project.rootHandle) {
    const root = project.rootHandle as DirectoryHandleWithAccess;
    const permission = await root.requestPermission({ mode: 'readwrite' });
    if (permission !== 'granted') throw new Error('未取得目录写入权限');
    const handle = await writableFile(root, file.path);
    const writer = await handle.createWritable();
    await writer.write(content);
    await writer.close();
  }
  const updated = { ...file, content, size: new Blob([content]).size, updatedAt: Date.now() };
  await db.projectFiles.put(updated);
  await db.projects.update(project.id, { updatedAt: updated.updatedAt, activeFilePath: file.path });
  return updated;
}

export async function createCheckpoint(projectId: string, label: string): Promise<ProjectCheckpoint> {
  const files = await listProjectFiles(projectId);
  const checkpoint: ProjectCheckpoint = { id: crypto.randomUUID(), projectId, label, files: files.map(({ path, content, language }) => ({ path, content, language })), createdAt: Date.now() };
  await db.projectCheckpoints.put(checkpoint);
  const old = await db.projectCheckpoints.where('projectId').equals(projectId).reverse().sortBy('createdAt');
  if (old.length > 20) await db.projectCheckpoints.bulkDelete(old.slice(20).map((item) => item.id));
  return checkpoint;
}

export async function restoreCheckpoint(project: ProjectWorkspace, checkpoint: ProjectCheckpoint): Promise<void> {
  if (project.permissionMode === 'read') throw new Error('只读模式不能恢复检查点');
  const current = await listProjectFiles(project.id);
  const byPath = new Map(current.map((file) => [file.path, file]));
  for (const snapshot of checkpoint.files) {
    const file = byPath.get(snapshot.path) ?? { id: `${project.id}:${snapshot.path}`, projectId: project.id, path: snapshot.path, content: '', language: snapshot.language, size: 0, updatedAt: Date.now() };
    await saveProjectFile(project, file, snapshot.content);
  }
}

export async function appendProjectEvent(projectId: string, type: ProjectEvent['type'], content: string, toolCall?: ProjectEvent['toolCall']): Promise<ProjectEvent> {
  const event: ProjectEvent = { id: crypto.randomUUID(), projectId, type, content, toolCall, createdAt: Date.now() };
  await db.projectEvents.put(event);
  return event;
}
