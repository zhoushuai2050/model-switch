import { homedir } from 'node:os';
import { join } from 'node:path';
export function homeDir() {
    return process.env.HOME || process.env.USERPROFILE || homedir();
}
export function mswHome() {
    return process.env.MSW_HOME || process.env.MODEL_SWITCH_HOME || join(homeDir(), '.model-switch');
}
export function dbPath() {
    return join(mswHome(), 'model-switch.db');
}
export function backupDir() {
    return join(mswHome(), 'backups');
}
export function claudeHome() {
    return process.env.CLAUDE_CONFIG_DIR || join(homeDir(), '.claude');
}
export function claudeJsonPath() {
    if (process.env.CLAUDE_CONFIG_DIR) {
        return join(process.env.CLAUDE_CONFIG_DIR, '.claude.json');
    }
    return join(homeDir(), '.claude.json');
}
export function codexHome() {
    return process.env.CODEX_HOME || join(homeDir(), '.codex');
}
export function geminiHome() {
    return process.env.GEMINI_CONFIG_DIR || join(homeDir(), '.gemini');
}
export function opencodeHome() {
    const xdg = process.env.XDG_CONFIG_HOME || join(homeDir(), '.config');
    return process.env.OPENCODE_CONFIG_DIR || join(xdg, 'opencode');
}
export function opencodeDataHome() {
    const xdg = process.env.XDG_DATA_HOME || join(homeDir(), '.local', 'share');
    return process.env.OPENCODE_DATA_DIR || join(xdg, 'opencode');
}
