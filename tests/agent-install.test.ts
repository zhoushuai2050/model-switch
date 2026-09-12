import assert from 'node:assert/strict';
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, test } from 'node:test';
import { resetDbCache } from '../src/core/db.ts';
import { Engine } from '../src/core/engine.ts';
import {
  AGENT_NPM_PACKAGES,
  AGENT_VERSION_LIMIT,
  agentInstallAction,
  agentInstallNpmArgs,
  agentUninstallNpmArgs,
  compareVersions,
  isNpmVersion,
  limitAgentVersions,
  parseAgentVersion,
  selectNpmVersionList,
} from '../src/core/agent-install.ts';

const fakeAgent = join(dirname(fileURLToPath(import.meta.url)), 'fake-agent.cjs');
let originalPath = '';
let root = '';

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'msw-install-'));
  originalPath = process.env.PATH || '';
  process.env.HOME = root;
  process.env.MSW_HOME = join(root, '.model-switch');
  process.env.CODEX_HOME = join(root, '.codex');
  process.env.CLAUDE_CONFIG_DIR = join(root, '.claude');
  process.env.GEMINI_CONFIG_DIR = join(root, '.gemini');
  process.env.GROK_HOME = join(root, '.grok');
  process.env.XDG_CONFIG_HOME = join(root, '.config');
  process.env.MSW_NPM_LATEST = '2.0.0';
  process.env.MSW_AGENT_VERSION = '1.0.0';
  delete process.env.MSW_NPM_STUB;
  mkdirSync(join(root, '.codex'), { recursive: true });
  mkdirSync(join(root, '.claude'), { recursive: true });
  mkdirSync(join(root, '.grok'), { recursive: true });
  const binDir = join(root, 'bin');
  mkdirSync(binDir, { recursive: true });
  for (const name of ['claude', 'codex', 'gemini', 'opencode', 'grok']) {
    const dest = join(binDir, name);
    copyFileSync(fakeAgent, dest);
    chmodSync(dest, 0o755);
  }
  process.env.PATH = `${binDir}${delimiter}${originalPath}`;
  resetDbCache();
});

afterEach(() => {
  process.env.PATH = originalPath;
  delete process.env.MSW_NPM_LATEST;
  delete process.env.MSW_NPM_VERSIONS;
  delete process.env.MSW_AGENT_VERSION;
  delete process.env.MSW_NPM_STUB;
  delete process.env.MSW_NPM_STUB_UNLINK;
  resetDbCache();
});

test('parseAgentVersion reads common CLI banners', () => {
  assert.equal(parseAgentVersion('2.1.268 (Claude Code)'), '2.1.268');
  assert.equal(parseAgentVersion('codex-cli 0.154.0'), '0.154.0');
  assert.equal(parseAgentVersion('grok 1.0.25'), '1.0.25');
  assert.equal(parseAgentVersion('v1.18.30'), '1.18.30');
  assert.equal(parseAgentVersion('gemini 0.59'), '0.59');
});

test('compareVersions orders semver cores', () => {
  assert.equal(compareVersions('1.0.0', '2.0.0'), -1);
  assert.equal(compareVersions('2.0.0', '2.0.0'), 0);
  assert.equal(compareVersions('2.1.0', '2.0.9'), 1);
});

test('limitAgentVersions keeps latest and current within 10 entries', () => {
  const versions = Array.from({ length: 20 }, (_, i) => `1.${20 - i}.0`);
  const limited = limitAgentVersions(versions, { latest: '1.20.0', current: '1.0.0' });
  assert.equal(limited.length, AGENT_VERSION_LIMIT);
  assert.equal(limited[0], '1.20.0');
  assert.equal(limited[1], '1.0.0');
  assert.ok(!limited.includes('1.11.0'));
});

test('selectNpmVersionList prefers stable releases over nightlies', () => {
  const versions = selectNpmVersionList(
    ['0.61.0-nightly.1', '0.59.0', '0.58.1', '0.60.0-preview.0', '0.58.0', '0.57.2'],
    { latest: '0.59.0' },
  );
  assert.deepEqual(versions.slice(0, 4), ['0.59.0', '0.58.1', '0.58.0', '0.57.2']);
  assert.ok(versions.indexOf('0.61.0-nightly.1') > versions.indexOf('0.57.2'));
});

test('agentInstallAction chooses install, update, or none', () => {
  assert.deepEqual(agentInstallAction({ installed: false, latest: '2.0.0' }), {
    outdated: false,
    action: 'install',
  });
  assert.deepEqual(agentInstallAction({ installed: true, version: '1.0.0', latest: '2.0.0' }), {
    outdated: true,
    action: 'update',
  });
  assert.deepEqual(agentInstallAction({ installed: true, version: '2.0.0', latest: '2.0.0' }), {
    outdated: false,
    action: 'none',
  });
});

test('agent npm packages cover every agent and use the public registry', () => {
  assert.equal(AGENT_NPM_PACKAGES.claude, '@anthropic-ai/claude-code');
  assert.equal(AGENT_NPM_PACKAGES.codex, '@openai/codex');
  assert.equal(AGENT_NPM_PACKAGES['grok-build'], '@xai-official/grok');
  assert.equal(AGENT_NPM_PACKAGES.gemini, '@google/gemini-cli');
  assert.equal(AGENT_NPM_PACKAGES.opencode, 'opencode-ai');
  assert.deepEqual(agentInstallNpmArgs('@xai-official/grok'), [
    'i',
    '-g',
    '@xai-official/grok',
    '--registry=https://registry.npmjs.org/',
  ]);
});

test('agentInstallInfo reports update when the installed CLI is older', async () => {
  const engine = new Engine();
  const info = await engine.agentInstallInfo('claude');
  assert.equal(info.installed, true);
  assert.equal(info.version, '1.0.0');
  assert.equal(info.latest, '2.0.0');
  assert.equal(info.action, 'update');
  assert.equal(info.npmPackage, '@anthropic-ai/claude-code');
});

test('agentInstallInfo reports install when the binary is missing', async () => {
  process.env.PATH = join(root, 'empty-bin');
  mkdirSync(process.env.PATH, { recursive: true });
  const engine = new Engine();
  const info = await engine.agentInstallInfo('grok-build');
  assert.equal(info.installed, false);
  assert.equal(info.action, 'install');
  assert.equal(info.npmPackage, '@xai-official/grok');
});

test('agentInstallInfo reports none when the installed version matches latest', async () => {
  process.env.MSW_AGENT_VERSION = '2.0.0';
  const engine = new Engine();
  const info = await engine.agentInstallInfo('codex');
  assert.equal(info.version, '2.0.0');
  assert.equal(info.latest, '2.0.0');
  assert.equal(info.action, 'none');
  assert.equal(info.outdated, false);
});

test('listAgentInstallInfo marks outdated CLIs as update', async () => {
  const engine = new Engine();
  const list = await engine.listAgentInstallInfo();
  assert.deepEqual(list.map((item) => item.id), ['claude', 'codex', 'grok-build', 'gemini', 'opencode']);
  assert.ok(list.every((item) => item.installed && item.action === 'update'));
});

test('installAgent streams npm success without a real npm install', async () => {
  process.env.MSW_NPM_STUB = 'ok';
  const engine = new Engine();
  const steps = [];
  for await (const step of engine.installAgent('gemini')) steps.push(step);
  assert.equal(steps.at(-1)?.id, 'summary');
  assert.equal(steps.at(-1)?.status, 'ok');
  assert.ok(steps.some((step) => step.id === 'npm' && step.status === 'ok'));
  const lastById = new Map(steps.map((step) => [step.id, step]));
  assert.equal(lastById.get('start')?.status, 'ok');
  assert.ok([...lastById.values()].every((step) => step.status !== 'running'));
});

test('installAgent reports npm failure from the stub', async () => {
  process.env.MSW_NPM_STUB = 'fail';
  const engine = new Engine();
  const steps = [];
  for await (const step of engine.installAgent('opencode')) steps.push(step);
  assert.equal(steps.at(-1)?.status, 'fail');
  assert.ok(String(steps.at(-1)?.detail || '').includes('stub install failed'));
});

test('agentInstallNpmArgs pins a specific package version', () => {
  assert.deepEqual(agentInstallNpmArgs('@xai-official/grok', '1.0.30'), [
    'i',
    '-g',
    '@xai-official/grok@1.0.30',
    '--registry=https://registry.npmjs.org/',
  ]);
  assert.deepEqual(agentUninstallNpmArgs('@google/gemini-cli'), [
    'uninstall',
    '-g',
    '@google/gemini-cli',
    '--registry=https://registry.npmjs.org/',
  ]);
});

test('isNpmVersion accepts semver-like ids and rejects tags or paths', () => {
  assert.equal(isNpmVersion('1.0.30'), true);
  assert.equal(isNpmVersion('v1.0.30'), true);
  assert.equal(isNpmVersion('1.0.30-beta.1'), true);
  assert.equal(isNpmVersion('0.59'), true);
  assert.equal(isNpmVersion('latest'), false);
  assert.equal(isNpmVersion('@1.0.30'), false);
  assert.equal(isNpmVersion('1.0.0/../x'), false);
  assert.equal(isNpmVersion(''), false);
});

test('listAgentVersions uses the stubbed npm version list', async () => {
  process.env.MSW_NPM_VERSIONS = JSON.stringify(['1.0.30', '1.0.25', '1.0.0']);
  const engine = new Engine();
  const pack = await engine.listAgentVersions('grok-build');
  assert.equal(pack.id, 'grok-build');
  assert.equal(pack.npmPackage, '@xai-official/grok');
  assert.equal(pack.current, '1.0.0');
  assert.equal(pack.latest, '2.0.0');
  assert.ok(pack.versions.includes('1.0.30'));
  assert.ok(pack.versions.includes('2.0.0'));
});

test('listAgentVersions returns at most 10 recent versions', async () => {
  process.env.MSW_NPM_VERSIONS = JSON.stringify([
    '2.0.0', '1.9.0', '1.8.0', '1.7.0', '1.6.0', '1.5.0',
    '1.4.0', '1.3.0', '1.2.0', '1.1.0', '1.0.0', '0.9.0',
  ]);
  const engine = new Engine();
  const pack = await engine.listAgentVersions('claude');
  assert.equal(pack.versions.length, AGENT_VERSION_LIMIT);
  assert.equal(pack.versions[0], '2.0.0');
  assert.ok(pack.versions.includes('1.0.0'));
  assert.ok(!pack.versions.includes('0.9.0'));
});

test('installAgent pins npm i -g package@version', async () => {
  process.env.MSW_NPM_STUB = 'ok';
  const engine = new Engine();
  const steps = [];
  for await (const step of engine.installAgent('grok-build', '1.0.30')) steps.push(step);
  assert.ok(steps.some((step) => step.id === 'npm' && String(step.title).includes('@xai-official/grok@1.0.30')));
  assert.equal(steps.at(-1)?.id, 'summary');
  assert.equal(steps.at(-1)?.status, 'ok');
});

test('installAgent rejects unsafe version strings', async () => {
  process.env.MSW_NPM_STUB = 'ok';
  const engine = new Engine();
  const steps = [];
  for await (const step of engine.installAgent('codex', '../evil')) steps.push(step);
  assert.equal(steps.at(-1)?.status, 'fail');
  assert.ok(String(steps.at(-1)?.detail || '').includes('无效版本'));
  assert.ok(!steps.some((step) => step.id === 'npm'));
});

test('uninstallAgent warns when PATH still has the binary', async () => {
  process.env.MSW_NPM_STUB = 'ok';
  const engine = new Engine();
  const steps = [];
  for await (const step of engine.uninstallAgent('codex')) steps.push(step);
  assert.equal(steps.at(-1)?.status, 'warn');
  assert.match(String(steps.at(-1)?.detail || ''), /PATH/);
});

test('uninstallAgent succeeds after the stub removes the binary', async () => {
  process.env.MSW_NPM_STUB = 'ok';
  process.env.MSW_NPM_STUB_UNLINK = join(root, 'bin', 'gemini');
  const engine = new Engine();
  const steps = [];
  for await (const step of engine.uninstallAgent('gemini')) steps.push(step);
  const lastById = new Map(steps.map((step) => [step.id, step]));
  assert.equal(lastById.get('start')?.status, 'ok');
  assert.equal(lastById.get('npm')?.status, 'ok');
  assert.equal(steps.at(-1)?.status, 'ok');
  assert.ok(String(steps.at(-1)?.title || '').includes('已卸载'));
  assert.ok([...lastById.values()].every((step) => step.status !== 'running'));
});
