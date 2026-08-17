import { copyFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = resolve(root, 'packages/bridge/src/index.mjs');
const target = resolve(root, 'public/stingy-bridge.mjs');

await mkdir(dirname(target), { recursive: true });
await copyFile(source, target);
console.log('Synced standalone bridge asset: public/stingy-bridge.mjs');
