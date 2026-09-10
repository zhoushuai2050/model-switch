import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { engine } from "./core/engine.js";
import { isAgentId } from "./core/types.js";
const here = dirname(fileURLToPath(import.meta.url));
const webRoot = existsSync(join(here, 'web', 'index.html'))
    ? join(here, 'web')
    : join(here, '..', 'src', 'web');
const mime = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.json': 'application/json',
};
export async function startServer(port = 8787) {
    const server = createServer((req, res) => {
        void handle(req, res);
    });
    await new Promise((resolve, reject) => {
        server.on('error', reject);
        server.listen(port, '127.0.0.1', () => resolve());
    });
    console.log(`Model Switch 管理台  http://127.0.0.1:${port}`);
}
async function handle(req, res) {
    try {
        const url = new URL(req.url || '/', 'http://127.0.0.1');
        if (url.pathname.startsWith('/api/')) {
            await api(req, res, url);
            return;
        }
        staticFile(res, url.pathname);
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        send(res, 400, { error: message });
    }
}
async function api(req, res, url) {
    const path = url.pathname.replace(/\/$/, '') || '/';
    if (req.method === 'GET' && path === '/api/status')
        return send(res, 200, engine.status());
    if (req.method === 'GET' && path.startsWith('/api/agents/') && path.endsWith('/config')) {
        const id = decodeURIComponent(path.split('/')[3] || '');
        return send(res, 200, engine.getAgentConfig(id));
    }
    if (req.method === 'PUT' && path.startsWith('/api/agents/') && path.endsWith('/config')) {
        const id = decodeURIComponent(path.split('/')[3] || '');
        const body = await readBody(req);
        return send(res, 200, engine.saveAgentConfig(id, String(body.content ?? '')));
    }
    if (req.method === 'GET' && path === '/api/providers')
        return send(res, 200, engine.listProviders());
    if (req.method === 'GET' && path.startsWith('/api/providers/')) {
        const id = decodeURIComponent(path.split('/')[3] || '');
        return send(res, 200, engine.getProvider(id));
    }
    if (req.method === 'GET' && path === '/api/models')
        return send(res, 200, engine.listModels());
    if (req.method === 'GET' && path === '/api/presets')
        return send(res, 200, engine.listPresets());
    if (req.method === 'GET' && path === '/api/mcp')
        return send(res, 200, engine.listMcp());
    if (req.method === 'GET' && path === '/api/logs')
        return send(res, 200, engine.listLogs());
    if (req.method === 'POST' && path === '/api/switch') {
        const body = await readBody(req);
        const result = engine.use(String(body.target || ''), {
            agent: body.agent ? String(body.agent) : undefined,
        });
        return send(res, 200, result);
    }
    if (req.method === 'POST' && path === '/api/agent') {
        const body = await readBody(req);
        engine.setAgent(String(body.agentId || body.id));
        return send(res, 200, engine.status());
    }
    if (req.method === 'POST' && path === '/api/providers') {
        const body = await readBody(req);
        const provider = engine.addProvider({
            preset: body.preset ? String(body.preset) : undefined,
            name: body.name ? String(body.name) : undefined,
            apiKey: body.apiKey ? String(body.apiKey) : undefined,
            openaiUrl: body.openaiUrl ? String(body.openaiUrl) : undefined,
            anthropicUrl: body.anthropicUrl ? String(body.anthropicUrl) : undefined,
            geminiUrl: body.geminiUrl ? String(body.geminiUrl) : undefined,
            models: Array.isArray(body.models) ? body.models.map(String) : undefined,
            defaultModel: body.defaultModel ? String(body.defaultModel) : undefined,
            agent: body.agent ? String(body.agent) : undefined,
        });
        return send(res, 200, provider);
    }
    if (req.method === 'PUT' && path.startsWith('/api/providers/')) {
        const id = decodeURIComponent(path.split('/')[3] || '');
        const body = await readBody(req);
        return send(res, 200, engine.updateProvider(id, {
            name: body.name ? String(body.name) : undefined,
            apiKey: body.apiKey != null ? String(body.apiKey) : undefined,
            openaiUrl: body.openaiUrl ? String(body.openaiUrl) : undefined,
            anthropicUrl: body.anthropicUrl ? String(body.anthropicUrl) : undefined,
            geminiUrl: body.geminiUrl ? String(body.geminiUrl) : undefined,
            wireApi: body.wireApi === 'chat' || body.wireApi === 'responses' ? body.wireApi : undefined,
            models: Array.isArray(body.models) ? body.models.map(String) : undefined,
            defaultModel: body.defaultModel ? String(body.defaultModel) : undefined,
            notes: body.notes != null ? String(body.notes) : undefined,
            websiteUrl: body.websiteUrl ? String(body.websiteUrl) : undefined,
        }));
    }
    if (req.method === 'POST' && path.startsWith('/api/providers/') && path.endsWith('/models')) {
        const id = decodeURIComponent(path.split('/')[3] || '');
        const body = await readBody(req);
        return send(res, 200, engine.addModel(id, String(body.modelId || body.model || '')));
    }
    if (req.method === 'POST' && path.startsWith('/api/providers/') && path.includes('/models/') && path.endsWith('/select')) {
        const parts = path.split('/');
        const id = decodeURIComponent(parts[3] || '');
        const model = decodeURIComponent(parts[5] || '');
        const body = await readBody(req);
        return send(res, 200, engine.selectModel(id, model, {
            agent: body.agent ? String(body.agent) : undefined,
            apply: body.apply === false ? false : undefined,
        }));
    }
    if (req.method === 'DELETE' && path.startsWith('/api/providers/') && path.includes('/models/')) {
        const parts = path.split('/');
        const id = decodeURIComponent(parts[3] || '');
        const model = decodeURIComponent(parts[5] || '');
        return send(res, 200, engine.removeModel(id, model));
    }
    if (req.method === 'POST' && path.startsWith('/api/providers/') && path.endsWith('/key')) {
        const id = path.split('/')[3];
        const body = await readBody(req);
        return send(res, 200, engine.updateProvider(id, { apiKey: String(body.apiKey || '') }));
    }
    if (req.method === 'POST' && path.startsWith('/api/providers/') && path.endsWith('/ping')) {
        const id = decodeURIComponent(path.split('/')[3] || '');
        const agent = url.searchParams.get('agent');
        res.writeHead(200, {
            'content-type': 'application/x-ndjson; charset=utf-8',
            'cache-control': 'no-store',
        });
        try {
            for await (const step of engine.pingSteps(id, agent && isAgentId(agent) ? agent : undefined)) {
                res.write(`${JSON.stringify(step)}\n`);
            }
        }
        catch (error) {
            const detail = error instanceof Error ? error.message : String(error);
            res.write(`${JSON.stringify({ id: 'summary', title: '测通失败', status: 'fail', detail })}\n`);
        }
        res.end();
        return;
    }
    if (req.method === 'DELETE' && path.startsWith('/api/providers/')) {
        engine.deleteProvider(path.split('/')[3]);
        return send(res, 200, { ok: true });
    }
    if (req.method === 'POST' && path === '/api/mcp/sync') {
        return send(res, 200, { synced: engine.syncMcp() });
    }
    if (req.method === 'POST' && path === '/api/mcp') {
        const body = await readBody(req);
        const agents = Array.isArray(body.agents) ? body.agents.filter((item) => isAgentId(String(item))) : [];
        return send(res, 200, engine.addMcp({
            name: String(body.name || ''),
            command: body.command ? String(body.command) : undefined,
            args: Array.isArray(body.args) ? body.args.map(String) : undefined,
            url: body.url ? String(body.url) : undefined,
            agents,
        }));
    }
    send(res, 404, { error: 'not found' });
}
function staticFile(res, pathname) {
    let rel = pathname === '/' ? '/index.html' : pathname;
    rel = rel.replace(/\.\./g, '');
    const file = join(webRoot, rel);
    if (!existsSync(file)) {
        send(res, 404, { error: 'not found' });
        return;
    }
    const type = mime[extname(file)] || 'application/octet-stream';
    res.writeHead(200, { 'content-type': type });
    res.end(readFileSync(file));
}
function send(res, status, body) {
    const json = JSON.stringify(body);
    res.writeHead(status, {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
    });
    res.end(json);
}
async function readBody(req) {
    const chunks = [];
    for await (const chunk of req)
        chunks.push(Buffer.from(chunk));
    const text = Buffer.concat(chunks).toString('utf8').trim();
    if (!text)
        return {};
    return JSON.parse(text);
}
