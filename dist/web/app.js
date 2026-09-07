const $ = (sel) => document.querySelector(sel);
const APPS = [
  { id: 'claude', name: 'Claude' },
  { id: 'codex', name: 'Codex' },
  { id: 'gemini', name: 'Gemini' },
  { id: 'opencode', name: 'OpenCode' },
];

const THEMES = [
  { id: 'midnight', name: '午夜蓝', color: '#3b82f6' },
  { id: 'paper', name: '纸张白', color: '#2563eb' },
  { id: 'ocean', name: '深海青', color: '#14b8a6' },
  { id: 'plum', name: '暮紫', color: '#a78bfa' },
  { id: 'forest', name: '松林绿', color: '#34d399' },
];

const PROTOCOL_LABELS = {
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  gemini: 'Gemini',
};

const APP_PROTOCOL = {
  claude: ['anthropic'],
  codex: ['openai'],
  opencode: ['openai'],
  gemini: ['gemini'],
};

const state = {
  view: 'providers',
  app: localStorage.getItem('msw-app') || 'codex',
  query: '',
  status: null,
  providers: [],
  presets: [],
  models: [],
  mcp: [],
  theme: localStorage.getItem('msw-theme') || 'midnight',
};

function applyTheme(themeId, persist = true) {
  const theme = THEMES.some((item) => item.id === themeId) ? themeId : 'midnight';
  state.theme = theme;
  document.documentElement.dataset.theme = theme;
  if (persist) localStorage.setItem('msw-theme', theme);
  renderThemeOptions();
}

function renderThemeOptions() {
  const menu = $('#theme-options');
  if (!menu) return;
  menu.innerHTML = THEMES.map((theme) => `<button class="theme-option ${state.theme === theme.id ? 'active' : ''}" type="button" data-theme-id="${theme.id}">
    <span class="theme-swatch" style="--swatch:${theme.color}"></span>
    <span>${theme.name}</span>
    ${state.theme === theme.id ? '<span class="theme-check">✓</span>' : ''}
  </button>`).join('');
}

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
  return Boolean(live?.currentProviderId && live.currentProviderId === provider.id);
}

function protocolsForApp(app = state.app) {
  return APP_PROTOCOL[app] || ['openai', 'anthropic', 'gemini'];
}

function protocolUrl(provider, protocol) {
  return provider?.protocols?.[protocol]?.baseUrl || '';
}

function configuredProtocols(provider) {
  return Object.keys(PROTOCOL_LABELS).filter((item) => protocolUrl(provider, item));
}

function supportsAgent(provider, app = state.app) {
  return protocolsForApp(app).some((item) => protocolUrl(provider, item));
}

function agentProtocol(provider, app = state.app) {
  return protocolsForApp(app).find((item) => protocolUrl(provider, item));
}

function agentUrl(provider, app = state.app) {
  const protocol = agentProtocol(provider, app);
  return protocol ? protocolUrl(provider, protocol) : '';
}

function appName(app = state.app) {
  return APPS.find((item) => item.id === app)?.name || app;
}

function agentNeedLabel(app = state.app) {
  return protocolsForApp(app).map((item) => PROTOCOL_LABELS[item]).join(' / ');
}

function protocolLine(provider) {
  return configuredProtocols(provider).map((item) => protocolUrl(provider, item)).join(' ') || '未配置地址';
}

function initial(name) {
  return String(name || '?').trim().slice(0, 2).toUpperCase();
}

async function refresh() {
  const [status, providers, presets, models, mcp] = await Promise.all([
    api('/api/status'),
    api('/api/providers'),
    api('/api/presets'),
    api('/api/models'),
    api('/api/mcp'),
  ]);
  state.status = status;
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
  const available = state.providers.filter((item) => supportsAgent(item)).length;
  $('#status-chip').innerHTML = `<span class="dot ${on ? 'on' : 'off'}"></span>
    <b>${live?.name || appName()}</b>
    <span>${live?.model || '未配置'}</span>
    <span>${live?.providerLabel || live?.bin || (live?.installed ? '已安装' : '未安装')}</span>
    <span>${available} 个可用</span>`;
  const configButton = $('#btn-agent-config');
  if (configButton) configButton.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 5.5A1.5 1.5 0 0 1 5.5 4h13A1.5 1.5 0 0 1 20 5.5v13a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 18.5v-13Z" stroke="currentColor" stroke-width="1.7"/><path d="M7 8h10M7 12h7M7 16h5" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>查看 ${escapeHtml(appName())} 配置`;
}

function renderProviders() {
  const q = state.query.trim().toLowerCase();
  const scoped = state.providers.filter((provider) => supportsAgent(provider));
  const list = scoped.filter((provider) => {
    if (!q) return true;
    const hay = [
      provider.name,
      provider.id,
      protocolLine(provider),
      ...configuredProtocols(provider).map((item) => PROTOCOL_LABELS[item]),
      ...modelsOf(provider.id).map((item) => item.modelId),
    ].join(' ').toLowerCase();
    return hay.includes(q);
  });
  if (!list.length) {
    const empty = !state.providers.length
      ? { title: '还没有供应商', detail: '添加一个预设或自定义中转。' }
      : !scoped.length
        ? { title: `当前 ${appName()} 没有可用供应商`, detail: `请添加带 ${agentNeedLabel()} 地址的供应商，或切换到其他 Agent。` }
        : { title: '没有匹配的供应商', detail: '换个关键词，或清空搜索后再试。' };
    $('#view-providers').innerHTML = `<div class="empty">
      <h3>${empty.title}</h3>
      <p>${empty.detail}</p>
      <button class="btn primary" id="btn-add-empty" type="button">添加供应商</button>
    </div>`;
    return;
  }
  $('#view-providers').innerHTML = `<div class="cards">${list.map((provider) => {
    const current = isCurrentProvider(provider);
    const models = modelsOf(provider.id).map((item) => item.modelId).join(', ') || '默认模型';
    const protocol = agentProtocol(provider);
    const url = agentUrl(provider);
    const tags = configuredProtocols(provider).map((item) => {
      const active = protocolsForApp().includes(item);
      return `<span class="tag ${item}${active ? '' : ' dim'}">${PROTOCOL_LABELS[item]}</span>`;
    }).join('');
    return `<article class="card ${current ? 'current' : ''}">
      <div class="card-head">
        <div class="icon-box">${initial(provider.name)}</div>
        <div class="card-title">
          <h3>${escapeHtml(provider.name)}
            ${current ? '<span class="badge">当前</span>' : ''}
            ${provider.apiKey ? '' : '<span class="badge warn">无 KEY</span>'}
          </h3>
          <div class="tags">${tags}</div>
        </div>
      </div>
      <div class="card-body">
        <div class="meta models">${escapeHtml(models)}</div>
        <div class="meta url">${escapeHtml(protocol ? PROTOCOL_LABELS[protocol] : agentNeedLabel())} · ${escapeHtml(url || '未配置当前 Agent 地址')}</div>
      </div>
      <div class="card-actions">
        <button class="btn sm" data-edit="${provider.id}" type="button">查看/编辑</button>
        <button class="btn sm" data-ping="${provider.id}" type="button">测通</button>
        <button class="btn sm danger" data-del="${provider.id}" type="button">删除</button>
        <button class="btn sm ${current ? 'success' : 'primary'}" data-use="${provider.id}" type="button">${current ? '使用中' : '启用'}</button>
      </div>
    </article>`;
  }).join('')}</div>`;
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
  if (state.view !== 'providers' && state.view !== 'mcp') state.view = 'providers';
  renderSwitcher();
  renderStatus();
  document.querySelectorAll('[data-view]').forEach((btn) => btn.classList.toggle('primary', false));
  const activeViewBtn = document.querySelector(`[data-view="${state.view}"]`);
  if (activeViewBtn) activeViewBtn.classList.add('primary');
  $('#view-providers').classList.toggle('hidden', state.view !== 'providers');
  $('#view-mcp').classList.toggle('hidden', state.view !== 'mcp');
  if (state.view === 'providers') renderProviders();
  if (state.view === 'mcp') renderMcp();
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}

function closeModal() {
  $('#modal').classList.add('hidden');
  $('#modal').innerHTML = '';
}

function renderProbe(steps) {
  return [...steps.values()].map((step) => {
    const meta = [step.method, step.httpStatus, step.ms != null ? `${step.ms}ms` : ''].filter(Boolean).join(' · ');
    return `<div class="probe-step ${step.status}">
      <span class="probe-mark"></span>
      <div>
        <div class="probe-title">${escapeHtml(step.title)} ${meta ? `<span class="muted">${escapeHtml(meta)}</span>` : ''}</div>
        ${step.url ? `<div class="meta">${escapeHtml(step.url)}</div>` : ''}
        ${step.detail ? `<div class="probe-detail">${escapeHtml(step.detail)}</div>` : ''}
      </div>
    </div>`;
  }).join('');
}

async function openPingModal(providerId) {
  const provider = state.providers.find((item) => item.id === providerId);
  $('#modal').classList.remove('hidden');
  $('#modal').innerHTML = `<div class="dialog">
    <h2>测通 ${escapeHtml(provider?.name || providerId)} · ${escapeHtml(appName())}</h2>
    <div class="probe" id="probe-list"><div class="probe-step running"><span class="probe-mark"></span><div><div class="probe-title">开始测试</div></div></div></div>
    <div class="dialog-actions">
      <button class="btn" type="button" id="btn-cancel">关闭</button>
    </div>
  </div>`;
  const list = $('#probe-list');
  const steps = new Map();
  const res = await fetch(`/api/providers/${encodeURIComponent(providerId)}/ping?agent=${encodeURIComponent(state.app)}`, { method: 'POST' });
  if (!res.ok) {
    const data = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(data.error || res.statusText);
  }
  if (!res.body) throw new Error('测通没有返回内容');
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop() || '';
    for (const line of lines) {
      if (!line.trim()) continue;
      const step = JSON.parse(line);
      steps.set(step.id, step);
      list.innerHTML = renderProbe(steps);
    }
  }
  if (buf.trim()) {
    const step = JSON.parse(buf);
    steps.set(step.id, step);
    list.innerHTML = renderProbe(steps);
  }
  const summary = [...steps.values()].find((item) => item.id === 'summary');
  if (summary) toast(summary.title || (summary.status === 'fail' ? '测通失败' : '测通完成'), summary.status === 'fail');
}

function protocolOf(provider, name) {
  return provider?.protocols?.[name]?.baseUrl || '';
}

async function openAgentConfigModal() {
  const agentId = state.app;
  $('#modal').classList.remove('hidden');
  $('#modal').innerHTML = `<div class="dialog config-dialog">
    <h2>查看并编辑 ${escapeHtml(appName(agentId))} 配置</h2>
    <div class="config-loading">正在读取配置文件…</div>
  </div>`;
  try {
    const config = await api(`/api/agents/${encodeURIComponent(agentId)}/config`);
    $('#modal').innerHTML = `<div class="dialog config-dialog">
      <div class="config-heading">
        <div>
          <h2>编辑 ${escapeHtml(config.agentName)} 配置</h2>
          <div class="meta config-path">${escapeHtml(config.path)}</div>
        </div>
        <span class="config-state ${config.exists ? 'exists' : 'missing'}">${config.exists ? '已存在' : '文件不存在，将新建'}</span>
      </div>
      <p class="config-tip">保存前会自动备份当前文件。保存后重新启动 ${escapeHtml(config.agentName)} 才会读取新配置。</p>
      <form id="agent-config-form" data-agent="${escapeHtml(config.agentId)}">
        <textarea name="content" class="config-editor" spellcheck="false">${escapeHtml(config.content)}</textarea>
        <div class="dialog-actions">
          <button class="btn" type="button" id="btn-cancel">取消</button>
          <button class="btn primary" type="submit">保存配置</button>
        </div>
      </form>
    </div>`;
  } catch (error) {
    closeModal();
    toast(error.message || String(error), true);
  }
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
        ${editing ? `<button class="btn" type="button" data-ping="${escapeHtml(provider.id)}">测通</button>` : ''}
        <button class="btn" type="button" id="btn-cancel">取消</button>
        <button class="btn primary" type="submit">${editing ? '保存修改' : '添加'}</button>
      </div>
    </form>
  </div>`;
}

applyTheme(state.theme, false);

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
    if (event.target.id === 'modal' && !$('#add-provider, #edit-provider, #agent-config-form, .config-dialog')) closeModal();
    if (!event.target.closest('#theme-picker')) $('#theme-menu')?.classList.add('hidden');
    return;
  }
  if (t.dataset.themeId) {
    applyTheme(t.dataset.themeId);
    $('#theme-menu').classList.add('hidden');
    $('#btn-theme').setAttribute('aria-expanded', 'false');
    toast(`已切换到${THEMES.find((item) => item.id === state.theme)?.name || '新主题'}`);
    return;
  }
  if (t.id === 'btn-theme') {
    const menu = $('#theme-menu');
    const open = menu.classList.toggle('hidden');
    t.setAttribute('aria-expanded', String(!open));
    return;
  }
  if (t.id === 'btn-agent-config') {
    openAgentConfigModal().catch((error) => toast(error.message || String(error), true));
    return;
  }
  if (t.dataset.app) {
    state.app = t.dataset.app;
    localStorage.setItem('msw-app', state.app);
    state.view = 'providers';
    try {
      await api('/api/agent', { method: 'POST', body: { agentId: state.app } });
    } catch (error) {
      toast(error.message || String(error), true);
    }
    await refresh().catch((error) => toast(error.message || String(error), true));
    return;
  }
  if (t.dataset.view) {
    state.view = t.dataset.view;
    render();
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
    openPingModal(t.dataset.ping).catch((error) => toast(error.message || String(error), true));
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
    if (form.id === 'agent-config-form') {
      await api(`/api/agents/${encodeURIComponent(form.dataset.agent)}/config`, {
        method: 'PUT',
        body: { content: String(data.content || '') },
      });
      closeModal();
      toast('Agent 配置已保存，并已创建备份');
      await refresh();
      return;
    }
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
