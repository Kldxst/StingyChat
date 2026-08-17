import git from 'isomorphic-git';
import LightningFS from '@isomorphic-git/lightning-fs';
import type { ProjectFile } from '../types';

const roots = new Map<string, { fs: InstanceType<typeof LightningFS>; dir: string }>();

async function ensureDirectory(fs: InstanceType<typeof LightningFS>, path: string) {
  const parts = path.split('/').filter(Boolean);
  let current = '';
  for (const part of parts) {
    current += `/${part}`;
    await fs.promises.mkdir(current).catch(() => undefined);
  }
}

export async function syncBrowserGit(projectId: string, files: ProjectFile[]) {
  let root = roots.get(projectId);
  if (!root) {
    const fs = new LightningFS(`stingy-git-${projectId}`);
    root = { fs, dir: '/workspace' };
    roots.set(projectId, root);
    await fs.promises.mkdir(root.dir).catch(() => undefined);
    await git.init({ fs, dir: root.dir, defaultBranch: 'main' });
  }
  for (const file of files) {
    const target = `${root.dir}/${file.path}`;
    await ensureDirectory(root.fs, target.split('/').slice(0, -1).join('/'));
    await root.fs.promises.writeFile(target, file.content, 'utf8');
  }
  return git.statusMatrix({ fs: root.fs, dir: root.dir });
}
