const $ = (sel) => document.querySelector(sel);
const APPS = [
  { id: 'claude', name: 'Claude' },
  { id: 'codex', name: 'Codex' },
  { id: 'gemini', name: 'Gemini' },
  { id: 'opencode', name: 'OpenCode' },
];

const state = {
  view: 'providers',
  app: localStorage.getItem('msw-app') || 'codex',
  query: '',
  status: null,
  profiles: [],
  providers: [],
  presets: [],
  models: [],
  mcp: [],
};

async function api(path, opts = {}) {
  const res = await fetch(path, {
    headers: { 'content-type': 'application/json' },
    ...opts,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
}

function toast(message, err = false) {
  const el = $('#toast');
  el.textContent = message;
  el.classList.toggle('err', err);
  el.classList.remove('hidden');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.add('hidden'), 2400);
}

function agent() {
  return state.status?.agents?.find((item) => item.id === state.app) || state.status?.current;
}

function modelsOf(providerId) {
  return state.models.filter((item) => item.providerId === providerId);
}

function isCurrentProvider(provider) {
  const live = agent();
  if (!live) return false;
  if (live.providerLabel && (live.providerLabel === provider.name || live.providerLabel === provider.id)) return true;
  return modelsOf(provider.id).some((item) => item.modelId === live.model);
}

function protocolLine(provider) {
  return Object.values(provider.protocols || {})
    .map((item) => item.baseUrl)
    .filter(Boolean)[0] || '未配置地址';
}

function initial(name) {
  return String(name || '?').trim().slice(0, 2).toUpperCase();
}

async function refresh() {
  const [status, profiles, providers, presets, models, mcp] = await Promise.all([
    api('/api/status'),
    api('/api/profiles'),
    api('/api/providers'),
    api('/api/presets'),
    api('/api/models'),
    api('/api/mcp'),
  ]);
  state.status = status;
  state.profiles = profiles;
  state.providers = providers;
  state.presets = presets;
  state.models = models;
  state.mcp = mcp;
  if (!APPS.some((app) => app.id === state.app)) state.app = status.state?.currentAgent || 'codex';
  render();
}

function renderSwitcher() {
  $('#app-switcher').innerHTML = APPS.map((app) => {
    const live = state.status?.agents?.find((item) => item.id === app.id);
    return `<button type="button" data-app="${app.id}" class="${state.app === app.id ? 'active' : ''}" title="${app.name}${live?.installed ? '' : '（未安装）'}">
      <span class="glyph ${app.id}">${app.name.slice(0, 1)}</span>${app.name}
    </button>`;
  }).join('');
}

function renderStatus() {
  const live = agent();
  const on = Boolean(live?.installed && live?.configured);
  $('#status-chip').innerHTML = `<span class="dot ${on ? 'on' : 'off'}"></span>
    <b>${live?.name || state.app}</b>
    <span>${live?.model || '未配置'}</span>
    <span>${live?.providerLabel || live?.bin || (live?.installed ? '已安装' : '未安装')}</span>`;
}

function renderProviders() {
  const q = state.query.trim().toLowerCase();
  const list = state.providers.filter((provider) => {
    if (!q) return true;
    const hay = [provider.name, provider.id, protocolLine(provider), ...modelsOf(provider.id).map((item) => item.modelId)].join(' ').toLowerCase();
    return hay.includes(q);
  });
  if (!list.length) {
    $('#view-providers').innerHTML = `<div class="empty">
      <h3>${state.providers.length ? '没有匹配的供应商' : '还没有供应商'}</h3>
      <p>导入本机配置，或添加一个预设 / 自定义中转。</p>
      <button class="btn primary" id="btn-add-empty" type="button">添加供应商</button>
    </div>`;
    return;
  }
  $('#view-providers').innerHTML = `<div class="list">${list.map((provider) => {
    const current = isCurrentProvider(provider);
    const models = modelsOf(provider.id).map((item) => item.modelId).join(', ') || '默认模型';
    return `<article class="card ${current ? 'current' : ''}">
      <div class="card-main">
        <div class="icon-box">${initial(provider.name)}</div>
        <div>
          <h3>${escapeHtml(provider.name)} ${current ? '<span class="badge">当前</span>' : ''}
            ${provider.apiKey ? '<span class="badge ok">KEY</span>' : '<span class="badge warn">无 KEY</span>'}
          </h3>
          <div class="meta">${escapeHtml(models)} · ${escapeHtml(protocolLine(provider))}</div>
        </div>
      </div>
      <div class="card-actions">
        <button class="btn sm" data-edit="${provider.id}" type="button">查看/编辑</button>
        <button class="btn sm" data-ping="${provider.id}" type="button">测通</button>
        <button class="btn sm danger" data-del="${provider.id}" type="button">删除</button>
        <button class="btn sm ${current ? '' : 'primary'}" data-use="${provider.id}" type="button">${current ? '使用中' : '启用'}</button>
      </div>
    </article>`;
  }).join('')}</div>`;
}

function renderProfiles() {
  if (!state.profiles.length) {
    $('#view-profiles').innerHTML = '<div class="empty"><h3>还没有 Profile</h3><p>导入配置或添加供应商后会自动生成。</p></div>';
    return;
  }
  $('#view-profiles').innerHTML = `<div class="section-title">Profiles</div>${state.profiles.map((profile) => {
    const current = profile.id === state.status?.state?.currentProfile;
    const bindings = profile.bindings.map((item) => `${item.agentId}:${item.modelId}`).join(' · ') || '无绑定';
    return `<div class="row">
      <div><b>${escapeHtml(profile.name)} ${current ? '<span class="badge">当前</span>' : ''}</b><div class="muted">${escapeHtml(profile.id)} · ${escapeHtml(bindings)}</div></div>
      <button class="btn sm primary" data-use="${profile.id}" type="button">切换</button>
    </div>`;
  }).join('')}`;
}

function renderMcp() {
  $('#view-mcp').innerHTML = `
    <form class="form-grid" id="add-mcp">
      <label class="field">名称<input name="name" required placeholder="filesystem" /></label>
      <label class="field">命令<input name="command" placeholder="npx" /></label>
      <label class="field">参数<input name="args" placeholder="-y,@modelcontextprotocol/server-filesystem" /></label>
      <label class="field">&nbsp;<button class="btn primary" type="submit">添加 MCP</button></label>
    </form>
    ${state.mcp.map((server) => `<div class="row"><div><b>${escapeHtml(server.name)}</b><div class="muted">${server.transport} · ${(server.agents || []).join(',') || 'all'}</div></div></div>`).join('') || '<div class="empty"><h3>尚未配置 MCP</h3></div>'}
    <button class="btn" id="btn-sync-mcp" type="button">同步到各 Agent</button>
  `;
}

function render() {
  renderSwitcher();
  renderStatus();
  document.querySelectorAll('[data-view]').forEach((btn) => btn.classList.toggle('primary', false));
  const activeViewBtn = document.querySelector(`[data-view="${state.view}"]`);
  if (activeViewBtn) activeViewBtn.classList.add('primary');
  $('#view-providers').classList.toggle('hidden', state.view !== 'providers');
  $('#view-profiles').classList.toggle('hidden', state.view !== 'profiles');
  $('#view-mcp').classList.toggle('hidden', state.view !== 'mcp');
  if (state.view === 'providers') renderProviders();
  if (state.view === 'profiles') renderProfiles();
  if (state.view === 'mcp') renderMcp();
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}

function closeModal() {
  $('#modal').classList.add('hidden');
  $('#modal').innerHTML = '';
}

function protocolOf(provider, name) {
  return provider?.protocols?.[name]?.baseUrl || '';
}

async function openProviderModal(providerId) {
  const presets = [{ id: 'custom', name: '自定义中转' }, ...state.presets];
  let provider = null;
  let models = [];
  if (providerId) {
    const detail = await api(`/api/providers/${encodeURIComponent(providerId)}`);
    provider = detail.provider;
    models = detail.models || [];
  }
  const editing = Boolean(provider);
  $('#modal').classList.remove('hidden');
  $('#modal').innerHTML = `<div class="dialog">
    <h2>${editing ? '查看 / 编辑供应商' : '添加供应商'}</h2>
    <form id="${editing ? 'edit-provider' : 'add-provider'}" data-id="${editing ? escapeHtml(provider.id) : ''}">
      <div class="form-grid">
        ${editing ? `<label class="field">ID<input value="${escapeHtml(provider.id)}" disabled /></label>` : `<label class="field">类型
          <select name="preset">${presets.map((item) => `<option value="${item.id}">${escapeHtml(item.name)}</option>`).join('')}</select>
        </label>`}
        <label class="field">名称<input name="name" value="${escapeHtml(provider?.name || '')}" placeholder="agentrouter / kimi" /></label>
        <label class="field">API Key
          <span class="key-row">
            <input name="apiKey" type="password" value="${escapeHtml(provider?.apiKey || '')}" placeholder="${editing ? '已保存，可直接修改' : 'sk-...'}" autocomplete="off" />
            <button class="btn sm" type="button" id="btn-toggle-key">显示</button>
          </span>
        </label>
        <label class="field">OpenAI 地址<input name="openaiUrl" value="${escapeHtml(protocolOf(provider, 'openai'))}" placeholder="https://api.example.com/v1" /></label>
        <label class="field">Anthropic 地址<input name="anthropicUrl" value="${escapeHtml(protocolOf(provider, 'anthropic'))}" placeholder="可选" /></label>
        <label class="field">Gemini 地址<input name="geminiUrl" value="${escapeHtml(protocolOf(provider, 'gemini'))}" placeholder="可选" /></label>
        <label class="field">模型<input name="models" value="${escapeHtml(models.map((item) => item.modelId).join(','))}" placeholder="gpt-5.6-sol,deepseek-v4-flash" /></label>
      </div>
      <div class="dialog-actions">
        <button class="btn" type="button" id="btn-cancel">取消</button>
        <button class="btn primary" type="submit">${editing ? '保存修改' : '添加'}</button>
      </div>
    </form>
  </div>`;
}

async function run(action, success) {
  try {
    await action();
    if (success) toast(success);
    await refresh();
  } catch (error) {
    toast(error.message || String(error), true);
  }
}

document.body.addEventListener('click', async (event) => {
  const t = event.target.closest('button, [data-app], [data-view]');
  if (!t) {
    if (event.target.id === 'modal') closeModal();
    return;
  }
  if (t.dataset.app) {
    state.app = t.dataset.app;
    localStorage.setItem('msw-app', state.app);
    state.view = 'providers';
    await run(() => api('/api/agent', { method: 'POST', body: { agentId: state.app } }));
    return;
  }
  if (t.dataset.view) {
    state.view = t.dataset.view;
    render();
    return;
  }
  if (t.id === 'btn-init') {
    await run(() => api('/api/init', { method: 'POST', body: {} }), '已导入本机配置');
    return;
  }
  if (t.id === 'btn-add' || t.id === 'btn-add-empty') {
    openProviderModal().catch((error) => toast(error.message || String(error), true));
    return;
  }
  if (t.id === 'btn-toggle-key') {
    const input = t.parentElement.querySelector('input');
    if (input) {
      input.type = input.type === 'password' ? 'text' : 'password';
      t.textContent = input.type === 'password' ? '显示' : '隐藏';
    }
    return;
  }
  if (t.dataset.edit) {
    openProviderModal(t.dataset.edit).catch((error) => toast(error.message || String(error), true));
    return;
  }
  if (t.id === 'btn-cancel') {
    closeModal();
    return;
  }
  if (t.dataset.use) {
    await run(() => api('/api/switch', { method: 'POST', body: { target: t.dataset.use, agent: state.app } }), '已切换');
    return;
  }
  if (t.dataset.ping) {
    try {
      t.disabled = true;
      const result = await api(`/api/providers/${t.dataset.ping}/ping`, { method: 'POST', body: {} });
      toast(result.ok ? `测通 OK ${result.status || ''}`.trim() : '测通失败', !result.ok);
    } catch (error) {
      toast(error.message || String(error), true);
    } finally {
      t.disabled = false;
    }
    return;
  }
  if (t.dataset.del) {
    if (!confirm(`删除供应商 ${t.dataset.del}？`)) return;
    await run(() => api(`/api/providers/${t.dataset.del}`, { method: 'DELETE' }), '已删除');
    return;
  }
  if (t.id === 'btn-sync-mcp') {
    await run(() => api('/api/mcp/sync', { method: 'POST', body: {} }), 'MCP 已同步');
  }
});

document.body.addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.target;
  if (!(form instanceof HTMLFormElement)) return;
  const data = Object.fromEntries(new FormData(form).entries());
  try {
    if (form.id === 'add-provider' || form.id === 'edit-provider') {
      const body = {
        preset: data.preset === 'custom' ? undefined : data.preset,
        name: data.name || undefined,
        apiKey: data.apiKey || undefined,
        openaiUrl: data.openaiUrl || undefined,
        anthropicUrl: data.anthropicUrl || undefined,
        geminiUrl: data.geminiUrl || undefined,
        models: String(data.models || '').split(',').map((item) => item.trim()).filter(Boolean),
      };
      if (!body.models.length) delete body.models;
      if (form.id === 'edit-provider') {
        await api(`/api/providers/${encodeURIComponent(form.dataset.id)}`, { method: 'PUT', body });
        toast('供应商已更新');
      } else {
        await api('/api/providers', { method: 'POST', body });
        toast('供应商已添加');
      }
      closeModal();
    }
    if (form.id === 'add-mcp') {
      await api('/api/mcp', {
        method: 'POST',
        body: { ...data, args: String(data.args || '').split(',').map((item) => item.trim()).filter(Boolean) },
      });
      toast('MCP 已添加');
    }
    await refresh();
  } catch (error) {
    toast(error.message || String(error), true);
  }
});

$('#search').addEventListener('input', (event) => {
  state.query = event.target.value;
  if (state.view === 'providers') renderProviders();
});

refresh().catch((error) => toast(error.message || String(error), true));
