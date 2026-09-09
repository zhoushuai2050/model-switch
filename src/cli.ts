#!/usr/bin/env node
import './core/silence-sqlite-warning.ts';
import { engine, EngineError } from './core/engine.ts';
import { HELP, HELP_CUSTOM } from './cli/help.ts';
import { selfUpdate, updateNpmArgs, resolveNpm } from './cli/update.ts';
import { flag, flagList, parseArgv } from './cli/parse.ts';
import { color, printProviders, printStatus, printSwitch } from './cli/format.ts';
import { runTui } from './cli/tui.ts';
import { startServer } from './server.ts';
import { isAgentId, type AgentId } from './core/types.ts';

const args = parseArgv(process.argv);

if (args.flags.help || args.cmd === 'help' || args.cmd === '--help') {
  const topic = args.cmd === 'help' ? args.args[0] || '' : args.cmd === 'provider' ? 'custom' : '';
  console.log(topic === 'custom' || topic === 'provider' ? HELP_CUSTOM : HELP);
  process.exit(0);
}

try {
  await dispatch();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(color.red(message));
  process.exit(error instanceof EngineError ? 2 : 1);
}

async function dispatch(): Promise<void> {
  switch (args.cmd) {
    case '':
      await runTui();
      process.exit(0);
      return;
    case 'status': {
      const status = engine.status();
      printStatus(status.agents, status.state.currentAgent);
      return;
    }
    case 'ls':
    case 'list':
      list(args.args[0] || 'providers');
      return;
    case 'providers':
      list('providers');
      return;
    case 'use': {
      if (!args.args[0]) throw new EngineError('Usage: msw use <provider|model|agent:model>');
      printSwitch(engine.use(args.args[0], { agent: flag(args, 'agent') || undefined }));
      return;
    }
    case 'agent': {
      if (!args.args[0]) throw new EngineError('Usage: msw agent <claude|codex|gemini|opencode>');
      engine.setAgent(args.args[0]);
      console.log(`current agent: ${args.args[0]}`);
      return;
    }
    case 'model': {
      if (!args.args[0]) throw new EngineError('Usage: msw model <id>');
      printSwitch(engine.setModel(args.args[0], { agent: flag(args, 'agent') || undefined }));
      return;
    }
    case 'run': {
      const spec = engine.launch({
        agent: args.args[0],
        target: flag(args, 'use') || flag(args, 'provider') || undefined,
        extraArgs: args.extra,
      });
      console.log(color.dim(`${spec.command} ${spec.args.join(' ')}`));
      engine.spawn(spec);
      return;
    }
    case 'provider':
      await providerCommand();
      return;
    case 'mcp':
      mcpCommand();
      return;
    case 'serve': {
      const port = Number(flag(args, 'port') || 8787);
      await startServer(port);
      return;
    }
    case 'ping': {
      let ok = false;
      for await (const step of engine.pingSteps(args.args[0], flag(args, 'agent') as AgentId | undefined)) {
        if (step.status === 'running') continue;
        const mark = step.status === 'ok' ? color.green('ok') : step.status === 'warn' ? color.amber('warn') : step.status === 'skip' ? color.amber('skip') : color.red('fail');
        const extra = [step.method, step.httpStatus, step.ms != null ? `${step.ms}ms` : '', step.url].filter(Boolean).join(' ');
        console.log(`${mark} ${step.title}${extra ? `  ${extra}` : ''}`);
        if (step.detail) console.log(`   ${step.detail}`);
        if (step.id === 'summary') ok = step.status === 'ok' || step.status === 'warn';
      }
      if (!ok) process.exitCode = 1;
      return;
    }
    case 'prompt':
      process.stdout.write(engine.prompt());
      return;
    case 'doctor':
      doctor();
      return;
    case 'log':
      for (const row of engine.listLogs()) {
        const at = new Date(Number(row.at)).toISOString().replace('T', ' ').slice(0, 19);
        console.log(`${at}  ${row.scope}  ${row.agent_id || '-'}  ${row.provider_id || '-'}  ${row.model_id || ''}`);
      }
      return;
    case 'update':
    case 'upgrade': {
      const npm = resolveNpm();
      const npmArgs = updateNpmArgs();
      console.log(color.bold('Updating msw from GitHub main'));
      console.log(color.dim(`${npm} ${npmArgs.join(' ')}`));
      await selfUpdate();
      console.log(color.green('msw 已更新。'));
      if (process.platform !== 'win32') {
        console.log(color.dim('如果命令还是旧版本，先执行 hash -r，再运行 msw status'));
      }
      return;
    }
    default:
      throw new EngineError(`Unknown command: ${args.cmd}\n\n${HELP}`);
  }
}

function list(kind: string): void {
  const status = engine.status();
  switch (kind) {
    case 'agent':
    case 'agents':
      printStatus(status.agents, status.state.currentAgent);
      return;
    case 'provider':
    case 'providers':
      printProviders(engine.listProviders(), engine.listModels());
      return;
    case 'model':
    case 'models': {
      const providers = new Map(engine.listProviders().map((item) => [item.id, item]));
      const models = engine.listModels();
      if (!models.length) {
        console.log('还没有模型。在管理台编辑供应商，或: msw provider add custom --models gpt-5.6-sol');
        return;
      }
      for (const model of models) {
        const provider = providers.get(model.providerId);
        console.log(`${model.modelId.padEnd(28)} ${provider?.name || model.providerId}`);
      }
      return;
    }
    case 'mcp':
      for (const server of engine.listMcp()) {
        console.log(`${server.name.padEnd(16)} ${server.transport.padEnd(8)} ${server.agents.join(',')}  ${server.command || server.url || ''}`);
      }
      return;
    default:
      throw new EngineError(`Unknown list type: ${kind}\nUsage: msw ls [providers|agents|models|mcp]`);
  }
}

async function providerCommand(): Promise<void> {
  const sub = args.args[0] || 'ls';
  const rest = args.args.slice(1);
  if (sub === 'ls' || sub === 'list') {
    printProviders(engine.listProviders(), engine.listModels());
    return;
  }
  if (sub === 'presets') {
    for (const preset of engine.listPresets()) {
      console.log(`${preset.id.padEnd(14)} ${preset.name.padEnd(20)} ${Object.keys(preset.protocols).join(',')}`);
    }
    return;
  }
  if (sub === 'add') {
    const preset = rest[0] || flag(args, 'preset');
    const provider = engine.addProvider({
      preset: preset || undefined,
      name: flag(args, 'name') || undefined,
      apiKey: flag(args, 'key') || flag(args, 'api-key'),
      openaiUrl: flag(args, 'openai-url') || flag(args, 'base-url') || undefined,
      anthropicUrl: flag(args, 'anthropic-url') || undefined,
      geminiUrl: flag(args, 'gemini-url') || undefined,
      wireApi: (flag(args, 'wire-api') as 'chat' | 'responses') || undefined,
      models: flagList(flag(args, 'models')).length ? flagList(flag(args, 'models')) : undefined,
    });
    console.log(`added provider ${provider.id}`);
    return;
  }
  if (sub === 'rm' || sub === 'delete' || sub === 'remove') {
    if (!rest[0]) throw new EngineError('Usage: msw provider rm <名称或id>');
    const provider = engine.deleteProvider(rest[0]);
    console.log(`已删除供应商 ${provider.name}`);
    return;
  }
  if (sub === 'set-key') {
    if (!rest[0] || !rest[1]) throw new EngineError('Usage: msw provider set-key <id> <key>');
    engine.updateProvider(rest[0], { apiKey: rest[1] });
    console.log(`updated key for ${rest[0]}`);
    return;
  }
  if (sub === 'ping') {
    args.args = rest;
    // reuse top-level ping formatting
    let ok = false;
    for await (const step of engine.pingSteps(rest[0])) {
      if (step.status === 'running') continue;
      const mark = step.status === 'ok' ? 'ok' : step.status;
      console.log(`${mark} ${step.title}${step.httpStatus ? ` ${step.httpStatus}` : ''}${step.ms != null ? ` ${step.ms}ms` : ''}`);
      if (step.detail) console.log(`  ${step.detail}`);
      if (step.id === 'summary') ok = step.status === 'ok' || step.status === 'warn';
    }
    if (!ok) process.exitCode = 1;
    return;
  }
  throw new EngineError(
    'Usage: msw provider ls|add|rm|set-key|ping|presets\n  msw provider ls           显示所有供应商\n  msw provider rm <名称>    删除供应商\n自定义中转: msw help custom',
  );
}

function mcpCommand(): void {
  const sub = args.args[0] || 'ls';
  if (sub === 'ls') {
    list('mcp');
    return;
  }
  if (sub === 'add') {
    const name = flag(args, 'name') || args.args[1];
    if (!name) throw new EngineError('Usage: msw mcp add --name filesystem --command npx --args -y,@pkg');
    const agents = flagList(flag(args, 'agents')).filter(isAgentId);
    engine.addMcp({
      name,
      command: flag(args, 'command') || undefined,
      args: flagList(flag(args, 'args')),
      url: flag(args, 'url') || undefined,
      agents,
    });
    console.log(`added mcp ${name}`);
    return;
  }
  if (sub === 'sync') {
    console.log(`synced ${engine.syncMcp().join(', ')}`);
    return;
  }
  throw new EngineError('Usage: msw mcp ls|add|sync');
}

function doctor(): void {
  const status = engine.status();
  console.log(`db     ${color.green('ok')}`);
  for (const agent of status.agents) {
    const bin = agent.installed ? color.green(agent.bin || 'yes') : color.dim('missing');
    const cfg = agent.configured ? color.green('config') : color.dim('no-config');
    console.log(`${agent.id.padEnd(9)} ${bin}  ${cfg}  ${agent.model || ''}`);
  }
  if (!engine.listProviders().length) console.log(color.dim('hint: msw provider add kimi --key sk-...'));
}
