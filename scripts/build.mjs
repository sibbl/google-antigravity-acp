import { spawnSync } from 'node:child_process';
import { rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

await rm(new URL('../dist', import.meta.url), { recursive: true, force: true });

const compiler = fileURLToPath(new URL('../node_modules/typescript/bin/tsc', import.meta.url));
const result = spawnSync(process.execPath, [compiler], { stdio: 'inherit' });
if (result.error) throw result.error;
if (result.status !== 0) process.exitCode = result.status ?? 1;
