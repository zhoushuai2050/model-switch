import { LANGS, detectLang, setLang, t } from './i18n.js';

const $ = (sel) => document.querySelector(sel);
const APPS = [
  { id: 'claude', name: 'Claude' },
  { id: 'codex', name: 'Codex' },
  { id: 'grok-build', name: 'Grok Build' },
  { id: 'gemini', name: 'Gemini' },
  { id: 'opencode', name: 'OpenCode' },
];

const THEMES = [
  { id: 'midnight', color: '#3b82f6' },
  { id: 'paper', color: '#2563eb' },
  { id: 'ocean', color: '#14b8a6' },
  { id: 'plum', color: '#a78bfa' },
  { id: 'forest', color: '#34d399' },
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
  'grok-build': ['openai'],
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
  install: null,
  installing: false,
  theme: localStorage.getItem('msw-theme') || 'midnight',
  lang: detectLang(),
};

let installReq = 0;

setLang(state.lang, false);

function applyTheme(themeId, persist = true) {
  const theme = THEMES.some((item) => item.id === themeId) ? themeId : 'midnight';
  state.theme = theme;
  document.documentElement.dataset.theme = theme;
  if (persist) localStorage.setItem('msw-theme', theme);
  renderThemeOptions();
}

function applyLang(lang, persist = true) {
  state.lang = setLang(lang, persist);
  closeModal();
  closeModelModal();
  renderChrome();
  renderLangOptions();
  renderThemeOptions();
  render();
}

function renderChrome() {
  document.title = t('app.title');
  const sub = $('#brand-sub');
  if (sub) sub.textContent = t('app.subtitle');
  const mcp = $('#btn-mcp');
  if (mcp) mcp.textContent = t('nav.mcp');
  const search = $('#search');
  if (search) search.placeholder = t('search.placeholder');
  const themeLabel = $('#btn-theme-label');
  if (themeLabel) themeLabel.textContent = t('theme.label');
  const themeBtn = $('#btn-theme');
  if (themeBtn) themeBtn.title = t('theme.title');
  const themeTitle = $('#theme-menu-title');
  if (themeTitle) themeTitle.textContent = t('theme.scheme');
  const langLabel = $('#btn-lang-label');
  if (langLabel) langLabel.textContent = t('lang.label');
  const langBtn = $('#btn-lang');
  if (langBtn) langBtn.title = t('lang.title');
  const langTitle = $('#lang-menu-title');
  if (langTitle) langTitle.textContent = t('lang.scheme');
}

function renderThemeOptions() {
  const menu = $('#theme-options');
  if (!menu) return;
  menu.innerHTML = THEMES.map((theme) => `<button class="dock-option ${state.theme === theme.id ? 'active' : ''}" type="button" data-theme-id="${theme.id}">
    <span class="theme-swatch" style="--swatch:${theme.color}"></span>
    <span>${t(`theme.${theme.id}`)}</span>
    ${state.theme === theme.id ? '<span class="dock-check">✓</span>' : ''}
  </button>`).join('');
}

function renderLangOptions() {
  const menu = $('#lang-options');
  if (!menu) return;
  menu.innerHTML = LANGS.map((lang) => `<button class="dock-option ${state.lang === lang.id ? 'active' : ''}" type="button" data-lang-id="${lang.id}">
    <span>${lang.label}</span>
    ${state.lang === lang.id ? '<span class="dock-check">✓</span>' : ''}
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

function selectedModelOf(providerId) {
  const models = modelsOf(providerId);
  return models.find((item) => item.selected) || models[0];
}

function modelsFromEditor(editor) {
  return [...(editor?.querySelectorAll('.model-chip-name[data-model]') || [])]
    .map((item) => item.dataset.model)
    .filter(Boolean);
}

function selectedFromEditor(editor) {
  return editor?.querySelector('.model-chip.selected .model-chip-name')?.dataset.model
    || modelsFromEditor(editor)[0]
    || '';
}

function modelChipHtml(modelId, selected, providerId = '') {
  return `<div class="model-chip ${selected ? 'selected' : ''}">
    <button type="button" class="model-chip-name" data-model-select="${escapeHtml(providerId)}" data-model="${escapeHtml(modelId)}" title="${escapeHtml(modelId)}">
      ${escapeHtml(modelId)}${selected ? `<span class="model-chip-flag">${t('badge.current')}</span>` : ''}
    </button>
    <button type="button" class="model-chip-del" data-model-delete="${escapeHtml(providerId)}" data-model="${escapeHtml(modelId)}" title="${t('model.deleteTitle')}">×</button>
  </div>`;
}

function modelAddButton(providerId = '', compact = false) {
  return `<button type="button" class="model-chip-add ${compact ? 'icon-only' : ''}" data-open-add-model="${escapeHtml(providerId)}" title="${t('model.add')}">
    <span aria-hidden="true">+</span>${compact ? '' : `<span>${t('model.add')}</span>`}
  </button>`;
}

function setEditorModels(editor, models) {
  if (!editor) return;
  const providerId = editor.dataset.providerId || '';
  const rows = models.map((item) => (typeof item === 'string' ? { modelId: item } : item));
  const selected = rows.find((item) => item.selected)?.modelId || rows[0]?.modelId;
  const mount = editor.querySelector('.model-chips');
  if (!mount) return;
  const chips = rows.length
    ? rows.map((item) => modelChipHtml(item.modelId, item.modelId === selected, providerId)).join('')
    : `<div class="model-empty">${t('model.none')}</div>`;
  mount.innerHTML = `${chips}${modelAddButton(providerId)}`;
}

function renderModelEditor(models, opts = {}) {
  const providerId = opts.providerId || '';
  const rows = models.map((item) => (typeof item === 'string' ? { modelId: item, selected: false } : { ...item }));
  if (rows.length && !rows.some((item) => item.selected)) rows[0].selected = true;
  const chips = rows.length
    ? rows.map((item) => modelChipHtml(item.modelId, Boolean(item.selected), providerId)).join('')
    : `<div class="model-empty">${t('model.none')}</div>`;
  return `<div class="model-editor" data-provider-id="${escapeHtml(providerId)}">
    <div class="model-editor-label">${t('model.label')}</div>
    <div class="model-chips">${chips}${modelAddButton(providerId)}</div>
    <p class="form-tip">${t('model.tip')}</p>
  </div>`;
}

function addDraftModel(editor, modelId) {
  const id = String(modelId || '').trim();
  if (!id) {
    toast(t('model.needName'), true);
    return false;
  }
  const current = selectedFromEditor(editor);
  const models = modelsFromEditor(editor).map((item) => ({ modelId: item, selected: item === current }));
  if (models.some((item) => item.modelId === id)) {
    toast(t('model.exists', { name: id }), true);
    return false;
  }
  models.push({ modelId: id, selected: models.length === 0 });
  setEditorModels(editor, models);
  return true;
}

function removeDraftModel(editor, modelId) {
  const current = selectedFromEditor(editor);
  const models = modelsFromEditor(editor)
    .filter((item) => item !== modelId)
    .map((item) => ({ modelId: item, selected: item === current }));
  if (models.length && !models.some((item) => item.selected)) models[0].selected = true;
  setEditorModels(editor, models);
}

function selectDraftModel(editor, modelId) {
  setEditorModels(editor, modelsFromEditor(editor).map((item) => ({ modelId: item, selected: item === modelId })));
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

function agentUrlField(app = state.app) {
  if (app === 'claude') {
    return { name: 'anthropicUrl', protocol: 'anthropic', label: t('url.anthropic'), placeholder: 'https://api.example.com' };
  }
  if (app === 'gemini') {
    return { name: 'geminiUrl', protocol: 'gemini', label: t('url.gemini'), placeholder: 'https://generativelanguage.googleapis.com/v1beta' };
  }
  return { name: 'openaiUrl', protocol: 'openai', label: t('url.openai'), placeholder: 'https://api.example.com/v1' };
}

function presetsForApp(app = state.app) {
  const needed = protocolsForApp(app);
  return state.presets.filter((preset) => needed.some((item) => preset.protocols?.[item]?.baseUrl));
}

function protocolLine(provider) {
  return configuredProtocols(provider).map((item) => protocolUrl(provider, item)).join(' ') || t('card.noAddress');
}

function initial(name) {
  return String(name || '?').trim().slice(0, 2).toUpperCase();
}

function providerById(id) {
  return state.providers.find((item) => item.id === id);
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
  if (state.install && state.install.id !== state.app) state.install = null;
  render();
  syncOpenModelEditor();
  loadInstallInfo();
}

function syncOpenModelEditor() {
  const editor = document.querySelector('#modal .model-editor');
  const providerId = editor?.dataset.providerId;
  if (!editor || !providerId) return;
  setEditorModels(editor, modelsOf(providerId));
}

function renderSwitcher() {
  $('#app-switcher').innerHTML = APPS.map((app) => {
    const live = state.status?.agents?.find((item) => item.id === app.id);
    const extra = live?.installed ? '' : t('status.notInstalled');
    const cls = [state.app === app.id ? 'active' : '', live && !live.installed ? 'missing' : ''].filter(Boolean).join(' ');
    return `<button type="button" data-app="${app.id}" class="${cls}" title="${app.name}${extra ? ` (${extra})` : ''}">
      <span class="glyph ${app.id}">${app.name.slice(0, 1)}</span>${app.name}
    </button>`;
  }).join('');
}

function renderStatus() {
  const live = agent();
  const info = installInfo();
  const on = Boolean(live?.installed && live?.configured);
  const available = state.providers.filter((item) => supportsAgent(item)).length;
  $('#status-chip').innerHTML = `<span class="dot ${on ? 'on' : 'off'}"></span>
    <b>${live?.name || appName()}</b>
    <span>${live?.model || t('status.unconfigured')}</span>
    <span>${live?.providerLabel || live?.bin || (live?.installed ? t('status.installed') : t('status.notInstalled'))}</span>
    ${info?.version ? `<span>${escapeHtml(info.version)}</span>` : ''}
    <span>${t('status.available', { n: available })}</span>`;
  const configLabel = $('#btn-config-label');
  if (configLabel) configLabel.textContent = t('nav.viewConfigApp', { app: appName() });
  const configButton = $('#btn-agent-config');
  if (configButton) configButton.title = t('nav.viewConfigApp', { app: appName() });
  const addLabel = $('#btn-add-label');
  if (addLabel) addLabel.textContent = t('nav.addProviderApp', { app: appName() });
  renderInstallAction();
}

function installInfo() {
  if (state.install && state.install.id === state.app) return state.install;
  const live = agent();
  if (live && !live.installed) {
    return { id: state.app, name: live.name || appName(), installed: false, action: 'install' };
  }
  return null;
}

function installButtonHtml(info) {
  if (state.installing) {
    return `<button class="btn" data-agent-install type="button" disabled>${t('agent.working')}</button>`;
  }
  if (!info || info.action === 'none') return '';
  const primary = info.action === 'install' ? ' primary' : '';
  const label = info.action === 'install'
    ? (info.latest ? t('agent.installVersion', { app: appName(), version: info.latest }) : t('agent.install', { app: appName() }))
    : t('agent.updateTo', { version: info.latest });
  const icon = info.action === 'install'
    ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 4v10m0 0 4-4m-4 4-4-4M5 18h14" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>'
    : '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M20 12a8 8 0 1 1-2.2-5.4M20 5v5h-5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  return `<button class="btn${primary}" data-agent-install type="button">${icon}<span>${label}</span></button>`;
}

function renderInstallAction() {
  const host = $('#agent-install-action');
  const banner = $('#agent-install-banner');
  const info = installInfo();
  const onProviders = state.view === 'providers';
  if (host) host.innerHTML = onProviders ? installButtonHtml(info) : '';
  if (!banner) return;
  if (!onProviders || !info || (info.action === 'none' && !state.installing)) {
    banner.classList.add('hidden');
    banner.innerHTML = '';
    return;
  }
  const updating = info.action === 'update';
  const title = updating
    ? t('agent.needUpdateTitle', { app: appName() })
    : t('agent.needInstallTitle', { app: appName() });
  const detail = updating
    ? t('agent.needUpdateDetail', { version: info.version || '?', latest: info.latest || '?' })
    : t('agent.needInstallDetail', { app: appName() });
  banner.classList.remove('hidden');
  banner.innerHTML = `<div class="install-banner${updating ? ' update' : ''}">
    <div>
      <strong>${title}</strong>
      <p>${detail}</p>
    </div>
    ${installButtonHtml(info)}
  </div>`;
}

async function loadInstallInfo() {
  const req = ++installReq;
  const app = state.app;
  try {
    const info = await api(`/api/agents/${encodeURIComponent(app)}/install`);
    if (req !== installReq || state.app !== app) return;
    state.install = info;
    renderStatus();
  } catch (error) {
    if (req !== installReq || state.app !== app) return;
    if (!agent()?.installed) return;
    toast(error.message || String(error), true);
  }
}

async function openInstallModal() {
  if (state.installing) return;
  const info = installInfo();
  if (!info || info.action === 'none') return;
  const updating = info.action === 'update';
  state.installing = true;
  renderInstallAction();
  $('#modal').classList.remove('hidden');
  $('#modal').innerHTML = `<div class="dialog install-dialog">
    <h2>${updating ? t('agent.updateTitle', { app: appName() }) : t('agent.installTitle', { app: appName() })}</h2>
    <div class="probe" id="probe-list"><div class="probe-step running"><span class="probe-mark"></span><div><div class="probe-title">${updating ? t('agent.updateStart') : t('agent.installStart')}</div></div></div></div>
    <div class="dialog-actions">
      <button class="btn" type="button" id="btn-cancel">${t('action.close')}</button>
    </div>
  </div>`;
  const list = $('#probe-list');
  const steps = new Map();
  try {
    const res = await fetch(`/api/agents/${encodeURIComponent(state.app)}/install`, { method: 'POST' });
    if (!res.ok) {
      const data = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(data.error || res.statusText);
    }
    if (!res.body) throw new Error(updating ? t('agent.updateFail') : t('agent.installFail'));
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
        if (list) list.innerHTML = renderProbe(steps);
      }
    }
    if (buf.trim()) {
      const step = JSON.parse(buf);
      steps.set(step.id, step);
      if (list) list.innerHTML = renderProbe(steps);
    }
    const summary = [...steps.values()].find((item) => item.id === 'summary');
    const failed = summary?.status === 'fail';
    toast(
      summary?.title || (failed
        ? (updating ? t('agent.updateFail') : t('agent.installFail'))
        : (updating ? t('agent.updateDone', { app: appName() }) : t('agent.installDone', { app: appName() }))),
      failed,
    );
  } finally {
    state.installing = false;
    await refresh().catch((error) => toast(error.message || String(error), true));
  }
}

function renderCardModels(provider) {
  const models = modelsOf(provider.id);
  const current = models.find((item) => item.selected) || models[0];
  const chips = models.length
    ? models.map((item) => modelChipHtml(item.modelId, Boolean(item.selected), provider.id)).join('')
    : `<div class="model-empty">${t('model.none')}</div>`;
  return `<div class="card-models">
    <div class="current-model">
      <span class="current-model-label">${t('model.current')}</span>
      <strong class="current-model-name">${current ? escapeHtml(current.modelId) : t('model.none')}</strong>
    </div>
    <div class="model-chips">${chips}${modelAddButton(provider.id, true)}</div>
  </div>`;
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
    const empty = !scoped.length && !q
      ? { title: t('empty.noProviders', { app: appName() }), detail: t('empty.noProvidersDetail', { app: appName() }) }
      : { title: t('empty.noMatch'), detail: t('empty.noMatchDetail') };
    $('#view-providers').innerHTML = `<div class="empty">
      <h3>${empty.title}</h3>
      <p>${empty.detail}</p>
      <button class="btn primary" id="btn-add-empty" type="button">${t('nav.addProviderApp', { app: appName() })}</button>
    </div>`;
    return;
  }
  $('#view-providers').innerHTML = `<div class="cards">${list.map((provider) => {
    const current = isCurrentProvider(provider);
    const protocol = agentProtocol(provider);
    const url = agentUrl(provider);
    const tags = configuredProtocols(provider).map((item) => {
      const active = protocolsForApp().includes(item);
      return `<span class="tag ${item}${active ? '' : ' dim'}">${PROTOCOL_LABELS[item]}</span>`;
    }).join('');
    return `<article class="card ${current ? 'current' : ''}">
      <div class="card-head">
        <div class="icon-box ${protocol || ''}">${initial(provider.name)}</div>
        <div class="card-title">
          <h3>
            <span class="card-name">${escapeHtml(provider.name)}</span>
            ${current ? `<span class="badge">${t('badge.current')}</span>` : ''}
            ${provider.apiKey ? '' : `<span class="badge warn">${t('badge.noKey')}</span>`}
          </h3>
          <div class="card-sub">
            <div class="tags">${tags}</div>
            ${provider.apiKey ? `<span class="key-pill" title="${t('badge.hasKey')}">KEY</span>` : ''}
          </div>
        </div>
      </div>
      ${renderCardModels(provider)}
      <div class="meta url" title="${escapeHtml(url || '')}">${escapeHtml(protocol ? PROTOCOL_LABELS[protocol] : agentNeedLabel())} · ${escapeHtml(url || t('card.noUrl'))}</div>
      <div class="card-actions">
        <button class="btn sm ghost" data-edit="${provider.id}" type="button">${t('action.edit')}</button>
        <button class="btn sm ghost" data-ping="${provider.id}" type="button">${t('action.ping')}</button>
        <button class="btn sm danger" data-del="${provider.id}" type="button">${t('action.delete')}</button>
        <button class="btn sm ${current ? 'success' : 'primary'}" data-use="${provider.id}" type="button">${current ? t('action.inUse') : t('action.enable')}</button>
      </div>
    </article>`;
  }).join('')}</div>`;
}

function renderMcp() {
  $('#view-mcp').innerHTML = `
    <form class="form-grid" id="add-mcp">
      <label class="field">${t('mcp.name')}<input name="name" required placeholder="filesystem" /></label>
      <label class="field">${t('mcp.command')}<input name="command" placeholder="npx" /></label>
      <label class="field">${t('mcp.args')}<input name="args" placeholder="-y,@modelcontextprotocol/server-filesystem" /></label>
      <label class="field">&nbsp;<button class="btn primary" type="submit">${t('mcp.add')}</button></label>
    </form>
    ${state.mcp.map((server) => `<div class="row"><div><b>${escapeHtml(server.name)}</b><div class="muted">${server.transport} · ${(server.agents || []).join(',') || t('mcp.all')}</div></div></div>`).join('') || `<div class="empty"><h3>${t('mcp.empty')}</h3></div>`}
    <button class="btn" id="btn-sync-mcp" type="button">${t('mcp.sync')}</button>
  `;
}

function render() {
  if (state.view !== 'providers' && state.view !== 'mcp') state.view = 'providers';
  renderChrome();
  renderSwitcher();
  renderStatus();
  document.querySelectorAll('[data-view]').forEach((btn) => btn.classList.toggle('primary', false));
  const activeViewBtn = document.querySelector(`[data-view="${state.view}"]`);
  if (activeViewBtn) activeViewBtn.classList.add('primary');
  $('#view-providers').classList.toggle('hidden', state.view !== 'providers');
  $('#view-mcp').classList.toggle('hidden', state.view !== 'mcp');
  if (state.view === 'providers') renderProviders();
  if (state.view === 'mcp') renderMcp();
  renderInstallAction();
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}

function closeModal() {
  $('#modal').classList.add('hidden');
  $('#modal').innerHTML = '';
}

function closeModelModal() {
  const el = $('#model-modal');
  if (!el) return;
  el.classList.add('hidden');
  el.innerHTML = '';
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

function openAddModelModal(providerId = '') {
  const provider = providerId ? providerById(providerId) : null;
  const draftName = $('#add-provider [name=name]')?.value?.trim();
  const name = provider?.name || draftName || '';
  const modal = $('#model-modal');
  modal.classList.remove('hidden');
  modal.innerHTML = `<div class="dialog add-model-dialog">
    <h2>${t('model.addTitle')}</h2>
    <p class="form-tip">${name ? t('model.addFor', { name }) : t('model.addHint')}</p>
    <form id="add-model-form" data-provider-id="${escapeHtml(providerId)}">
      <label class="field">${t('model.name')}
        <input name="modelId" required placeholder="${t('model.placeholder')}" autocomplete="off" />
      </label>
      <div class="dialog-actions">
        <button class="btn" type="button" id="btn-cancel-model">${t('action.cancel')}</button>
        <button class="btn primary" type="submit">${t('model.add')}</button>
      </div>
    </form>
  </div>`;
  modal.querySelector('input[name=modelId]')?.focus();
}

async function openPingModal(providerId) {
  const provider = providerById(providerId);
  const current = selectedModelOf(providerId)?.modelId;
  $('#modal').classList.remove('hidden');
  $('#modal').innerHTML = `<div class="dialog">
    <h2>${t('ping.title', { name: provider?.name || providerId, app: appName() })}${current ? ` · ${escapeHtml(current)}` : ''}</h2>
    <div class="probe" id="probe-list"><div class="probe-step running"><span class="probe-mark"></span><div><div class="probe-title">${t('ping.start')}</div></div></div></div>
    <div class="dialog-actions">
      <button class="btn" type="button" id="btn-cancel">${t('action.close')}</button>
    </div>
  </div>`;
  const list = $('#probe-list');
  const steps = new Map();
  const res = await fetch(`/api/providers/${encodeURIComponent(providerId)}/ping?agent=${encodeURIComponent(state.app)}`, { method: 'POST' });
  if (!res.ok) {
    const data = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(data.error || res.statusText);
  }
  if (!res.body) throw new Error(t('ping.empty'));
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
      if (list) list.innerHTML = renderProbe(steps);
    }
  }
  if (buf.trim()) {
    const step = JSON.parse(buf);
    steps.set(step.id, step);
    if (list) list.innerHTML = renderProbe(steps);
  }
  const summary = [...steps.values()].find((item) => item.id === 'summary');
  if (summary) toast(summary.title || (summary.status === 'fail' ? t('ping.fail') : t('ping.done')), summary.status === 'fail');
}

function protocolOf(provider, name) {
  return provider?.protocols?.[name]?.baseUrl || '';
}

async function openAgentConfigModal() {
  const agentId = state.app;
  $('#modal').classList.remove('hidden');
  $('#modal').innerHTML = `<div class="dialog config-dialog">
    <h2>${t('config.loadingTitle', { app: appName(agentId) })}</h2>
    <div class="config-loading">${t('config.loading')}</div>
  </div>`;
  try {
    const config = await api(`/api/agents/${encodeURIComponent(agentId)}/config`);
    $('#modal').innerHTML = `<div class="dialog config-dialog">
      <div class="config-heading">
        <div>
          <h2>${t('config.editTitle', { name: config.agentName })}</h2>
          <div class="meta config-path">${escapeHtml(config.path)}</div>
        </div>
        <span class="config-state ${config.exists ? 'exists' : 'missing'}">${config.exists ? t('config.exists') : t('config.missing')}</span>
      </div>
      <p class="config-tip">${t('config.tip', { name: config.agentName })}</p>
      <form id="agent-config-form" data-agent="${escapeHtml(config.agentId)}">
        <textarea name="content" class="config-editor" spellcheck="false">${escapeHtml(config.content)}</textarea>
        <div class="dialog-actions">
          <button class="btn" type="button" id="btn-cancel">${t('action.cancel')}</button>
          <button class="btn primary" type="submit">${t('config.save')}</button>
        </div>
      </form>
    </div>`;
  } catch (error) {
    closeModal();
    toast(error.message || String(error), true);
  }
}

function presetFieldValues(presetId) {
  const preset = presetId && presetId !== 'custom'
    ? state.presets.find((item) => item.id === presetId)
    : null;
  return {
    name: preset?.name || '',
    openaiUrl: preset?.protocols?.openai?.baseUrl || '',
    anthropicUrl: preset?.protocols?.anthropic?.baseUrl || '',
    geminiUrl: preset?.protocols?.gemini?.baseUrl || '',
    models: (preset?.models || []).map((item, index) => ({ modelId: item.modelId, selected: index === 0 })),
  };
}

function markDefaultField(input, value, overwrite) {
  if (!(input instanceof HTMLInputElement)) return;
  const next = value || '';
  input.dataset.default = next;
  if (overwrite || input.classList.contains('is-default') || !input.value) {
    input.value = next;
  }
  syncProviderFieldTone(input);
}

function syncProviderFieldTone(input) {
  if (!(input instanceof HTMLInputElement) || input.disabled || input.name === 'apiKey') {
    input?.classList.remove('is-default');
    return;
  }
  const isDefault = Boolean(input.dataset.default) && input.value === input.dataset.default;
  input.classList.toggle('is-default', isDefault);
}

function fillPresetFields(form, presetId, overwrite = true) {
  if (!form) return;
  const values = presetFieldValues(presetId);
  for (const [name, value] of Object.entries(values)) {
    if (name === 'models') continue;
    markDefaultField(form.querySelector(`[name="${name}"]`), value, overwrite);
  }
  const editor = form.querySelector('.model-editor');
  if (editor && (overwrite || !modelsFromEditor(editor).length)) {
    setEditorModels(editor, values.models || []);
  }
}

async function openProviderModal(providerId) {
  const urlField = agentUrlField();
  const presets = [{ id: 'custom', name: t('provider.custom') }, ...presetsForApp()];
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
    <h2>${editing ? t('provider.editTitle', { app: appName() }) : t('provider.addTitle', { app: appName() })}</h2>
    <form class="provider-form" id="${editing ? 'edit-provider' : 'add-provider'}" data-id="${editing ? escapeHtml(provider.id) : ''}">
      <div class="form-grid">
        ${editing ? `<label class="field">ID<input value="${escapeHtml(provider.id)}" disabled /></label>` : `<label class="field">${t('provider.type')}
          <select name="preset">${presets.map((item) => `<option value="${item.id}">${escapeHtml(item.name)}</option>`).join('')}</select>
        </label>`}
        <label class="field">${t('provider.name')}<input name="name" value="${escapeHtml(provider?.name || '')}" placeholder="${t('provider.namePlaceholder')}" autocomplete="off" /></label>
        <label class="field">API Key
          <span class="key-row">
            <input name="apiKey" type="password" value="${escapeHtml(provider?.apiKey || '')}" placeholder="${editing ? t('provider.keySaved') : 'sk-...'}" autocomplete="off" />
            <button class="btn sm" type="button" id="btn-toggle-key">${t('action.show')}</button>
          </span>
        </label>
        <label class="field">${escapeHtml(urlField.label)}<input name="${urlField.name}" value="${escapeHtml(protocolOf(provider, urlField.protocol))}" placeholder="${escapeHtml(urlField.placeholder)}" autocomplete="off" /></label>
      </div>
      ${renderModelEditor(models, { providerId: editing ? provider.id : '' })}
      ${editing ? '' : `<p class="form-tip">${t('provider.tip', { app: appName() })}</p>`}
      <div class="dialog-actions">
        ${editing ? `<button class="btn" type="button" data-ping="${escapeHtml(provider.id)}">${t('action.ping')}</button>` : ''}
        <button class="btn" type="button" id="btn-cancel">${t('action.cancel')}</button>
        <button class="btn primary" type="submit">${editing ? t('action.save') : t('action.add')}</button>
      </div>
    </form>
  </div>`;
  const form = $('#add-provider, #edit-provider');
  if (!editing) fillPresetFields(form, form.querySelector('[name=preset]')?.value || 'custom', true);
}

applyTheme(state.theme, false);
renderChrome();
renderLangOptions();
renderThemeOptions();

async function run(action, success) {
  try {
    await action();
    if (success) toast(success);
    await refresh();
  } catch (error) {
    toast(error.message || String(error), true);
  }
}

function closeDockMenus(except) {
  for (const id of ['theme-menu', 'lang-menu']) {
    if (except && id === except) continue;
    $(`#${id}`)?.classList.add('hidden');
  }
  $('#btn-theme')?.setAttribute('aria-expanded', 'false');
  $('#btn-lang')?.setAttribute('aria-expanded', 'false');
}

document.body.addEventListener('change', (event) => {
  const target = event.target;
  if (!(target instanceof HTMLSelectElement) || target.name !== 'preset') return;
  if (target.form?.id !== 'add-provider') return;
  fillPresetFields(target.form, target.value, false);
});

document.body.addEventListener('input', (event) => {
  const target = event.target;
  if (!(target instanceof HTMLInputElement)) return;
  if (target.form?.id !== 'add-provider' && target.form?.id !== 'edit-provider') return;
  syncProviderFieldTone(target);
});

document.body.addEventListener('click', async (event) => {
  const target = event.target.closest('button, [data-app], [data-view]');
  if (!target) {
    if (event.target.id === 'modal' && !$('#add-provider, #edit-provider, #agent-config-form, .config-dialog, .install-dialog')) closeModal();
    if (event.target.id === 'model-modal') closeModelModal();
    if (!event.target.closest('#dock')) closeDockMenus();
    return;
  }
  if (target.dataset.themeId) {
    applyTheme(target.dataset.themeId);
    closeDockMenus();
    toast(t('theme.switched', { name: t(`theme.${state.theme}`) }));
    return;
  }
  if (target.dataset.langId) {
    applyLang(target.dataset.langId);
    closeDockMenus();
    return;
  }
  if (target.id === 'btn-theme') {
    const menu = $('#theme-menu');
    const open = menu.classList.contains('hidden');
    closeDockMenus();
    menu.classList.toggle('hidden', !open);
    target.setAttribute('aria-expanded', String(open));
    return;
  }
  if (target.id === 'btn-lang') {
    const menu = $('#lang-menu');
    const open = menu.classList.contains('hidden');
    closeDockMenus();
    menu.classList.toggle('hidden', !open);
    target.setAttribute('aria-expanded', String(open));
    return;
  }
  if (target.id === 'btn-agent-config') {
    openAgentConfigModal().catch((error) => toast(error.message || String(error), true));
    return;
  }
  if (target.closest('[data-agent-install]')) {
    openInstallModal().catch((error) => toast(error.message || String(error), true));
    return;
  }
  if (target.dataset.app) {
    state.app = target.dataset.app;
    localStorage.setItem('msw-app', state.app);
    state.view = 'providers';
    state.install = null;
    try {
      await api('/api/agent', { method: 'POST', body: { agentId: state.app } });
    } catch (error) {
      toast(error.message || String(error), true);
    }
    await refresh().catch((error) => toast(error.message || String(error), true));
    return;
  }
  if (target.dataset.view) {
    state.view = target.dataset.view;
    render();
    return;
  }
  if (target.hasAttribute('data-open-add-model')) {
    openAddModelModal(target.getAttribute('data-open-add-model') || '');
    return;
  }
  if (target.hasAttribute('data-model-delete')) {
    const editor = target.closest('.model-editor') || target.closest('.card-models');
    const providerId = target.getAttribute('data-model-delete') || editor?.dataset.providerId;
    const modelId = target.dataset.model;
    if (providerId) {
      if (!confirm(t('model.deleteConfirm', { name: modelId }))) return;
      run(() => api(`/api/providers/${encodeURIComponent(providerId)}/models/${encodeURIComponent(modelId)}`, { method: 'DELETE' }), t('model.deleted', { name: modelId }));
    } else {
      removeDraftModel($('#modal .model-editor'), modelId);
    }
    return;
  }
  if (target.hasAttribute('data-model-select')) {
    const editor = target.closest('.model-editor');
    const providerId = target.getAttribute('data-model-select') || editor?.dataset.providerId;
    const modelId = target.dataset.model;
    if (!providerId) {
      selectDraftModel(editor || $('#modal .model-editor'), modelId);
      return;
    }
    run(async () => {
      const result = await api(`/api/providers/${encodeURIComponent(providerId)}/models/${encodeURIComponent(modelId)}/select`, {
        method: 'POST',
        body: { agent: state.app },
      });
      toast(result.applied ? t('model.switched', { name: modelId }) : t('model.selected', { name: modelId }));
    });
    return;
  }
  if (target.id === 'btn-add' || target.id === 'btn-add-empty') {
    openProviderModal().catch((error) => toast(error.message || String(error), true));
    return;
  }
  if (target.id === 'btn-toggle-key') {
    const input = target.parentElement.querySelector('input');
    if (input) {
      input.type = input.type === 'password' ? 'text' : 'password';
      target.textContent = input.type === 'password' ? t('action.show') : t('action.hide');
    }
    return;
  }
  if (target.dataset.edit) {
    openProviderModal(target.dataset.edit).catch((error) => toast(error.message || String(error), true));
    return;
  }
  if (target.id === 'btn-cancel') {
    closeModal();
    return;
  }
  if (target.id === 'btn-cancel-model') {
    closeModelModal();
    return;
  }
  if (target.dataset.use) {
    await run(() => api('/api/switch', { method: 'POST', body: { target: target.dataset.use, agent: state.app } }), t('provider.switched'));
    return;
  }
  if (target.dataset.ping) {
    openPingModal(target.dataset.ping).catch((error) => toast(error.message || String(error), true));
    return;
  }
  if (target.dataset.del) {
    const provider = providerById(target.dataset.del);
    if (!confirm(t('provider.deleteConfirm', { name: provider?.name || target.dataset.del }))) return;
    await run(() => api(`/api/providers/${target.dataset.del}`, { method: 'DELETE' }), t('provider.deleted'));
    return;
  }
  if (target.id === 'btn-sync-mcp') {
    await run(() => api('/api/mcp/sync', { method: 'POST', body: {} }), t('mcp.synced'));
  }
});

document.body.addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.target;
  if (!(form instanceof HTMLFormElement)) return;
  const data = Object.fromEntries(new FormData(form).entries());
  try {
    if (form.id === 'add-model-form') {
      const modelId = String(data.modelId || '').trim();
      const providerId = form.dataset.providerId || '';
      if (!modelId) {
        toast(t('model.needName'), true);
        return;
      }
      if (providerId) {
        await api(`/api/providers/${encodeURIComponent(providerId)}/models`, { method: 'POST', body: { modelId } });
        toast(t('model.added', { name: modelId }));
        closeModelModal();
        await refresh();
        return;
      }
      if (addDraftModel($('#modal .model-editor'), modelId)) {
        toast(t('model.added', { name: modelId }));
        closeModelModal();
      }
      return;
    }
    if (form.id === 'agent-config-form') {
      await api(`/api/agents/${encodeURIComponent(form.dataset.agent)}/config`, {
        method: 'PUT',
        body: { content: String(data.content || '') },
      });
      closeModal();
      toast(t('config.saved'));
      await refresh();
      return;
    }
    if (form.id === 'add-provider' || form.id === 'edit-provider') {
      const editor = form.querySelector('.model-editor');
      const body = {
        preset: data.preset === 'custom' ? undefined : data.preset,
        name: data.name || undefined,
        apiKey: data.apiKey || undefined,
        agent: state.app,
        openaiUrl: data.openaiUrl || undefined,
        anthropicUrl: data.anthropicUrl || undefined,
        geminiUrl: data.geminiUrl || undefined,
      };
      if (form.id === 'add-provider') {
        body.models = modelsFromEditor(editor);
        body.defaultModel = selectedFromEditor(editor) || undefined;
        if (!body.models.length) delete body.models;
        await api('/api/providers', { method: 'POST', body });
        toast(t('provider.added'));
      } else {
        await api(`/api/providers/${encodeURIComponent(form.dataset.id)}`, { method: 'PUT', body });
        toast(t('provider.updated'));
      }
      closeModal();
    }
    if (form.id === 'add-mcp') {
      await api('/api/mcp', {
        method: 'POST',
        body: { ...data, args: String(data.args || '').split(',').map((item) => item.trim()).filter(Boolean) },
      });
      toast(t('mcp.added'));
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
