import type { AgentLiveStatus, ModelRow, Provider, SwitchResult } from '../core/types.ts';

export const color = {
  dim: (s: string) => `\x1b[2m${s}\x1b[0m`,
  bold: (s: string) => `\x1b[1m${s}\x1b[0m`,
  amber: (s: string) => `\x1b[38;5;214m${s}\x1b[0m`,
  green: (s: string) => `\x1b[32m${s}\x1b[0m`,
  red: (s: string) => `\x1b[31m${s}\x1b[0m`,
  cyan: (s: string) => `\x1b[36m${s}\x1b[0m`,
};

export function printStatus(agents: AgentLiveStatus[], currentAgent?: string): void {
  console.log(color.bold(color.amber('MODEL SWITCH')));
  if (currentAgent) console.log(`agent    ${color.cyan(currentAgent)}`);
  console.log('');
  for (const agent of agents) {
    const mark = agent.id === currentAgent ? color.green('●') : color.dim('○');
    const state = agent.installed ? color.green('ready') : color.dim('no bin');
    const model = agent.model || '-';
    const provider = agent.providerLabel || '-';
    console.log(`${mark} ${agent.id.padEnd(9)} ${state.padEnd(16)} ${model.padEnd(22)} ${color.dim(provider)}`);
  }
}

export function printSwitch(result: SwitchResult): void {
  const head = result.applied.length ? color.green('switched') : color.red('not switched');
  console.log(`${head}  ${result.applied.join(', ') || '-'}  ${result.model || ''}  (${result.scope})`);
  for (const skip of result.skipped) {
    console.log(color.dim(`  skip ${skip.agentId}: ${skip.reason}`));
  }
}

const PROTOCOL_LABELS: Record<string, string> = {
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  gemini: 'Gemini',
};

export function printProviders(providers: Provider[], models: ModelRow[] = []): void {
  if (!providers.length) {
    console.log('还没有供应商。添加: msw provider add kimi --key sk-...');
    return;
  }
  const nameCount = new Map<string, number>();
  for (const provider of providers) {
    const key = provider.name.toLowerCase();
    nameCount.set(key, (nameCount.get(key) || 0) + 1);
  }
  console.log(`供应商 ${providers.length} 个`);
  console.log('');
  for (const provider of providers) {
    const protocols = (['openai', 'anthropic', 'gemini'] as const)
      .map((name) => [name, provider.protocols[name]] as const)
      .filter(([, cfg]) => cfg?.baseUrl);
    const tags = protocols.map(([name]) => PROTOCOL_LABELS[name]).join(' ') || '无协议';
    const key = provider.apiKey ? color.green('KEY') : color.dim('无KEY');
    const providerModels = models.filter((item) => item.providerId === provider.id).map((item) => item.modelId);
    console.log(`${color.bold(provider.name)}  ${key}  ${color.dim(tags)}`);
    if ((nameCount.get(provider.name.toLowerCase()) || 0) > 1) {
      console.log(`  id         ${provider.id}`);
    }
    for (const [name, cfg] of protocols) {
      console.log(`  ${PROTOCOL_LABELS[name].padEnd(10)} ${cfg?.baseUrl}`);
    }
    console.log(`  模型       ${providerModels.join(', ') || '-'}`);
    console.log('');
  }
  console.log(color.dim('删除: msw provider rm <名称>'));
}

export function maskKey(key: string): string {
  if (!key) return '';
  if (key.length <= 8) return '****';
  return `${key.slice(0, 4)}…${key.slice(-4)}`;
}
