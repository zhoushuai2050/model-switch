import { AsyncLocalStorage } from 'node:async_hooks';
import { homedir } from 'node:os';
import { join } from 'node:path';

const envStore = new AsyncLocalStorage<Record<string, string>>();

export function withPathEnv<T>(env: Record<string, string>, fn: () => T): T {
  const parent = envStore.getStore() || {};
  return envStore.run({ ...parent, ...env }, fn);
}

function envValue(key: string): string | undefined {
  const overlay = envStore.getStore()?.[key];
  if (overlay !== undefined) return overlay || undefined;
  return process.env[key] || undefined;
}

export function homeDir(): string {
  return envValue('HOME') || envValue('USERPROFILE') || homedir();
}

export function mswHome(): string {
  return envValue('MSW_HOME') || envValue('MODEL_SWITCH_HOME') || join(homeDir(), '.model-switch');
}

export function dbPath(): string {
  return join(mswHome(), 'model-switch.db');
}

export function backupDir(): string {
  return join(mswHome(), 'backups');
}

export function claudeHome(): string {
  return envValue('CLAUDE_CONFIG_DIR') || join(homeDir(), '.claude');
}

export function claudeJsonPath(): string {
  const dir = envValue('CLAUDE_CONFIG_DIR');
  if (dir) return join(dir, '.claude.json');
  return join(homeDir(), '.claude.json');
}

export function codexHome(): string {
  return envValue('CODEX_HOME') || join(homeDir(), '.codex');
}

export function geminiHome(): string {
  return envValue('GEMINI_CONFIG_DIR') || join(homeDir(), '.gemini');
}

export function opencodeHome(): string {
  const xdg = envValue('XDG_CONFIG_HOME') || join(homeDir(), '.config');
  return envValue('OPENCODE_CONFIG_DIR') || join(xdg, 'opencode');
}

export function opencodeDataHome(): string {
  const xdg = envValue('XDG_DATA_HOME') || join(homeDir(), '.local', 'share');
  return envValue('OPENCODE_DATA_DIR') || join(xdg, 'opencode');
}

export function grokHome(): string {
  return envValue('GROK_HOME') || join(homeDir(), '.grok');
}

