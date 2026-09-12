import { spawn } from 'node:child_process';
import { existsSync, unlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { findBinary } from '../adapters/which.ts';
import { getAdapter } from '../adapters/index.ts';
import { runCommand } from './probe.ts';
import { AGENT_IDS, type AgentId, type PingStep } from './types.ts';

export const AGENT_NPM_REGISTRY = 'https://registry.npmjs.org/';

export const AGENT_NPM_PACKAGES: Record<AgentId, string> = {
  claude: '@anthropic-ai/claude-code',
  codex: '@openai/codex',
  'grok-build': '@xai-official/grok',
  gemini: '@google/gemini-cli',
  opencode: 'opencode-ai',
};

export const INSTALL_TIMEOUT_MS = 8 * 60 * 1000;

export type AgentInstallAction = 'install' | 'update' | 'none';

export interface AgentInstallInfo {
  id: AgentId;
  name: string;
  installed: boolean;
  bin?: string;
  version?: string;
  latest?: string;
  outdated: boolean;
  npmPackage: string;
  action: AgentInstallAction;
  latestError?: string;
}

export function npmPackageSpec(npmPackage: string, version?: string): string {
  return version ? `${npmPackage}@${version}` : npmPackage;
}

export function agentInstallNpmArgs(npmPackage: string, version?: string): string[] {
  return ['i', '-g', npmPackageSpec(npmPackage, version), `--registry=${AGENT_NPM_REGISTRY}`];
}

export function agentUninstallNpmArgs(npmPackage: string): string[] {
  return ['uninstall', '-g', npmPackage, `--registry=${AGENT_NPM_REGISTRY}`];
}

export function isNpmVersion(value: string): boolean {
  return /^v?\d+(?:\.\d+){0,2}(?:[-+][0-9A-Za-z.]+)?$/.test(String(value || '').trim());
}

export function parseAgentVersion(text: string): string | undefined {
  const src = String(text || '');
  const three = src.match(/\bv?(\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.]+)?)\b/i);
  if (three?.[1]) return three[1];
  const two = src.match(/\bv?(\d+\.\d+)(?![0-9.])/i);
  return two?.[1];
}

export function compareVersions(a: string, b: string): number {
  const left = versionParts(a);
  const right = versionParts(b);
  const n = Math.max(left.length, right.length);
  for (let i = 0; i < n; i += 1) {
    const da = left[i] || 0;
    const db = right[i] || 0;
    if (da > db) return 1;
    if (da < db) return -1;
  }
  return 0;
}

export function agentInstallAction(input: {
  installed: boolean;
  version?: string;
  latest?: string;
}): { outdated: boolean; action: AgentInstallAction } {
  if (!input.installed) return { outdated: false, action: 'install' };
  const outdated = Boolean(input.latest) && (
    !input.version || compareVersions(input.version, input.latest as string) < 0
  );
  return { outdated, action: outdated ? 'update' : 'none' };
}

export interface AgentVersionInfo {
  id: AgentId;
  name: string;
  npmPackage: string;
  current?: string;
  latest?: string;
  versions: string[];
  error?: string;
}

export async function fetchNpmLatest(npmPackage: string, timeoutMs = 8000): Promise<string> {
  if (process.env.MSW_NPM_LATEST) return process.env.MSW_NPM_LATEST;
  const url = `${AGENT_NPM_REGISTRY.replace(/\/$/, '')}/${encodeNpmPackage(npmPackage)}/latest`;
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: ac.signal,
      headers: { accept: 'application/json' },
    });
    if (!res.ok) throw new Error(`npm registry ${res.status}`);
    const data = (await res.json()) as { version?: string };
    if (!data.version) throw new Error('npm registry missing version');
    return data.version;
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error('npm registry timeout');
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

const VERSION_ARGS = [['--version'], ['-v'], ['version']];

export async function readInstalledVersion(bin: string): Promise<string | undefined> {
  for (const args of VERSION_ARGS) {
    const run = await runCommand(
      { command: bin, args, env: envMap() },
      { cwd: process.cwd(), timeoutMs: 8000 },
    );
    const version = parseAgentVersion(`${run.stdout}\n${run.stderr}`);
    if (version) return version;
  }
  return undefined;
}

export function listAgentInstallInfo(): Promise<AgentInstallInfo[]> {
  return Promise.all(AGENT_IDS.map((id) => collectAgentInstallInfo(id)));
}

export async function collectAgentInstallInfo(agentId: AgentId): Promise<AgentInstallInfo> {
  const adapter = getAdapter(agentId);
  const detected = adapter.detect();
  const npmPackage = AGENT_NPM_PACKAGES[agentId];
  const version = detected.bin ? await readInstalledVersion(detected.bin) : undefined;
  let latest: string | undefined;
  let latestError: string | undefined;
  try {
    latest = await fetchNpmLatest(npmPackage);
  } catch (error) {
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

export async function runAgentNpmInstall(
  npmPackage: string,
  opts: { inherit?: boolean; version?: string } = {},
): Promise<{
  command: string;
  args: string[];
  npm: string;
  code: number;
  stdout: string;
  stderr: string;
  ms: number;
}> {
  return runAgentNpm(agentInstallNpmArgs(npmPackage, opts.version), opts);
}

export async function runAgentNpmUninstall(npmPackage: string, opts: { inherit?: boolean } = {}): Promise<{
  command: string;
  args: string[];
  npm: string;
  code: number;
  stdout: string;
  stderr: string;
  ms: number;
}> {
  return runAgentNpm(agentUninstallNpmArgs(npmPackage), opts);
}

async function runAgentNpm(args: string[], opts: { inherit?: boolean } = {}): Promise<{
  command: string;
  args: string[];
  npm: string;
  code: number;
  stdout: string;
  stderr: string;
  ms: number;
}> {
  const npm = resolveNpm();
  const command = [npm, ...args].join(' ');
  if (process.env.MSW_NPM_STUB) {
    const ok = process.env.MSW_NPM_STUB !== 'fail';
    if (ok && args[0] === 'uninstall' && process.env.MSW_NPM_STUB_UNLINK) {
      try { unlinkSync(process.env.MSW_NPM_STUB_UNLINK); } catch { /* test helper */ }
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

export async function collectAgentVersions(agentId: AgentId): Promise<AgentVersionInfo> {
  const info = await collectAgentInstallInfo(agentId);
  let versions: string[] = [];
  let latest = info.latest;
  let error: string | undefined;
  try {
    const pack = await fetchNpmVersions(info.npmPackage);
    versions = pack.versions;
    latest = pack.latest || latest;
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
  }
  if (latest && !versions.includes(latest)) versions.unshift(latest);
  if (info.version && !versions.includes(info.version)) versions.unshift(info.version);
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

export async function fetchNpmVersions(npmPackage: string, timeoutMs = 10000): Promise<{ latest?: string; versions: string[] }> {
  if (process.env.MSW_NPM_VERSIONS) {
    const versions = JSON.parse(process.env.MSW_NPM_VERSIONS) as string[];
    return {
      latest: process.env.MSW_NPM_LATEST || versions[0],
      versions: [...new Set(versions.filter(Boolean))],
    };
  }
  if (process.env.MSW_NPM_LATEST) {
    return { latest: process.env.MSW_NPM_LATEST, versions: [process.env.MSW_NPM_LATEST] };
  }
  const url = `${AGENT_NPM_REGISTRY.replace(/\/$/, '')}/${encodeNpmPackage(npmPackage)}`;
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: ac.signal,
      headers: { accept: 'application/json' },
    });
    if (!res.ok) throw new Error(`npm registry ${res.status}`);
    const data = (await res.json()) as {
      versions?: Record<string, unknown>;
      'dist-tags'?: { latest?: string };
    };
    const versions = Object.keys(data.versions || {})
      .filter((item) => isNpmVersion(item))
      .sort((a, b) => compareVersions(b, a) || b.localeCompare(a));
    const latest = data['dist-tags']?.latest && isNpmVersion(data['dist-tags'].latest)
      ? data['dist-tags'].latest
      : versions[0];
    const rest = versions.filter((item) => item !== latest);
    return { latest, versions: [latest, ...rest].filter((item): item is string => Boolean(item)).slice(0, 50) };
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error('npm registry timeout');
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export async function* installAgentSteps(agentId: AgentId, version?: string): AsyncGenerator<PingStep> {
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

export async function* uninstallAgentSteps(agentId: AgentId): AsyncGenerator<PingStep> {
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


function resolveNpm(): string {
  const sibling = join(dirname(process.execPath), process.platform === 'win32' ? 'npm.cmd' : 'npm');
  if (existsSync(sibling)) return sibling;
  return findBinary(['npm']) || 'npm';
}

function encodeNpmPackage(npmPackage: string): string {
  return npmPackage.replace('/', '%2F');
}

function versionParts(value: string): number[] {
  const core = String(value || '').replace(/^v/i, '').split(/[-+]/)[0] || '';
  return core.split('.').map((part) => {
    const n = Number.parseInt(part, 10);
    return Number.isFinite(n) ? n : 0;
  });
}

function envMap(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) env[key] = value;
  }
  return env;
}

function clipInstallLog(text: string, length = 4000): string {
  const trimmed = text.trim();
  if (trimmed.length <= length) return trimmed;
  return `…${trimmed.slice(-length)}`;
}

function spawnNpm(npm: string, args: string[], inherit: boolean): Promise<{
  code: number;
  stdout: string;
  stderr: string;
}> {
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
    const finish = (code: number, extraErr = '') => {
      if (settled) return;
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
      if (inherit) reject(error);
      else finish(1, error instanceof Error ? error.message : String(error));
    });
    child.on('exit', (code) => finish(code ?? 1));
  });
}
