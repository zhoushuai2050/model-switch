import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { afterEach, beforeEach, test } from 'node:test';
import { resetDbCache } from '../src/core/db.ts';
import { Engine } from '../src/core/engine.ts';

let root = '';

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'msw-'));
  process.env.HOME = root;
  process.env.MSW_HOME = join(root, '.model-switch');
  process.env.CODEX_HOME = join(root, '.codex');
  process.env.CLAUDE_CONFIG_DIR = join(root, '.claude');
  process.env.GEMINI_CONFIG_DIR = join(root, '.gemini');
  process.env.XDG_CONFIG_HOME = join(root, '.config');
  mkdirSync(join(root, '.codex'), { recursive: true });
  mkdirSync(join(root, '.claude'), { recursive: true });
  resetDbCache();
});

afterEach(() => {
  resetDbCache();
});

test('init imports live Codex config and use switches model', () => {
  writeFileSync(
    join(root, '.codex', 'config.toml'),
    `model = "grok-4.6"
model_provider = "crs"

[model_providers.crs]
base_url = "http://127.0.0.1:8000/v1"
name = "crs"
wire_api = "responses"

[projects."/tmp"]
trust_level = "trusted"
`,
  );
  writeFileSync(
    join(root, '.codex', 'auth.json'),
    JSON.stringify({ auth_mode: 'apikey', OPENAI_API_KEY: 'sk-live' }, null, 2),
  );

  const engine = new Engine();
  const imported = engine.init();
  assert.equal(imported.imported.length, 1);
  assert.equal(imported.imported[0].agentId, 'codex');

  engine.addProvider({
    preset: 'kimi',
    apiKey: 'sk-kimi',
    models: ['kimi-k2.5'],
  });
  engine.setAgent('codex');
  const result = engine.use('kimi');
  assert.ok(result.applied.includes('codex'));
  assert.equal(result.profileId, 'kimi');
  assert.equal(engine.status().state.currentProfile, 'kimi');

  const text = readFileSync(join(root, '.codex', 'config.toml'), 'utf8');
  assert.match(text, /model = "kimi-k2.5"/);
  assert.match(text, /\[projects\."\/tmp"\]/);
  const auth = JSON.parse(readFileSync(join(root, '.codex', 'auth.json'), 'utf8'));
  assert.equal(auth.OPENAI_API_KEY, 'sk-kimi');
});

test('new providers use random UUID IDs while names remain usable targets', () => {
  const engine = new Engine();
  const first = engine.addProvider({ name: 'relay', apiKey: 'sk-a', openaiUrl: 'https://a.example/v1', models: ['a'] });
  const second = engine.addProvider({ name: 'relay', apiKey: 'sk-b', openaiUrl: 'https://b.example/v1', models: ['b'] });
  assert.match(first.id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  assert.match(second.id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  assert.notEqual(first.id, second.id);
  assert.equal(engine.getProvider(first.id).provider.name, 'relay');
});

test('claude adapter writes anthropic env', () => {
  const engine = new Engine();
  const kimi = engine.addProvider({
    preset: 'kimi',
    apiKey: 'sk-kimi',
  });
  assert.match(kimi.id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  engine.use('claude:kimi');
  const settings = JSON.parse(readFileSync(join(root, '.claude', 'settings.json'), 'utf8'));
  assert.equal(settings.env.ANTHROPIC_AUTH_TOKEN, 'sk-kimi');
  assert.match(settings.env.ANTHROPIC_BASE_URL, /moonshot/);
});

test('session launch does not change global model', () => {
  writeFileSync(
    join(root, '.codex', 'config.toml'),
    `model = "grok-4.6"
model_provider = "crs"

[model_providers.crs]
base_url = "http://127.0.0.1:8000/v1"
name = "crs"
`,
  );
  const engine = new Engine();
  engine.init();
  engine.addProvider({ preset: 'deepseek', apiKey: 'sk-ds' });
  engine.setAgent('codex');
  const spec = engine.launch({ profile: 'deepseek' });
  assert.equal(spec.command.includes('codex') || spec.command === 'codex' || existsSync(spec.command) || spec.command.endsWith('codex'), true);
  assert.ok(spec.args.includes('model=deepseek-chat') || spec.args.some((a) => a.includes('deepseek')));
  const text = readFileSync(join(root, '.codex', 'config.toml'), 'utf8');
  assert.match(text, /model = "grok-4.6"/);
});

test('codex apply rewrites leftover wire_api chat', () => {
  writeFileSync(
    join(root, '.codex', 'config.toml'),
    `model = "old"
model_provider = "legacy"

[model_providers.legacy]
base_url = "https://old.example/v1"
wire_api = "chat"
`,
  );
  const engine = new Engine();
  engine.addProvider({
    name: 'relay',
    apiKey: 'sk-x',
    openaiUrl: 'https://relay.example/v1',
    wireApi: 'responses',
    models: ['gpt-5.6-sol'],
  });
  engine.setAgent('codex');
  engine.use('relay');
  const text = readFileSync(join(root, '.codex', 'config.toml'), 'utf8');
  assert.equal((text.match(/wire_api = "chat"/g) || []).length, 0);
  assert.match(text, /wire_api = "responses"/);
  assert.match(text, /model = "gpt-5.6-sol"/);
});


test('codex apply stores key in auth.json and does not write env_key', () => {
  const engine = new Engine();
  engine.addProvider({
    name: 'relay',
    apiKey: 'sk-secret-key',
    openaiUrl: 'https://relay.example/v1',
    models: ['gpt-5.6-sol'],
  });
  engine.setAgent('codex');
  engine.use('relay');
  const text = readFileSync(join(root, '.codex', 'config.toml'), 'utf8');
  assert.doesNotMatch(text, /env_key/);
  assert.match(text, /requires_openai_auth = true/);
  const auth = JSON.parse(readFileSync(join(root, '.codex', 'auth.json'), 'utf8'));
  assert.equal(auth.OPENAI_API_KEY, 'sk-secret-key');
});


test('codex apply writes model_catalog_json for /model picker', () => {
  const engine = new Engine();
  engine.addProvider({
    name: 'relay',
    apiKey: 'sk-x',
    openaiUrl: 'https://relay.example/v1',
    models: ['gpt-5.6-sol', 'deepseek-v4-flash', 'glm-5.3'],
  });
  engine.setAgent('codex');
  engine.use('relay');
  const text = readFileSync(join(root, '.codex', 'config.toml'), 'utf8');
  assert.match(text, /model_catalog_json = "msw-model-catalog.json"/);
  const catalog = JSON.parse(readFileSync(join(root, '.codex', 'msw-model-catalog.json'), 'utf8'));
  const slugs = catalog.models.map((row: { slug: string }) => row.slug);
  assert.ok(slugs.includes('deepseek-v4-flash'));
  assert.ok(slugs.includes('glm-5.3'));
  assert.ok(slugs.includes('gpt-5.6-sol'));
});

test('updateProvider keeps key when blank and replaces models', () => {
  const engine = new Engine();
  const created = engine.addProvider({
    name: 'relay',
    apiKey: 'sk-old',
    openaiUrl: 'https://old.example/v1',
    models: ['gpt-old'],
  });
  const updated = engine.updateProvider(created.id, {
    name: 'relay-2',
    apiKey: '',
    openaiUrl: 'https://new.example/v1',
    models: ['gpt-5.6-sol', 'deepseek-v4-flash'],
  });
  assert.equal(updated.name, 'relay-2');
  assert.equal(updated.apiKey, 'sk-old');
  assert.equal(updated.protocols.openai?.baseUrl, 'https://new.example/v1');
  const models = engine.getProvider(created.id).models.map((item) => item.modelId);
  assert.deepEqual(models.sort(), ['deepseek-v4-flash', 'gpt-5.6-sol']);
});

test('ping sends a real test message and reports the reply', async () => {
  let requestBody: Record<string, unknown> | undefined;
  const server = createServer(async (req, res) => {
    if (req.method === 'POST' && req.url === '/v1/responses') {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(Buffer.from(chunk));
      requestBody = JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>;
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ output_text: '今天天气不错' }));
      return;
    }
    if (req.url === '/v1/models') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ data: [{ id: 'gpt-test' }] }));
      return;
    }
    res.writeHead(404);
    res.end('no');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('no port');
  try {
    const engine = new Engine();
    const created = engine.addProvider({
      name: 'local',
      apiKey: 'sk-x',
      openaiUrl: `http://127.0.0.1:${address.port}/v1`,
      models: ['gpt-test'],
    });
    const result = await engine.ping(created.id);
    assert.equal(result.ok, true);
    assert.equal(result.status, 200);
    assert.ok(result.steps.some((step) => step.id === 'openai-responses' && step.status === 'ok'));
    assert.ok(!result.steps.some((step) => step.id === 'openai-models'));
    assert.equal(requestBody?.model, 'gpt-test');
    assert.equal(requestBody?.input, '你好，今日天气');
    const responseStep = [...result.steps].reverse().find((step) => step.id === 'openai-responses');
    assert.match(responseStep?.detail || '', /今天天气不错/);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
});

test('ping succeeds from the real message request when models endpoint is unavailable', async () => {
  const server = createServer(async (req, res) => {
    if (req.method === 'POST' && req.url === '/v1/responses') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ output_text: '测试成功' }));
      return;
    }
    res.writeHead(404);
    res.end('not supported');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('no port');
  try {
    const engine = new Engine();
    const created = engine.addProvider({
      name: 'chat-only',
      apiKey: 'sk-x',
      openaiUrl: `http://127.0.0.1:${address.port}/v1`,
      models: ['gpt-test'],
    });
    const result = await engine.ping(created.id, 'codex');
    assert.equal(result.ok, true);
    assert.equal(result.status, 200);
    assert.equal([...result.steps].reverse().find((step) => step.id === 'openai-responses')?.status, 'ok');
    assert.ok(!result.steps.some((step) => step.id === 'openai-models'));
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
});

test('ping treats 401 as reachable, not down', async () => {
  const server = createServer((req, res) => {
    res.writeHead(401, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: { message: '客户端 API Key 无效', code: 'invalid_api_key' } }));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('no port');
  try {
    const engine = new Engine();
    const created = engine.addProvider({
      name: 'lvyrix',
      apiKey: 'sk-bad',
      openaiUrl: `http://127.0.0.1:${address.port}/v1`,
      models: ['gpt-test'],
    });
    const result = await engine.ping(created.id);
    assert.equal(result.ok, true);
    const summary = result.steps.find((step) => step.id === 'summary');
    assert.equal(summary?.status, 'warn');
    assert.ok(result.steps.some((step) => step.httpStatus === 401 && step.status === 'warn'));
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
});

test('ping only tests the current agent protocol', async () => {
  const hits: string[] = [];
  const server = createServer((req, res) => {
    hits.push(`${req.method} ${req.url}`);
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ data: [{ id: 'gpt-test' }] }));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('no port');
  try {
    const engine = new Engine();
    const created = engine.addProvider({
      name: 'multi',
      apiKey: 'sk-x',
      openaiUrl: `http://127.0.0.1:${address.port}/v1`,
      anthropicUrl: `http://127.0.0.1:${address.port}`,
      geminiUrl: `http://127.0.0.1:${address.port}/v1beta`,
      models: ['gpt-test'],
    });

    hits.length = 0;
    const codex = await engine.ping(created.id, 'codex');
    assert.equal(codex.ok, true);
    assert.ok(codex.steps.some((step) => step.id === 'openai-responses' && step.status === 'ok'));
    assert.ok(!codex.steps.some((step) => step.id === 'anthropic-messages' || step.id === 'gemini-generate'));

    hits.length = 0;
    const claude = await engine.ping(created.id, 'claude');
    assert.equal(claude.ok, true);
    assert.ok(claude.steps.some((step) => step.id === 'anthropic-messages' && step.status === 'ok'));
    assert.ok(!claude.steps.some((step) => step.id === 'openai-responses' || step.id === 'openai-chat' || step.id === 'gemini-generate'));
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
});

test('ping fails when current agent protocol is missing', async () => {
  const engine = new Engine();
  const created = engine.addProvider({
    name: 'openai-only',
    apiKey: 'sk-x',
    openaiUrl: 'https://example.test/v1',
    models: ['gpt-test'],
  });
  const result = await engine.ping(created.id, 'claude');
  assert.equal(result.ok, false);
  assert.match(String(result.error), /Anthropic/);
});
