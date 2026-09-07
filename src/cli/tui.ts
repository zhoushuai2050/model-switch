import { execSync } from 'node:child_process';
import { engine, protocolLabel, protocolsForAgent } from '../core/engine.ts';
import type { AgentId, AgentLiveStatus, ModelRow, Provider } from '../core/types.ts';
import { color } from './format.ts';

type Col = 0 | 1;
const ANSI = /\x1b\[[0-9;]*m/g;

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
  let message = '←/→ Agent  ↑/↓ 选择  Tab 切栏  Enter 启用  r 启动  q 退出';

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
    message = `当前 Agent: ${agent.name}`;
  };

  render();

  await new Promise<void>((resolve) => {
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
          providerIndex += 1;
          syncIndexes(true);
        } else {
          modelIndex += 1;
        }
      } else if (key === '\r' || key === '\n') {
        try {
          const agent = selectedAgent();
          const providers = providersOf();
          const provider = providers[providerIndex];
          const models = modelsOf(provider);
          const model = models[modelIndex];
          if (!agent) {
            message = '没有可选 Agent';
          } else if (!provider) {
            const need = protocolsForAgent(agent.id).map(protocolLabel).join(' / ');
            message = `当前 ${agent.name} 没有可用供应商，请添加带 ${need} 地址的供应商`;
          } else if (col === 1 && model) {
            const result = engine.setModel(model.id, { agent: agent.id });
            message = `已启用 ${provider.name} → ${result.model || model.modelId}`;
            syncIndexes(true);
          } else {
            const result = engine.use(provider.id, { agent: agent.id });
            message = `已启用 ${provider.name} → ${result.model || models[0]?.modelId || ''}`;
            syncIndexes(true);
          }
        } catch (error) {
          message = error instanceof Error ? error.message : String(error);
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
}): string[] {
  const width = Math.max(60, process.stdout.columns || 80);
  const lines: string[] = [];
  const agent = opts.agents[opts.agentIndex];
  const provider = opts.providers[opts.providerIndex];
  const need = agent ? protocolsForAgent(agent.id).map(protocolLabel).join(' / ') : '';
  lines.push(color.bold(color.amber(' MODEL SWITCH')) + color.dim('  本机 Agent / 模型切换台'));
  lines.push(color.dim('─'.repeat(width)));
  lines.push(buildAgentBar(opts.agents, opts.agentIndex, opts.currentAgent, width));
  const currentProvider = opts.providers.find((item) => isCurrentProvider(item, opts.live));
  const currentLabel = [
    agent?.name || '-',
    currentProvider?.name || opts.live?.providerLabel || '未配置供应商',
    opts.live?.model || '未配置模型',
  ].join(' · ');
  lines.push(`${color.dim('当前')}  ${currentLabel}${opts.live?.installed ? '' : color.dim('  未安装')}`);
  lines.push(`${color.dim('筛选')}  仅显示带 ${need || '对应协议'} 地址的供应商，与管理台一致`);
  lines.push(color.dim('─'.repeat(width)));

  const leftW = Math.min(42, Math.max(28, Math.floor(width * 0.52)));
  const rightW = Math.max(18, width - leftW - 2);
  const leftHead = opts.col === 0 ? color.amber('▸ 供应商') : color.dim('  供应商');
  const rightHead = opts.col === 1 ? color.amber('▸ 模型') : color.dim('  模型');
  lines.push(`${pad(leftHead, leftW)}${rightHead}`);

  if (!opts.providers.length) {
    lines.push(color.dim(`  当前 ${agent?.name || 'Agent'} 没有可用供应商`));
    lines.push(color.dim(`  请添加带 ${need} 地址的供应商，或切换到其他 Agent`));
  } else {
    const rows = Math.max(opts.providers.length, opts.models.length, 1);
    for (let i = 0; i < rows; i++) {
      const left = opts.providers[i]
        ? formatProvider(opts.providers[i], opts.live, opts.col === 0 && i === opts.providerIndex, leftW)
        : ' '.repeat(leftW);
      const right = opts.models[i]
        ? formatModel(opts.models[i], opts.live, opts.col === 1 && i === opts.modelIndex, rightW)
        : '';
      lines.push(`${pad(left, leftW)}${right}`);
    }
    if (provider) {
      const url = agentUrl(provider, agent?.id);
      lines.push(color.dim('─'.repeat(width)));
      lines.push(color.dim(` ${provider.name}  ${url || '未配置当前 Agent 地址'}`));
    }
  }

  lines.push(color.dim('─'.repeat(width)));
  lines.push(opts.message);
  return lines;
}

function buildAgentBar(agents: AgentLiveStatus[], index: number, current?: string, width = 80): string {
  const parts = agents.map((agent, i) => {
    const mark = agent.id === current ? '●' : '○';
    const state = agent.installed ? '' : color.dim('未安装');
    const body = `${mark}${agent.name}${state ? ` ${state}` : ''}`;
    if (i === index) return color.bold(color.amber(`[ ${body} ]`));
    return color.dim(`  ${body}  `);
  });
  const bar = ` Agent  ${parts.join('')}`;
  return visLen(bar) > width ? `${bar.slice(0, width - 1)}…` : bar;
}

function formatProvider(provider: Provider, live: AgentLiveStatus | undefined, selected: boolean, width: number): string {
  const current = isCurrentProvider(provider, live);
  const key = provider.apiKey ? 'KEY' : '无KEY';
  const tags = configuredProtocols(provider).map(protocolLabel).join(' ');
  const mark = selected ? '▸' : ' ';
  const badge = current ? '当前' : '  ';
  const body = trunc(`${mark} ${provider.name}  ${badge}  ${key}  ${tags}`, width);
  return selected ? color.bold(color.amber(body)) : current ? color.green(body) : body;
}

function formatModel(model: ModelRow, live: AgentLiveStatus | undefined, selected: boolean, width: number): string {
  const current = live?.model === model.modelId;
  const mark = selected ? '▸' : ' ';
  const badge = current ? ' ●' : '';
  const body = trunc(`${mark} ${model.modelId}${badge}`, width);
  return selected ? color.bold(color.amber(body)) : current ? color.green(body) : body;
}

function isCurrentProvider(provider: Provider, live?: AgentLiveStatus): boolean {
  if (!live) return false;
  const urls = configuredProtocols(provider).map((item) => normalizeUrl(provider.protocols[item]?.baseUrl));
  if (live.providerLabel && (live.providerLabel === provider.name || live.providerLabel === provider.id || urls.includes(normalizeUrl(live.providerLabel)))) {
    return true;
  }
  if (live.baseUrl && urls.includes(normalizeUrl(live.baseUrl))) return true;
  return engine.listModels().some((item) => item.providerId === provider.id && item.modelId === live.model);
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

function visLen(value: string): number {
  return value.replace(ANSI, '').length;
}

function pad(value: string, width: number): string {
  const extra = width - visLen(value);
  return extra > 0 ? value + ' '.repeat(extra) : value;
}

function trunc(value: string, width: number): string {
  if (visLen(value) <= width) return value;
  const plain = value.replace(ANSI, '');
  return `${plain.slice(0, Math.max(1, width - 1))}…`;
}
