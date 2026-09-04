import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync, } from 'node:fs';
import { dirname, join } from 'node:path';
import { backupDir } from "./paths.js";
export function ensureDir(dir) {
    mkdirSync(dir, { recursive: true });
}
export function readText(file) {
    if (!existsSync(file))
        return null;
    return readFileSync(file, 'utf8');
}
export function readJson(file) {
    const text = readText(file);
    if (!text || !text.trim())
        return null;
    try {
        return JSON.parse(text);
    }
    catch {
        return null;
    }
}
export function atomicWrite(file, content, mode = 0o600) {
    ensureDir(dirname(file));
    const tmp = `${file}.msw-tmp-${process.pid}-${Date.now()}`;
    writeFileSync(tmp, content, { encoding: 'utf8', mode });
    renameSync(tmp, file);
}
export function writeJson(file, value, mode = 0o600) {
    atomicWrite(file, `${JSON.stringify(value, null, 2)}\n`, mode);
}
export function backupFiles(agentId, files) {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const dir = join(backupDir(), agentId, stamp);
    ensureDir(dir);
    for (const file of files) {
        if (!existsSync(file))
            continue;
        const name = file.replace(/[\\/]/g, '__');
        copyFileSync(file, join(dir, name));
    }
    pruneBackups(join(backupDir(), agentId), 10);
    return dir;
}
function pruneBackups(dir, keep) {
    if (!existsSync(dir))
        return;
    const entries = readdirSync(dir, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .sort()
        .reverse();
    for (const name of entries.slice(keep)) {
        rmSync(join(dir, name), { recursive: true, force: true });
    }
}
export function listBackups(agentId) {
    const root = backupDir();
    if (!existsSync(root))
        return [];
    const agents = agentId ? [agentId] : readdirSync(root);
    const out = [];
    for (const agent of agents) {
        const dir = join(root, agent);
        if (!existsSync(dir))
            continue;
        for (const id of readdirSync(dir).sort().reverse()) {
            out.push({ agentId: agent, id, path: join(dir, id) });
        }
    }
    return out;
}
