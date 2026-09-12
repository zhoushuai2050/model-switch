import { spawn } from 'node:child_process';
import { existsSync, unlinkSync } from 'node:fs';
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
export const AGENT_VERSION_LIMIT = 10;
export function npmPackageSpec(npmPackage, version) {
    return version ? `${npmPackage}@${version}` : npmPackage;
}
export function agentInstallNpmArgs(npmPackage, version) {
    return ['i', '-g', npmPackageSpec(npmPackage, version), `--registry=${AGENT_NPM_REGISTRY}`];
}
export function agentUninstallNpmArgs(npmPackage) {
    return ['uninstall', '-g', npmPackage, `--registry=${AGENT_NPM_REGISTRY}`];
}
export function isNpmVersion(value) {
    return /^v?\d+(?:\.\d+){0,2}(?:[-+][0-9A-Za-z.]+)?$/.test(String(value || '').trim());
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
export function limitAgentVersions(versions, opts = {}) {
    const limit = opts.limit ?? AGENT_VERSION_LIMIT;
    const seen = new Set();
    const out = [];
    const push = (value) => {
        const version = String(value || '').trim();
        if (!version || seen.has(version) || out.length >= limit)
            return;
        seen.add(version);
        out.push(version);
    };
    push(opts.latest);
    push(opts.current);
    for (const version of versions)
        push(version);
    return out;
}
export function isStableNpmVersion(value) {
    return /^\d+\.\d+\.\d+$/.test(String(value || '').trim());
}
export function selectNpmVersionList(versions, opts = {}) {
    const valid = [...new Set(versions.map((item) => String(item || '').trim()).filter(isNpmVersion))];
    const bySemver = (a, b) => compareVersions(b, a) || b.localeCompare(a);
    const stable = valid.filter(isStableNpmVersion).sort(bySemver);
    const rest = valid.filter((item) => !isStableNpmVersion(item)).sort(bySemver);
    return limitAgentVersions([...stable, ...rest], opts);
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
    return runAgentNpm(agentInstallNpmArgs(npmPackage, opts.version), opts);
}
export async function runAgentNpmUninstall(npmPackage, opts = {}) {
    return runAgentNpm(agentUninstallNpmArgs(npmPackage), opts);
}
async function runAgentNpm(args, opts = {}) {
    const npm = resolveNpm();
    const command = [npm, ...args].join(' ');
    if (process.env.MSW_NPM_STUB) {
        const ok = process.env.MSW_NPM_STUB !== 'fail';
        if (ok && args[0] === 'uninstall' && process.env.MSW_NPM_STUB_UNLINK) {
            try {
                unlinkSync(process.env.MSW_NPM_STUB_UNLINK);
            }
            catch { /* test helper */ }
        }
        return {
            command,
            args,
            npm,
            code: ok ? 0 : 1,
            stdout: ok ? `ok ${args.join(' ')}` : '',
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
export async function collectAgentVersions(agentId) {
    const info = await collectAgentInstallInfo(agentId);
    let versions = [];
    let latest = info.latest;
    let error;
    try {
        const pack = await fetchNpmVersions(info.npmPackage);
        versions = pack.versions;
        latest = pack.latest || latest;
    }
    catch (err) {
        error = err instanceof Error ? err.message : String(err);
    }
    versions = selectNpmVersionList(versions, { current: info.version, latest });
    return {
        id: info.id,
        name: info.name,
        npmPackage: info.npmPackage,
        current: info.version,
        latest,
        versions,
        error,
    };
}
export async function fetchNpmVersions(npmPackage, timeoutMs = 20000) {
    if (process.env.MSW_NPM_VERSIONS) {
        const versions = JSON.parse(process.env.MSW_NPM_VERSIONS);
        return {
            latest: process.env.MSW_NPM_LATEST || versions[0],
            versions: [...new Set(versions.filter(Boolean))],
        };
    }
    try {
        return await fetchNpmVersionsViaNpm(npmPackage, timeoutMs);
    }
    catch (npmError) {
        try {
            return await fetchNpmVersionsViaRegistry(npmPackage, timeoutMs);
        }
        catch {
            throw npmError;
        }
    }
}
async function fetchNpmVersionsViaNpm(npmPackage, timeoutMs) {
    const npm = resolveNpm();
    const result = await spawnNpm(npm, ['view', npmPackage, 'versions', 'dist-tags', '--json', `--registry=${AGENT_NPM_REGISTRY}`], false, timeoutMs);
    if (result.code !== 0) {
        throw new Error(clipInstallLog(result.stderr || result.stdout || `npm view exit ${result.code}`, 300));
    }
    return parseNpmViewVersions(result.stdout);
}
async function fetchNpmVersionsViaRegistry(npmPackage, timeoutMs) {
    const url = `${AGENT_NPM_REGISTRY.replace(/\/$/, '')}/${encodeNpmPackage(npmPackage)}`;
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), timeoutMs);
    try {
        const res = await fetch(url, {
            signal: ac.signal,
            headers: {
                accept: 'application/vnd.npm.install-v1+json, application/json',
                'user-agent': 'model-switch',
            },
        });
        if (!res.ok)
            throw new Error(`npm registry ${res.status}`);
        const data = (await res.json());
        const raw = Array.isArray(data.versions)
            ? data.versions.map(String)
            : Object.keys(data.versions || {});
        const latest = data['dist-tags']?.latest && isNpmVersion(data['dist-tags'].latest)
            ? data['dist-tags'].latest
            : undefined;
        return { latest, versions: raw };
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
function parseNpmViewVersions(stdout) {
    const trimmed = stdout.trim();
    if (!trimmed)
        return { versions: [] };
    let data;
    try {
        data = JSON.parse(trimmed);
    }
    catch {
        throw new Error('npm view returned invalid JSON');
    }
    if (Array.isArray(data))
        return { versions: data.map(String) };
    if (typeof data === 'string')
        return { versions: [data] };
    if (!data || typeof data !== 'object')
        return { versions: [] };
    const rec = data;
    const raw = rec.versions;
    const versions = Array.isArray(raw)
        ? raw.map(String)
        : typeof raw === 'string'
            ? [raw]
            : [];
    const tags = rec['dist-tags'];
    const latest = tags && typeof tags === 'object'
        ? String(tags.latest || '')
        : '';
    return {
        latest: latest && isNpmVersion(latest) ? latest : undefined,
        versions,
    };
}
export async function* installAgentSteps(agentId, version) {
    const info = await collectAgentInstallInfo(agentId);
    const requested = String(version || '').trim();
    if (requested && !isNpmVersion(requested)) {
        const detail = `无效版本 ${requested}`;
        yield { id: 'start', title: `安装 ${info.name}`, status: 'fail', detail };
        yield { id: 'summary', title: '安装失败', status: 'fail', detail };
        return;
    }
    const spec = npmPackageSpec(info.npmPackage, requested || undefined);
    const title = requested
        ? `安装 ${info.name} ${requested}`
        : (info.installed ? `更新 ${info.name}` : `安装 ${info.name}`);
    yield { id: 'start', title, status: 'ok', detail: spec };
    const npmTitle = `npm i -g ${spec}`;
    yield { id: 'npm', title: npmTitle, status: 'running' };
    const result = await runAgentNpmInstall(info.npmPackage, { version: requested || undefined });
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
    const installedVersion = detected.bin ? await readInstalledVersion(detected.bin) : undefined;
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
        detail: [detected.bin, installedVersion].filter(Boolean).join(' · '),
    };
    yield {
        id: 'summary',
        title: installedVersion
            ? `${info.name} ${info.installed ? '已更新到' : '已安装'} ${installedVersion}`
            : `${info.name} ${info.installed ? '已更新' : '已安装'}`,
        status: 'ok',
        detail: detected.bin,
    };
}
export async function* uninstallAgentSteps(agentId) {
    const info = await collectAgentInstallInfo(agentId);
    const title = `卸载 ${info.name}`;
    if (!info.installed) {
        const detail = `${info.name} 未安装`;
        yield { id: 'start', title, status: 'fail', detail };
        yield { id: 'summary', title: '卸载失败', status: 'fail', detail };
        return;
    }
    yield { id: 'start', title, status: 'ok', detail: info.npmPackage };
    const npmTitle = `npm uninstall -g ${info.npmPackage}`;
    yield { id: 'npm', title: npmTitle, status: 'running' };
    const result = await runAgentNpmUninstall(info.npmPackage);
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
    const detected = getAdapter(info.id).detect();
    if (detected.installed) {
        const detail = `npm 已卸载，但 PATH 里还能找到 ${detected.bin || '可执行文件'}。可能不是通过 npm 全局安装的。`;
        yield { id: 'detect', title: `检测 ${info.name}`, status: 'warn', detail };
        yield { id: 'summary', title: `${info.name} 可能仍可用`, status: 'warn', detail };
        return;
    }
    yield { id: 'detect', title: `检测 ${info.name}`, status: 'ok', detail: '未找到可执行文件' };
    yield { id: 'summary', title: `${info.name} 已卸载`, status: 'ok' };
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
function spawnNpm(npm, args, inherit, timeoutMs = INSTALL_TIMEOUT_MS) {
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
            finish(1, `npm timed out (${Math.round(timeoutMs / 1000)}s)`);
        }, timeoutMs);
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
