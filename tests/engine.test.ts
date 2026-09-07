import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { connect as netConnect } from 'node:net';
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

test('new providers use random UUID IDs while names remain usable targets', () => {
  const engine = new Engine();
  const first = engine.addProvider({ name: 'relay', apiKey: 'sk-a', openaiUrl: 'https://a.example/v1', models: ['a'] });
  const second = engine.addProvider({ name: 'relay', apiKey: 'sk-b', openaiUrl: 'https://b.example/v1', models: ['b'] });
  assert.match(first.id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  assert.match(second.id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  assert.notEqual(first.id, second.id);
  assert.equal(engine.getProvider(first.id).provider.name, 'relay');
});

test('deleteProvider removes a provider by name', () => {
  const engine = new Engine();
  engine.addProvider({ name: 'kimi', apiKey: 'sk-kimi', openaiUrl: 'https://api.moonshot.cn/v1', models: ['kimi-k2.5'] });
  const deleted = engine.deleteProvider('kimi');
  assert.equal(deleted.name, 'kimi');
  assert.equal(engine.listProviders().length, 0);
  assert.equal(engine.listModels().length, 0);
});

test('deleteProvider requires id when names collide', () => {
  const engine = new Engine();
  const first = engine.addProvider({ name: 'relay', apiKey: 'sk-a', openaiUrl: 'https://a.example/v1', models: ['a'] });
  const second = engine.addProvider({ name: 'relay', apiKey: 'sk-b', openaiUrl: 'https://b.example/v1', models: ['b'] });
  assert.throws(() => engine.deleteProvider('relay'), /多个供应商名为 relay/);
  const deleted = engine.deleteProvider(first.id);
  assert.equal(deleted.id, first.id);
  assert.equal(engine.listProviders().map((item) => item.id).join(), second.id);
});

test('listProvidersForAgent filters by agent protocol like the web UI', () => {
  const engine = new Engine();
  engine.addProvider({
    name: 'claude-only',
    apiKey: 'sk',
    anthropicUrl: 'https://a.example',
    models: ['claude-sonnet-4-6', 'claude-opus-4'],
  });
  engine.addProvider({
    name: 'codex-only',
    apiKey: 'sk',
    openaiUrl: 'https://b.example/v1',
    models: ['gpt-4.1'],
  });
  engine.addProvider({
    name: 'both',
    apiKey: 'sk',
    openaiUrl: 'https://c.example/v1',
    anthropicUrl: 'https://c.example',
    models: ['shared'],
  });
  assert.deepEqual(engine.listProvidersForAgent('claude').map((item) => item.name).sort(), ['both', 'claude-only']);
  assert.deepEqual(engine.listProvidersForAgent('codex').map((item) => item.name).sort(), ['both', 'codex-only']);
  assert.deepEqual(engine.listProvidersForAgent('gemini').map((item) => item.name), []);
  const claudeModels = engine.getProvider(engine.listProvidersForAgent('claude').find((item) => item.name === 'claude-only')!.id).models.map((item) => item.modelId).sort();
  assert.deepEqual(claudeModels, ['claude-opus-4', 'claude-sonnet-4-6']);
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
  engine.addProvider({ preset: 'deepseek', apiKey: 'sk-ds' });
  engine.setAgent('codex');
  const spec = engine.launch({ target: 'deepseek' });
  assert.equal(spec.command.includes('codex') || spec.command === 'codex' || existsSync(spec.command) || spec.command.endsWith('codex'), true);
  assert.ok(spec.args.includes('model=deepseek-chat') || spec.args.some((a) => a.includes('deepseek')));
  const text = readFileSync(join(root, '.codex', 'config.toml'), 'utf8');
  assert.match(text, /model = "grok-4.6"/);
});

test('codex current provider follows model_provider id, not shared model names', () => {
  const engine = new Engine();
  const first = engine.addProvider({
    name: 'relay',
    apiKey: 'sk-a',
    openaiUrl: 'https://a.example/v1',
    models: ['gpt-shared'],
  });
  const second = engine.addProvider({
    name: 'relay',
    apiKey: 'sk-b',
    openaiUrl: 'https://b.example/v1',
    models: ['gpt-shared'],
  });
  engine.setAgent('codex');
  engine.use(first.id);
  const text = readFileSync(join(root, '.codex', 'config.toml'), 'utf8');
  const tableId = first.id.replace(/-/g, '_');
  assert.match(text, new RegExp(`model_provider = "${tableId}"`));
  const live = engine.listAgents().find((item) => item.id === 'codex');
  assert.equal(live?.currentProviderId, first.id);
  assert.notEqual(live?.currentProviderId, second.id);

  engine.use(second.id);
  const next = engine.listAgents().find((item) => item.id === 'codex');
  assert.equal(next?.currentProviderId, second.id);
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


test('codex apply stores key on the provider like OpenCode, not in auth.json', () => {
  const engine = new Engine();
  const created = engine.addProvider({
    name: 'relay',
    apiKey: 'sk-secret-key',
    openaiUrl: 'https://relay.example/v1',
    models: ['gpt-5.6-sol'],
  });
  engine.setAgent('codex');
  engine.use('relay');
  const text = readFileSync(join(root, '.codex', 'config.toml'), 'utf8');
  const tableId = created.id.replace(/-/g, '_');
  assert.doesNotMatch(text, /env_key/);
  assert.match(text, /requires_openai_auth = false/);
  assert.match(text, /experimental_bearer_token = "sk-secret-key"/);
  assert.match(text, new RegExp(`\\[model_providers\\.${tableId}\\.http_headers\\]`));
  assert.match(text, /Authorization = "Bearer sk-secret-key"/);
  assert.equal(existsSync(join(root, '.codex', 'auth.json')), false);
});

test('opencode apply writes provider-scoped models, npm, and credentials', () => {
  const engine = new Engine();
  const created = engine.addProvider({
    name: 'relay',
    apiKey: 'sk-oc',
    openaiUrl: 'https://relay.example/v1',
    wireApi: 'responses',
    models: ['gpt-5.6-sol', 'deepseek-v4-flash'],
  });
  engine.setAgent('opencode');
  engine.use('opencode:gpt-5.6-sol');
  const key = created.id.replace(/-/g, '');
  const config = JSON.parse(readFileSync(join(root, '.config', 'opencode', 'opencode.json'), 'utf8'));
  assert.equal(config.model, `${key}/gpt-5.6-sol`);
  assert.equal(config.provider[key].npm, '@ai-sdk/openai');
  assert.equal(config.provider[key].options.baseURL, 'https://relay.example/v1');
  assert.equal(config.provider[key].options.apiKey, 'sk-oc');
  assert.deepEqual(Object.keys(config.provider[key].models).sort(), ['deepseek-v4-flash', 'gpt-5.6-sol']);
  const auth = JSON.parse(readFileSync(join(root, '.local', 'share', 'opencode', 'auth.json'), 'utf8'));
  assert.equal(auth[key].type, 'api');
  assert.equal(auth[key].key, 'sk-oc');
});

test('opencode apply uses openai-compatible npm for chat wire api', () => {
  const engine = new Engine();
  const created = engine.addProvider({
    name: 'kimi-relay',
    apiKey: 'sk-kimi',
    openaiUrl: 'https://api.moonshot.cn/v1',
    wireApi: 'chat',
    models: ['kimi-k2.5'],
  });
  engine.setAgent('opencode');
  engine.use('kimi-relay');
  const key = created.id.replace(/-/g, '');
  const config = JSON.parse(readFileSync(join(root, '.config', 'opencode', 'opencode.json'), 'utf8'));
  assert.equal(config.provider[key].npm, '@ai-sdk/openai-compatible');
  assert.equal(config.model, `${key}/kimi-k2.5`);
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
    const prompt = (requestBody?.input as Array<{ content?: Array<{ text?: string }> }>)[0]?.content?.[0]?.text;
    assert.equal(typeof prompt, 'string');
    assert.ok((prompt || '').length > 0);
    assert.notEqual(prompt, '你好，今日天气');
    assert.equal(requestBody?.stream, true);
    const responseStep = [...result.steps].reverse().find((step) => step.id === 'openai-responses');
    assert.match(responseStep?.detail || '', /今天天气不错/);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
});

test('ping uses the same randomized prompt in the request and status text', async () => {
  let requestPrompt = '';
  const server = createServer(async (req, res) => {
    if (req.method === 'POST' && req.url === '/v1/responses') {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(Buffer.from(chunk));
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as {
        input?: Array<{ content?: Array<{ text?: string }> }>;
      };
      requestPrompt = body.input?.[0]?.content?.[0]?.text || '';
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ output_text: '收到' }));
      return;
    }
    res.writeHead(404);
    res.end('not found');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('no port');
  try {
    const engine = new Engine();
    const created = engine.addProvider({
      name: 'random-prompt',
      apiKey: 'sk-x',
      openaiUrl: `http://127.0.0.1:${address.port}/v1`,
      wireApi: 'responses',
      models: ['gpt-test'],
    });
    const result = await engine.ping(created.id, 'codex');
    assert.ok(requestPrompt.length > 0);
    const responseStep = [...result.steps].reverse().find((step) => step.id === 'openai-responses');
    assert.match(responseStep?.title || '', new RegExp(`「${requestPrompt.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}」`));
    assert.match(result.steps.find((step) => step.id === 'summary')?.detail || '', new RegExp(`「${requestPrompt.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}」`));
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
});

test('ping reads a streaming Responses reply before the connection closes', async () => {
  const server = createServer((req, res) => {
    if (req.method !== 'POST' || req.url !== '/v1/responses') {
      res.writeHead(404);
      res.end('not found');
      return;
    }
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.write('event: response.output_text.delta\n');
    res.write('data: {"type":"response.output_text.delta","delta":"流"}\n\n');
    res.write('event: response.output_text.delta\n');
    res.write('data: {"type":"response.output_text.delta","delta":"式成功"}\n\n');
    res.write('event: response.completed\n');
    res.write('data: {"type":"response.completed"}\n\n');
    setTimeout(() => res.end(), 1000);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('no port');
  try {
    const engine = new Engine();
    const created = engine.addProvider({
      name: 'streaming',
      apiKey: 'sk-x',
      openaiUrl: `http://127.0.0.1:${address.port}/v1`,
      wireApi: 'responses',
      models: ['gpt-test'],
    });
    const result = await engine.ping(created.id, 'codex');
    assert.equal(result.ok, true);
    assert.match([...result.steps].reverse().find((step) => step.id === 'openai-responses')?.detail || '', /流式成功/);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
});

test('ping routes requests through HTTP_PROXY when configured', async () => {
  const upstreamRequests: string[] = [];
  const upstream = createServer((req, res) => {
    upstreamRequests.push(`${req.method} ${req.url}`);
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ output_text: '代理测试成功' }));
  });
  await new Promise<void>((resolve) => upstream.listen(0, '127.0.0.1', () => resolve()));
  const upstreamAddress = upstream.address();
  if (!upstreamAddress || typeof upstreamAddress === 'string') throw new Error('no upstream port');

  const proxyConnects: string[] = [];
  const proxy = createServer();
  proxy.on('connect', (req, clientSocket, head) => {
    proxyConnects.push(`${req.method} ${req.url}`);
    const upstreamSocket = netConnect(upstreamAddress.port, '127.0.0.1', () => {
      clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      if (head.length) upstreamSocket.write(head);
      clientSocket.pipe(upstreamSocket);
      upstreamSocket.pipe(clientSocket);
    });
    upstreamSocket.on('error', () => clientSocket.destroy());
  });
  await new Promise<void>((resolve) => proxy.listen(0, '127.0.0.1', () => resolve()));
  const proxyAddress = proxy.address();
  if (!proxyAddress || typeof proxyAddress === 'string') throw new Error('no proxy port');

  const proxyKeys = ['HTTP_PROXY', 'HTTPS_PROXY', 'NO_PROXY', 'http_proxy', 'https_proxy', 'no_proxy'];
  const previous = new Map(proxyKeys.map((key) => [key, process.env[key]]));
  for (const key of proxyKeys) delete process.env[key];
  process.env.HTTP_PROXY = `http://127.0.0.1:${proxyAddress.port}`;

  try {
    const engine = new Engine();
    const created = engine.addProvider({
      name: 'proxied',
      apiKey: 'sk-x',
      openaiUrl: 'http://upstream.example/v1',
      models: ['gpt-test'],
    });
    const result = await engine.ping(created.id, 'codex');
    assert.equal(result.ok, true);
    assert.deepEqual(proxyConnects, ['CONNECT upstream.example:80']);
    assert.deepEqual(upstreamRequests, ['POST /v1/responses']);
  } finally {
    for (const key of proxyKeys) {
      const value = previous.get(key);
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await Promise.all([
      new Promise<void>((resolve, reject) => proxy.close((error) => (error ? reject(error) : resolve()))),
      new Promise<void>((resolve, reject) => upstream.close((error) => (error ? reject(error) : resolve()))),
    ]);
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

test('gemini only uses providers with a Gemini URL', async () => {
  const engine = new Engine();
  const created = engine.addProvider({
    name: 'openai-only',
    apiKey: 'sk-x',
    openaiUrl: 'https://example.test/v1',
    models: ['gpt-test'],
  });
  const result = await engine.ping(created.id, 'gemini');
  assert.equal(result.ok, false);
  assert.match(String(result.error), /Gemini/);
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
