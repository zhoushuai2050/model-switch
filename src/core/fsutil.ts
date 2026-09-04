import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { backupDir } from './paths.ts';

export function ensureDir(dir: string): void {
  mkdirSync(dir, { recursive: true });
}

export function readText(file: string): string | null {
  if (!existsSync(file)) return null;
  return readFileSync(file, 'utf8');
}

export function readJson<T = unknown>(file: string): T | null {
  const text = readText(file);
  if (!text || !text.trim()) return null;
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

export function atomicWrite(file: string, content: string, mode = 0o600): void {
  ensureDir(dirname(file));
  const tmp = `${file}.msw-tmp-${process.pid}-${Date.now()}`;
  writeFileSync(tmp, content, { encoding: 'utf8', mode });
  renameSync(tmp, file);
}

export function writeJson(file: string, value: unknown, mode = 0o600): void {
  atomicWrite(file, `${JSON.stringify(value, null, 2)}\n`, mode);
}

export function backupFiles(agentId: string, files: string[]): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const dir = join(backupDir(), agentId, stamp);
  ensureDir(dir);
  for (const file of files) {
    if (!existsSync(file)) continue;
    const name = file.replace(/[\\/]/g, '__');
    copyFileSync(file, join(dir, name));
  }
  pruneBackups(join(backupDir(), agentId), 10);
  return dir;
}

function pruneBackups(dir: string, keep: number): void {
  if (!existsSync(dir)) return;
  const entries = readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
    .reverse();
  for (const name of entries.slice(keep)) {
    rmSync(join(dir, name), { recursive: true, force: true });
  }
}

export function listBackups(agentId?: string): Array<{ agentId: string; id: string; path: string }> {
  const root = backupDir();
  if (!existsSync(root)) return [];
  const agents = agentId ? [agentId] : readdirSync(root);
  const out: Array<{ agentId: string; id: string; path: string }> = [];
  for (const agent of agents) {
    const dir = join(root, agent);
    if (!existsSync(dir)) continue;
    for (const id of readdirSync(dir).sort().reverse()) {
      out.push({ agentId: agent, id, path: join(dir, id) });
    }
  }
  return out;
}
