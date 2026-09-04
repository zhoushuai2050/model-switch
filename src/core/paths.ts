import { homedir } from 'node:os';
import { join } from 'node:path';

export function homeDir(): string {
  return process.env.HOME || process.env.USERPROFILE || homedir();
}

export function mswHome(): string {
  return process.env.MSW_HOME || process.env.MODEL_SWITCH_HOME || join(homeDir(), '.model-switch');
}

export function dbPath(): string {
  return join(mswHome(), 'model-switch.db');
}

export function backupDir(): string {
  return join(mswHome(), 'backups');
}

export function claudeHome(): string {
  return process.env.CLAUDE_CONFIG_DIR || join(homeDir(), '.claude');
}

export function claudeJsonPath(): string {
  if (process.env.CLAUDE_CONFIG_DIR) {
    return join(process.env.CLAUDE_CONFIG_DIR, '.claude.json');
  }
  return join(homeDir(), '.claude.json');
}

export function codexHome(): string {
  return process.env.CODEX_HOME || join(homeDir(), '.codex');
}

export function geminiHome(): string {
  return process.env.GEMINI_CONFIG_DIR || join(homeDir(), '.gemini');
}

export function opencodeHome(): string {
  const xdg = process.env.XDG_CONFIG_HOME || join(homeDir(), '.config');
  return process.env.OPENCODE_CONFIG_DIR || join(xdg, 'opencode');
}
