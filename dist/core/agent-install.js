import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { findBinary } from "../adapters/which.js";
import { getAdapter } from "../adapters/index.js";
import { runCommand } from "./probe.js";
import { AGENT_IDS } from "./types.js";
export const AGENT_NPM_REGISTRY = 'https://registry.npmjs.org/';
export const AGENT_NPM_PACKAGES = {
    claude: '@anthropic-ai/claude-code',
    codex: '@openai/codex',
    'grok-build': '@xai-official/grok',
    gemini: '@google/gemini-cli',
    opencode: 'opencode-ai',
};
export const INSTALL_TIMEOUT_MS = 8 * 60 * 1000;
export function agentInstallNpmArgs(npmPackage) {
    return ['i', '-g', npmPackage, `--registry=${AGENT_NPM_REGISTRY}`];
}
export function parseAgentVersion(text) {
    const src = String(text || '');
    const three = src.match(/\bv?(\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.]+)?)\b/i);
    if (three?.[1])
        return three[1];
    const two = src.match(/\bv?(\d+\.\d+)(?![0-9.])/i);
    return two?.[1];
}
export function compareVersions(a, b) {
    const left = versionParts(a);
    const right = versionParts(b);
    const n = Math.max(left.length, right.length);
    for (let i = 0; i < n; i += 1) {
        const da = left[i] || 0;
        const db = right[i] || 0;
        if (da > db)
            return 1;
        if (da < db)
            return -1;
    }
    return 0;
}
export function agentInstallAction(input) {
    if (!input.installed)
        return { outdated: false, action: 'install' };
    const outdated = Boolean(input.latest) && (!input.version || compareVersions(input.version, input.latest) < 0);
    return { outdated, action: outdated ? 'update' : 'none' };
}
export async function fetchNpmLatest(npmPackage, timeoutMs = 8000) {
    if (process.env.MSW_NPM_LATEST)
        return process.env.MSW_NPM_LATEST;
    const url = `${AGENT_NPM_REGISTRY.replace(/\/$/, '')}/${encodeNpmPackage(npmPackage)}/latest`;
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), timeoutMs);
    try {
        const res = await fetch(url, {
            signal: ac.signal,
            headers: { accept: 'application/json' },
        });
        if (!res.ok)
            throw new Error(`npm registry ${res.status}`);
        const data = (await res.json());
        if (!data.version)
            throw new Error('npm registry missing version');
        return data.version;
    }
    catch (error) {
        if (error instanceof Error && error.name === 'AbortError') {
            throw new Error('npm registry timeout');
        }
        throw error;
    }
    finally {
        clearTimeout(timer);
    }
}
const VERSION_ARGS = [['--version'], ['-v'], ['version']];
export async function readInstalledVersion(bin) {
    for (const args of VERSION_ARGS) {
        const run = await runCommand({ command: bin, args, env: envMap() }, { cwd: process.cwd(), timeoutMs: 8000 });
        const version = parseAgentVersion(`${run.stdout}\n${run.stderr}`);
        if (version)
            return version;
    }
    return undefined;
}
export function listAgentInstallInfo() {
    return Promise.all(AGENT_IDS.map((id) => collectAgentInstallInfo(id)));
}
export async function collectAgentInstallInfo(agentId) {
    const adapter = getAdapter(agentId);
    const detected = adapter.detect();
    const npmPackage = AGENT_NPM_PACKAGES[agentId];
    const version = detected.bin ? await readInstalledVersion(detected.bin) : undefined;
    let latest;
    let latestError;
    try {
        latest = await fetchNpmLatest(npmPackage);
    }
    catch (error) {
        latestError = error instanceof Error ? error.message : String(error);
    }
    const { outdated, action } = agentInstallAction({
        installed: detected.installed,
        version,
        latest,
    });
    return {
        id: agentId,
        name: adapter.displayName,
        installed: detected.installed,
        bin: detected.bin,
        version,
        latest,
        outdated,
        npmPackage,
        action,
        latestError,
    };
}
export async function runAgentNpmInstall(npmPackage, opts = {}) {
    const npm = resolveNpm();
    const args = agentInstallNpmArgs(npmPackage);
    const command = [npm, ...args].join(' ');
    if (process.env.MSW_NPM_STUB) {
        const ok = process.env.MSW_NPM_STUB !== 'fail';
        return {
            command,
            args,
            npm,
            code: ok ? 0 : 1,
            stdout: ok ? `added 1 package ${npmPackage}` : '',
            stderr: ok ? '' : 'stub install failed',
            ms: 1,
        };
    }
    const started = Date.now();
    const result = await spawnNpm(npm, args, Boolean(opts.inherit));
    return {
        command,
        args,
        npm,
        ...result,
        ms: Date.now() - started,
    };
}
export async function* installAgentSteps(agentId) {
    const info = await collectAgentInstallInfo(agentId);
    const updating = info.installed;
    const title = updating ? `更新 ${info.name}` : `安装 ${info.name}`;
    yield { id: 'start', title, status: 'running', detail: info.npmPackage };
    const npmTitle = `npm i -g ${info.npmPackage}`;
    yield { id: 'npm', title: npmTitle, status: 'running' };
    const result = await runAgentNpmInstall(info.npmPackage);
    if (result.code !== 0) {
        const detail = clipInstallLog(result.stderr || result.stdout || `exit ${result.code}`);
        yield { id: 'npm', title: npmTitle, status: 'fail', detail, ms: result.ms };
        yield { id: 'summary', title: `${title}失败`, status: 'fail', detail };
        return;
    }
    yield {
        id: 'npm',
        title: npmTitle,
        status: 'ok',
        detail: clipInstallLog(result.stdout || result.stderr || 'ok'),
        ms: result.ms,
    };
    const adapter = getAdapter(info.id);
    const detected = adapter.detect();
    const version = detected.bin ? await readInstalledVersion(detected.bin) : undefined;
    if (!detected.installed) {
        const detail = '安装命令已完成，但 PATH 里还没有找到可执行文件。新开一个终端后再试，或执行 hash -r。';
        yield { id: 'detect', title: `检测 ${info.name}`, status: 'fail', detail };
        yield { id: 'summary', title: `${title}失败`, status: 'fail', detail };
        return;
    }
    yield {
        id: 'detect',
        title: `检测 ${info.name}`,
        status: 'ok',
        detail: [detected.bin, version].filter(Boolean).join(' · '),
    };
    yield {
        id: 'summary',
        title: version ? `${info.name} ${updating ? '已更新到' : '已安装'} ${version}` : `${info.name} ${updating ? '已更新' : '已安装'}`,
        status: 'ok',
        detail: detected.bin,
    };
}
function resolveNpm() {
    const sibling = join(dirname(process.execPath), process.platform === 'win32' ? 'npm.cmd' : 'npm');
    if (existsSync(sibling))
        return sibling;
    return findBinary(['npm']) || 'npm';
}
function encodeNpmPackage(npmPackage) {
    return npmPackage.replace('/', '%2F');
}
function versionParts(value) {
    const core = String(value || '').replace(/^v/i, '').split(/[-+]/)[0] || '';
    return core.split('.').map((part) => {
        const n = Number.parseInt(part, 10);
        return Number.isFinite(n) ? n : 0;
    });
}
function envMap() {
    const env = {};
    for (const [key, value] of Object.entries(process.env)) {
        if (value !== undefined)
            env[key] = value;
    }
    return env;
}
function clipInstallLog(text, length = 4000) {
    const trimmed = text.trim();
    if (trimmed.length <= length)
        return trimmed;
    return `…${trimmed.slice(-length)}`;
}
function spawnNpm(npm, args, inherit) {
    return new Promise((resolve, reject) => {
        let stdout = '';
        let stderr = '';
        let settled = false;
        const child = spawn(npm, args, {
            env: envMap(),
            stdio: inherit ? 'inherit' : ['ignore', 'pipe', 'pipe'],
            shell: process.platform === 'win32',
        });
        const timer = setTimeout(() => {
            child.kill('SIGTERM');
            finish(1, `npm install timed out (${Math.round(INSTALL_TIMEOUT_MS / 1000)}s)`);
        }, INSTALL_TIMEOUT_MS);
        const finish = (code, extraErr = '') => {
            if (settled)
                return;
            settled = true;
            clearTimeout(timer);
            resolve({
                code,
                stdout,
                stderr: extraErr ? `${stderr}\n${extraErr}`.trim() : stderr,
            });
        };
        if (!inherit) {
            child.stdout?.on('data', (chunk) => {
                stdout += String(chunk);
            });
            child.stderr?.on('data', (chunk) => {
                stderr += String(chunk);
            });
        }
        child.on('error', (error) => {
            if (inherit)
                reject(error);
            else
                finish(1, error instanceof Error ? error.message : String(error));
        });
        child.on('exit', (code) => finish(code ?? 1));
    });
}
