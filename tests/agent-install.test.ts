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
  agentInstallAction,
  agentInstallNpmArgs,
  compareVersions,
  parseAgentVersion,
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
  delete process.env.MSW_AGENT_VERSION;
  delete process.env.MSW_NPM_STUB;
  resetDbCache();
});

test('parseAgentVersion reads common CLI banners', () => {
  assert.equal(parseAgentVersion('2.1.268 (Claude Code)'), '2.1.268');
  assert.equal(parseAgentVersion('codex-cli 0.154.0'), '0.154.0');
  assert.equal(parseAgentVersion('grok 1.0.25'), '1.0.25');
  assert.equal(parseAgentVersion('v1.18.30'), '1.18.30');
});

test('compareVersions orders semver cores', () => {
  assert.equal(compareVersions('1.0.0', '2.0.0'), -1);
  assert.equal(compareVersions('2.0.0', '2.0.0'), 0);
  assert.equal(compareVersions('2.1.0', '2.0.9'), 1);
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

test('installAgent streams npm success without a real npm install', async () => {
  process.env.MSW_NPM_STUB = 'ok';
  const engine = new Engine();
  const steps = [];
  for await (const step of engine.installAgent('gemini')) steps.push(step);
  assert.equal(steps.at(-1)?.id, 'summary');
  assert.equal(steps.at(-1)?.status, 'ok');
  assert.ok(steps.some((step) => step.id === 'npm' && step.status === 'ok'));
});

test('installAgent reports npm failure from the stub', async () => {
  process.env.MSW_NPM_STUB = 'fail';
  const engine = new Engine();
  const steps = [];
  for await (const step of engine.installAgent('opencode')) steps.push(step);
  assert.equal(steps.at(-1)?.status, 'fail');
  assert.ok(String(steps.at(-1)?.detail || '').includes('stub install failed'));
});
