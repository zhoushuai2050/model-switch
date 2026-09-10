import { execSync } from 'node:child_process';
import { engine, protocolLabel, protocolsForAgent } from '../core/engine.ts';
import type { AgentId, AgentLiveStatus, ModelRow, Provider } from '../core/types.ts';

type Col = 0 | 1;
const ANSI = /\x1b\[[0-9;]*m/g;

const t = {
  reset: '\x1b[0m',
  accent: (s: string) => `\x1b[38;5;75m${s}\x1b[0m`,
  accentBold: (s: string) => `\x1b[1;38;5;75m${s}\x1b[0m`,
  text: (s: string) => `\x1b[38;5;252m${s}\x1b[0m`,
  muted: (s: string) => `\x1b[38;5;245m${s}\x1b[0m`,
  faint: (s: string) => `\x1b[38;5;240m${s}\x1b[0m`,
  green: (s: string) => `\x1b[38;5;114m${s}\x1b[0m`,
  greenBold: (s: string) => `\x1b[1;38;5;114m${s}\x1b[0m`,
  red: (s: string) => `\x1b[38;5;203m${s}\x1b[0m`,
};

export async function runTui(): Promise<void> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    const status = engine.status();
    console.log(`${status.current?.id || 'none'}/${status.current?.model || '-'}`);
    return;
  }

  const agents = () => engine.listAgents();
  let col: Col = 0;
  let agentIndex = Math.max(0, agents().findIndex((item) => item.id === engine.status().state.currentAgent));
  let providerIndex = 0;
  let modelIndex = 0;
  let message = '';
  let messageOk = true;

  let restored = false;
  const restore = () => {
    if (restored) return;
    restored = true;
    process.stdin.removeAllListeners('data');
    process.stdout.removeAllListeners('resize');
    try {
      if (process.stdin.isTTY) process.stdin.setRawMode(false);
    } catch {}
    try {
      process.stdin.pause();
    } catch {}
    try {
      process.stdout.write('\x1b[?25h\x1b[?1049l\x1b[0m');
    } catch {}
    try {
      execSync('stty sane < /dev/tty', { stdio: 'ignore' });
    } catch {}
  };
  const quit = (code = 0) => {
    restore();
    process.exit(code);
  };
  const toast = (text: string, ok = true) => {
    message = text;
    messageOk = ok;
  };

  process.stdout.write('\x1b[?1049h\x1b[?25l');
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.setEncoding('utf8');

  process.on('SIGINT', () => quit(0));
  process.on('SIGTERM', () => quit(0));
  process.on('exit', restore);

  const selectedAgent = (): AgentLiveStatus => {
    const list = agents();
    return list[Math.min(agentIndex, Math.max(0, list.length - 1))] || list[0];
  };

  const providersOf = (): Provider[] => {
    const agent = selectedAgent();
    return agent ? engine.listProvidersForAgent(agent.id) : [];
  };

  const modelsOf = (provider?: Provider): ModelRow[] => {
    if (!provider) return [];
    return engine.listModels().filter((item) => item.providerId === provider.id);
  };

  const syncIndexes = (keepProvider = false) => {
    const status = engine.status();
    const live = status.agents.find((item) => item.id === selectedAgent()?.id);
    const providers = providersOf();
    if (!keepProvider) {
      const current = providers.findIndex((item) => isCurrentProvider(item, live));
      providerIndex = current >= 0 ? current : 0;
    }
    if (providerIndex >= providers.length) providerIndex = Math.max(0, providers.length - 1);
    const models = modelsOf(providers[providerIndex]);
    const currentModel = models.findIndex((item) => item.modelId === live?.model);
    modelIndex = currentModel >= 0 ? currentModel : 0;
    if (modelIndex >= models.length) modelIndex = Math.max(0, models.length - 1);
  };

  syncIndexes();

  const render = () => {
    const status = engine.status();
    const agentList = agents();
    if (agentIndex >= agentList.length) agentIndex = 0;
    const agent = selectedAgent();
    const providers = providersOf();
    if (providerIndex >= providers.length) providerIndex = Math.max(0, providers.length - 1);
    const provider = providers[providerIndex];
    const models = modelsOf(provider);
    if (modelIndex >= models.length) modelIndex = Math.max(0, models.length - 1);
    const live = status.agents.find((item) => item.id === agent?.id);
    const lines = buildScreen({
      agents: agentList,
      agentIndex,
      providers,
      providerIndex,
      models,
      modelIndex,
      col,
      live,
      currentAgent: status.state.currentAgent,
      message,
      messageOk,
    });
    process.stdout.write('\x1b[H\x1b[J' + lines.join('\n'));
  };

  const selectAgent = (index: number) => {
    const list = agents();
    if (!list.length) return;
    agentIndex = (index + list.length) % list.length;
    const agent = list[agentIndex];
    engine.setAgent(agent.id);
    col = 0;
    syncIndexes();
    toast(`已切换到 ${agent.name}`);
  };

  render();

  await new Promise<void>(() => {
    process.stdin.on('data', (chunk: string) => {
      const key = String(chunk);
      if (key === '\u0003' || key === 'q' || key === 'Q') {
        quit(0);
        return;
      }
      if (key === '\u001b[D' || key === 'h') {
        selectAgent(agentIndex - 1);
      } else if (key === '\u001b[C' || key === 'l') {
        selectAgent(agentIndex + 1);
      } else if (key >= '1' && key <= '4') {
        selectAgent(Number(key) - 1);
      } else if (key === '\t') {
        const providers = providersOf();
        col = col === 0 && modelsOf(providers[providerIndex]).length ? 1 : 0;
      } else if (key === '\u001b[A' || key === 'k') {
        if (col === 0) {
          providerIndex = Math.max(0, providerIndex - 1);
          syncIndexes(true);
        } else {
          modelIndex = Math.max(0, modelIndex - 1);
        }
      } else if (key === '\u001b[B' || key === 'j') {
        if (col === 0) {
          providerIndex = Math.min(Math.max(0, providersOf().length - 1), providerIndex + 1);
          syncIndexes(true);
        } else {
          const count = modelsOf(providersOf()[providerIndex]).length;
          modelIndex = Math.min(Math.max(0, count - 1), modelIndex + 1);
        }
      } else if (key === '\r' || key === '\n') {
        try {
          const agent = selectedAgent();
          const providers = providersOf();
          const provider = providers[providerIndex];
          const models = modelsOf(provider);
          const model = models[modelIndex];
          if (!agent) {
            toast('没有可选 Agent', false);
          } else if (!provider) {
            const need = protocolsForAgent(agent.id).map(protocolLabel).join(' / ');
            toast(`当前 ${agent.name} 没有可用供应商，请添加只给 ${agent.name} 用的供应商`, false);
          } else if (col === 1 && model) {
            const result = engine.setModel(model.id, { agent: agent.id });
            toast(`已启用  ${provider.name}  ·  ${result.model || model.modelId}`);
            syncIndexes(true);
          } else {
            const result = engine.use(provider.id, { agent: agent.id });
            toast(`已启用  ${provider.name}  ·  ${result.model || models[0]?.modelId || ''}`);
            syncIndexes(true);
          }
        } catch (error) {
          toast(error instanceof Error ? error.message : String(error), false);
        }
      } else if (key === 'r') {
        restore();
        const spec = engine.launch();
        engine.spawn(spec);
        return;
      }
      render();
    });
    process.stdout.on('resize', render);
  });
}

function buildScreen(opts: {
  agents: AgentLiveStatus[];
  agentIndex: number;
  providers: Provider[];
  providerIndex: number;
  models: ModelRow[];
  modelIndex: number;
  col: Col;
  live?: AgentLiveStatus;
  currentAgent?: AgentId;
  message: string;
  messageOk: boolean;
}): string[] {
  const width = Math.max(68, Math.min(120, process.stdout.columns || 80));
  const height = Math.max(18, process.stdout.rows || 24);
  const agent = opts.agents[opts.agentIndex];
  const provider = opts.providers[opts.providerIndex];
  const need = agent ? protocolsForAgent(agent.id).map(protocolLabel).join(' / ') : '';
  const currentProvider = opts.providers.find((item) => isCurrentProvider(item, opts.live));
  const lines: string[] = [];

  lines.push(frameTop('Model Switch', width, true));
  lines.push(frameRow(width, `${t.accentBold(' 本机 Agent 切换台')}${t.faint('  ·  与管理台同一数据源')}`));
  lines.push(frameRow(width, buildAgentBar(opts.agents, opts.agentIndex, opts.currentAgent, width - 2)));
  lines.push(frameBottom(width));
  lines.push('');

  const gap = 1;
  const leftW = Math.max(32, Math.min(48, Math.floor((width - gap) * 0.56)));
  const rightW = Math.max(24, width - gap - leftW);
  const listH = Math.max(6, height - 11);
  const leftTitle = opts.col === 0
    ? `供应商  ${opts.providers.length}  ·  ${need || '全部'}`
    : `供应商  ${opts.providers.length}`;
  const rightTitle = opts.col === 1
    ? `模型  ${opts.models.length}`
    : `模型  ${opts.models.length}`;

  const leftHead = frameTop(leftTitle, leftW, opts.col === 0);
  const rightHead = frameTop(rightTitle, rightW, opts.col === 1);
  lines.push(leftHead + ' '.repeat(gap) + rightHead);

  const leftView = windowed(opts.providers, opts.providerIndex, listH);
  const rightView = windowed(opts.models, opts.modelIndex, listH);
  for (let i = 0; i < listH; i++) {
    const providerRow = opts.providers.length
      ? (leftView.items[i]
        ? formatProvider(leftView.items[i], opts.live, opts.col === 0 && leftView.items[i] === opts.providers[opts.providerIndex], leftW - 2)
        : '')
      : i === 1
        ? t.muted(`  没有适合 ${agent?.name || '当前 Agent'} 的供应商`)
        : i === 2
          ? t.faint(`  添加 ${agent?.name || "当前 Agent"} 供应商`)
          : '';
    const modelRow = opts.models.length
      ? (rightView.items[i]
        ? formatModel(rightView.items[i], opts.live, opts.col === 1 && rightView.items[i] === opts.models[opts.modelIndex], rightW - 2)
        : '')
      : i === 1
        ? t.muted('  选择左侧供应商查看模型')
        : '';
    lines.push(
      frameRow(leftW, providerRow) + ' '.repeat(gap) + frameRow(rightW, modelRow),
    );
  }

  const leftFoot = provider
    ? trunc(` ${provider.name}  ${agentUrl(provider, agent?.id) || '未配置当前 Agent 地址'}`, leftW - 2)
    : '';
  const rightFoot = opts.models.length > listH
    ? t.faint(` ${opts.modelIndex + 1}/${opts.models.length}`)
    : opts.providers.length > listH
      ? t.faint(` ${opts.providerIndex + 1}/${opts.providers.length}`)
      : '';
  lines.push(frameBottom(leftW, leftFoot) + ' '.repeat(gap) + frameBottom(rightW, rightFoot));
  lines.push('');

  lines.push(buildNotice(opts.message, opts.messageOk, formatAgentStatus(opts.live, currentProvider)));
  lines.push(`  ${hint('←/→', 'Agent')}  ${hint('↑/↓', '选择')}  ${hint('Tab', '切栏')}  ${hint('Enter', '启用')}  ${hint('r', '启动')}  ${hint('q', '退出')}`);
  return lines;
}

function buildNotice(message: string, ok: boolean, status: string): string {
  if (message.startsWith('已切换到')) {
    const head = ok ? t.greenBold(`✓  ${message}`) : t.red(`!  ${message}`);
    return `  ${head}${t.faint('  ·  ')}${status}`;
  }
  if (message) {
    return ok ? t.greenBold(`  ✓  ${message}`) : t.red(`  !  ${message}`);
  }
  return `  ${status}`;
}

function formatAgentStatus(live?: AgentLiveStatus, provider?: Provider): string {
  const installed = live?.installed ? t.green('● 已安装') : t.muted('○ 未安装');
  const name = t.text(provider?.name || live?.providerLabel || '未配置供应商');
  const model = t.accent(live?.model || '未配置模型');
  return `${installed}${t.faint('  ·  ')}${name}${t.faint('  ·  ')}${model}`;
}

function hint(key: string, label: string): string {
  return `${t.accentBold(key)}${t.faint(' ' + label)}`;
}

function buildAgentBar(agents: AgentLiveStatus[], index: number, current?: string, width = 80): string {
  const parts = agents.map((agent, i) => {
    const n = t.faint(String(i + 1));
    const mark = agent.id === current ? t.green('●') : t.faint('○');
    const name = agent.installed ? agent.name : `${agent.name}${t.faint(' 未装')}`;
    const inner = ` ${n} ${mark} ${name} `;
    if (i === index) return `\x1b[48;5;75;38;5;232;1m${stripAnsi(inner)}\x1b[0m`;
    return t.muted(stripAnsi(inner));
  });
  const bar = ` ${parts.join('  ')}`;
  return dispWidth(stripAnsi(bar)) > width ? `${bar}` : bar;
}

function formatProvider(provider: Provider, live: AgentLiveStatus | undefined, selected: boolean, width: number): string {
  const current = isCurrentProvider(provider, live);
  const tags = configuredProtocols(provider).map(protocolLabel).join(' ');
  const key = provider.apiKey ? 'KEY' : 'NO KEY';
  const on = current ? 'ON' : '  ';
  const mark = selected ? '▌' : ' ';
  const plain = pad(trunc(`${mark} ${provider.name}  ${on}  ${key}  ${tags}`, width), width);
  if (selected) return `\x1b[48;5;237;38;5;159m${plain}\x1b[0m`;
  if (current) return t.green(plain);
  return t.text(plain);
}

function formatModel(model: ModelRow, live: AgentLiveStatus | undefined, selected: boolean, width: number): string {
  const current = live?.model === model.modelId;
  const mark = selected ? '▌' : ' ';
  const badge = current ? '  ON' : model.selected ? '  默认' : '';
  const plain = pad(trunc(`${mark} ${model.modelId}${badge}`, width), width);
  if (selected) return `\x1b[48;5;237;38;5;159m${plain}\x1b[0m`;
  if (current) return t.green(plain);
  return t.text(plain);
}

function windowed<T>(list: T[], index: number, size: number): { items: T[] } {
  if (list.length <= size) return { items: list };
  const offset = Math.min(Math.max(0, index - Math.floor(size / 2)), list.length - size);
  return { items: list.slice(offset, offset + size) };
}

function frameTop(title: string, width: number, active: boolean): string {
  const label = title ? ` ${title} ` : '';
  const rest = Math.max(0, width - 2 - dispWidth(label));
  const colored = active ? t.accentBold(label) : t.muted(label);
  return `${t.faint('╭')}${colored}${t.faint('─'.repeat(rest) + '╮')}`;
}

function frameBottom(width: number, extra = ''): string {
  const label = extra ? stripAnsi(extra) : '';
  const rest = Math.max(0, width - 2 - dispWidth(label));
  const text = extra ? t.muted(trunc(extra, width - 2)) : '';
  if (!label) return t.faint(`╰${'─'.repeat(width - 2)}╯`);
  return `${t.faint('╰')}${text}${t.faint('─'.repeat(Math.max(0, rest)) + '╯')}`;
}

function frameRow(width: number, content: string): string {
  const innerW = width - 2;
  const raw = content || ' ';
  const inner = pad(dispWidth(raw) > innerW ? trunc(raw, innerW) : raw, innerW);
  return `${t.faint('│')}${inner}${t.faint('│')}`;
}

function isCurrentProvider(provider: Provider, live?: AgentLiveStatus): boolean {
  if (!live) return false;
  if (live.currentProviderId) return live.currentProviderId === provider.id;
  const urls = configuredProtocols(provider).map((item) => normalizeUrl(provider.protocols[item]?.baseUrl));
  if (live.providerId && (live.providerId === provider.id || urls.includes(normalizeUrl(live.providerId)))) {
    return true;
  }
  if (live.baseUrl && urls.includes(normalizeUrl(live.baseUrl))) return true;
  return false;
}

function configuredProtocols(provider: Provider) {
  return (['openai', 'anthropic', 'gemini'] as const).filter((item) => provider.protocols[item]?.baseUrl);
}

function agentUrl(provider: Provider, agent?: AgentId): string {
  if (!agent) return '';
  const protocol = protocolsForAgent(agent).find((item) => provider.protocols[item]?.baseUrl);
  return protocol ? provider.protocols[protocol]?.baseUrl || '' : '';
}

function normalizeUrl(value?: string): string {
  return (value || '').replace(/\/$/, '');
}

function stripAnsi(value: string): string {
  return value.replace(ANSI, '');
}

function charWidth(ch: string): number {
  const code = ch.codePointAt(0) || 0;
  if (code <= 31 || (code >= 127 && code <= 159)) return 0;
  if (
    code >= 0x1100 && (
      code <= 0x115f
      || code === 0x2329 || code === 0x232a
      || (code >= 0x2e80 && code <= 0xa4cf && code !== 0x303f)
      || (code >= 0xac00 && code <= 0xd7a3)
      || (code >= 0xf900 && code <= 0xfaff)
      || (code >= 0xfe10 && code <= 0xfe19)
      || (code >= 0xfe30 && code <= 0xfe6f)
      || (code >= 0xff00 && code <= 0xff60)
      || (code >= 0xffe0 && code <= 0xffe6)
    )
  ) return 2;
  return 1;
}

function dispWidth(value: string): number {
  let width = 0;
  for (const ch of stripAnsi(value)) width += charWidth(ch);
  return width;
}

function pad(value: string, width: number): string {
  const extra = width - dispWidth(value);
  return extra > 0 ? value + ' '.repeat(extra) : value;
}

function trunc(value: string, width: number): string {
  if (dispWidth(value) <= width) return value;
  const plain = stripAnsi(value);
  let out = '';
  let w = 0;
  for (const ch of plain) {
    const cw = charWidth(ch);
    if (w + cw >= width) break;
    out += ch;
    w += cw;
  }
  return `${out}…`;
}
