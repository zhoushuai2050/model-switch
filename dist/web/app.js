const $ = (sel) => document.querySelector(sel);

const state = {
  status: null,
  profiles: [],
  providers: [],
  presets: [],
  mcp: [],
};

async function api(path, opts = {}) {
  const res = await fetch(path, {
    headers: { 'content-type': 'application/json' },
    ...opts,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
}

async function refresh() {
  const [status, profiles, providers, presets, mcp] = await Promise.all([
    api('/api/status'),
    api('/api/profiles'),
    api('/api/providers'),
    api('/api/presets'),
    api('/api/mcp'),
  ]);
  state.status = status;
  state.profiles = profiles;
  state.providers = providers;
  state.presets = presets;
  state.mcp = mcp;
  render();
}

function render() {
  const current = state.status?.state?.currentAgent;
  $('#prompt').textContent = `${current || 'none'} / ${state.status?.current?.model || '-'}`;
  $('#agents').innerHTML = state.status.agents
    .map((agent) => {
      const active = agent.id === current;
      return `<article class="card ${active ? 'active' : ''}" data-agent="${agent.id}">
        <div class="kicker"><span class="dot ${agent.installed ? 'on' : 'off'}"></span>${agent.id}</div>
        <h2>${agent.name}</h2>
        <div class="meta">${agent.model || '未配置'}<br>${agent.providerLabel || agent.bin || '—'}</div>
      </article>`;
    })
    .join('');

  $('#panel-profiles').innerHTML =
    state.profiles
      .map((profile) => {
        const currentProfile = profile.id === state.status.state.currentProfile;
        const bindings = profile.bindings.map((b) => `${b.agentId}:${b.modelId}`).join(' · ') || '无绑定';
        return `<div class="row">
          <div><b>${currentProfile ? '● ' : ''}${profile.name}</b><div class="muted">${profile.id}</div></div>
          <div class="muted">${bindings}</div>
          <button data-use="${profile.id}" class="primary">切换</button>
        </div>`;
      })
      .join('') || '<p class="muted">还没有 Profile。先导入本机配置或添加供应商。</p>';

  $('#panel-providers').innerHTML = `
    <form class="add" id="add-provider">
      <label>预设<select name="preset">${state.presets.map((p) => `<option value="${p.id}">${p.name}</option>`).join('')}</select></label>
      <label>API Key<input name="apiKey" placeholder="sk-..." autocomplete="off" /></label>
      <label>自定义 OpenAI URL<input name="openaiUrl" placeholder="可选" /></label>
      <button class="primary" type="submit">添加供应商</button>
    </form>
    ${
      state.providers
        .map((p) => {
          const proto = Object.entries(p.protocols)
            .map(([k, v]) => `${k}: ${v.baseUrl}`)
            .join(' · ');
          return `<div class="row">
            <div><b>${p.name}</b><div class="muted">${p.id} · ${p.apiKey ? '已保存 key' : '无 key'}</div></div>
            <div class="muted">${proto}</div>
            <div>
              <button data-ping="${p.id}">测通</button>
              <button data-use="${p.id}">切换</button>
            </div>
          </div>`;
        })
        .join('') || '<p class="muted">还没有供应商。</p>'
    }`;

  $('#panel-mcp').innerHTML = `
    <form class="add" id="add-mcp">
      <label>名称<input name="name" required /></label>
      <label>命令<input name="command" placeholder="npx" /></label>
      <label>参数<input name="args" placeholder="-y,@pkg" /></label>
      <button class="primary" type="submit">添加 MCP</button>
    </form>
    ${
      state.mcp
        .map(
          (s) => `<div class="row"><div><b>${s.name}</b></div><div class="muted">${s.transport} · ${s.agents.join(',')}</div><div></div></div>`,
        )
        .join('') || '<p class="muted">尚未配置 MCP。</p>'
    }
    <button id="btn-sync-mcp">同步到各 Agent</button>
  `;
}

document.body.addEventListener('click', async (event) => {
  const t = event.target;
  if (!(t instanceof HTMLElement)) return;
  if (t.dataset.tab) {
    document.querySelectorAll('.tabs button').forEach((b) => b.classList.toggle('active', b === t));
    document.querySelectorAll('.panel').forEach((p) => p.classList.add('hidden'));
    document.querySelector(`#panel-${t.dataset.tab}`).classList.remove('hidden');
  }
  if (t.id === 'btn-init') {
    await api('/api/init', { method: 'POST', body: {} });
    await refresh();
  }
  if (t.dataset.agent) {
    await api('/api/agent', { method: 'POST', body: { agentId: t.dataset.agent } });
    await refresh();
  }
  if (t.dataset.use) {
    await api('/api/switch', { method: 'POST', body: { target: t.dataset.use } });
    await refresh();
  }
  if (t.dataset.ping) {
    const result = await api(`/api/providers/${t.dataset.ping}/ping`, { method: 'POST', body: {} });
    t.textContent = result.ok ? `OK ${result.status}` : '失败';
  }
  if (t.id === 'btn-sync-mcp') {
    await api('/api/mcp/sync', { method: 'POST', body: {} });
    t.textContent = '已同步';
  }
});

document.body.addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.target;
  if (!(form instanceof HTMLFormElement)) return;
  const data = Object.fromEntries(new FormData(form).entries());
  if (form.id === 'add-provider') {
    await api('/api/providers', { method: 'POST', body: data });
  }
  if (form.id === 'add-mcp') {
    await api('/api/mcp', {
      method: 'POST',
      body: { ...data, args: String(data.args || '').split(',').map((s) => s.trim()).filter(Boolean) },
    });
  }
  await refresh();
});

refresh().catch((err) => {
  $('#prompt').textContent = err.message;
});
