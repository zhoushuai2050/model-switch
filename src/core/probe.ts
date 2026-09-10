import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomInt } from 'node:crypto';
import type { PingStatus } from './types.ts';

export const PING_TIMEOUT_MS = 45_000;

const PING_PROMPTS = [
  '你好',
  '1+1等于几？',
  '用一句话介绍一下你自己。',
  '今天天气怎么样？',
  '帮我把 3.14 四舍五入到整数。',
  '春天有什么特点？',
] as const;

export function randomPingPrompt(): string {
  return PING_PROMPTS[randomInt(PING_PROMPTS.length)];
}

export function createPingDirs(): { root: string; work: string } {
  const root = mkdtempSync(join(tmpdir(), 'msw-ping-'));
  const work = join(root, 'work');
  mkdirSync(work, { recursive: true });
  return { root, work };
}

export function cleanupPingDirs(root: string): void {
  try {
    rmSync(root, { recursive: true, force: true });
  } catch {
    // ignore leftover temp files
  }
}

export function buildChildEnv(
  pathEnv: Record<string, string>,
  probeEnv: Record<string, string>,
): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) env[key] = value;
  }
  Object.assign(env, pathEnv);
  for (const [key, value] of Object.entries(probeEnv)) {
    if (value) env[key] = value;
    else delete env[key];
  }
  return env;
}

export function commandLine(command: string, args: string[]): string {
  return [command, ...args].join(' ');
}

export function isProbeTestStep(step: { id: string }): boolean {
  return step.id.endsWith('-sdk');
}

export type CommandRun = {
  stdout: string;
  stderr: string;
  code: number | null;
  timedOut: boolean;
  ms: number;
  spawnError?: string;
  outputFileText?: string;
};

export async function runCommand(
  spec: { command: string; args: string[]; env: Record<string, string>; outputFile?: string },
  opts: { cwd: string; timeoutMs: number },
): Promise<CommandRun> {
  const started = Date.now();
  return await new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let settled = false;

    const finish = (extra: { code: number | null; spawnError?: string }) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      let outputFileText: string | undefined;
      if (spec.outputFile && existsSync(spec.outputFile)) {
        try {
          outputFileText = readFileSync(spec.outputFile, 'utf8');
        } catch {
          outputFileText = undefined;
        }
      }
      resolve({
        stdout,
        stderr,
        timedOut,
        ms: Date.now() - started,
        outputFileText,
        ...extra,
      });
    };

    let timer: ReturnType<typeof setTimeout> | undefined;
    let child;
    try {
      child = spawn(spec.command, spec.args, {
        cwd: opts.cwd,
        env: spec.env,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (error) {
      finish({
        code: null,
        spawnError: error instanceof Error ? error.message : String(error),
      });
      return;
    }

    timer = setTimeout(() => {
      timedOut = true;
      try {
        child.kill('SIGKILL');
      } catch {
        // already exited
      }
    }, opts.timeoutMs);

    child.stdout?.setEncoding('utf8');
    child.stderr?.setEncoding('utf8');
    child.stdout?.on('data', (chunk: string) => {
      stdout += chunk;
      if (stdout.length > 200_000) stdout = stdout.slice(-100_000);
    });
    child.stderr?.on('data', (chunk: string) => {
      stderr += chunk;
      if (stderr.length > 200_000) stderr = stderr.slice(-100_000);
    });
    child.on('error', (error) => {
      const detail = error instanceof Error ? error.message : String(error);
      const spawnError = 'code' in error && (error as NodeJS.ErrnoException).code === 'ENOENT'
        ? `找不到 ${spec.command}`
        : detail;
      finish({ code: null, spawnError });
    });
    child.on('close', (code) => {
      finish({
        code,
        spawnError: timedOut ? `Agent SDK 超时（${Math.round(opts.timeoutMs / 1000)}s）` : undefined,
      });
    });
  });
}

const AUTH_RE = /401|403|unauthorized|forbidden|invalid[_ -]?api[_ -]?key|authentication failed|api key/i;
const REQUEST_RE = /400|model .* not found|unknown model|invalid_request|not_found_error|does not exist/i;

export function classifyProbe(
  run: CommandRun,
  parsed: { reply?: string; error?: string },
): { rank: PingStatus; detail: string } {
  const blob = [parsed.error, run.spawnError, run.stderr, run.stdout].filter(Boolean).join('\n');
  if (run.timedOut) {
    return { rank: 'fail', detail: run.spawnError || `Agent SDK 超时（${Math.round(run.ms / 1000)}s）` };
  }
  if (run.spawnError) {
    return { rank: 'fail', detail: run.spawnError };
  }
  if (parsed.reply?.trim()) {
    return { rank: 'ok', detail: `收到回复：${clip(parsed.reply.trim())}` };
  }
  if (AUTH_RE.test(blob)) {
    return { rank: 'warn', detail: `服务可达，鉴权失败：${clip(parsed.error || blob)}` };
  }
  if (REQUEST_RE.test(blob)) {
    return { rank: 'warn', detail: `服务可达，请求被拒绝：${clip(parsed.error || blob)}` };
  }
  if (run.code === 0) {
    return { rank: 'warn', detail: 'Agent 已启动，但没有收到模型回复' };
  }
  return {
    rank: 'fail',
    detail: clip(parsed.error || blob || (run.code == null ? '启动 Agent SDK 失败' : `退出码 ${run.code}`)),
  };
}

export function jsonValue(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

export function extractJson(text: string): unknown {
  const trimmed = text.trim();
  if (!trimmed) return undefined;
  const direct = jsonValue(trimmed);
  if (direct !== undefined) return direct;
  const start = trimmed.lastIndexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start >= 0 && end > start) return jsonValue(trimmed.slice(start, end + 1));
  return undefined;
}

export function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

export function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

export function clip(text: string, length = 180): string {
  const normalized = text.replace(/\s+/g, ' ').trim();
  return normalized.length > length ? `${normalized.slice(0, length - 1)}…` : normalized;
}

export function collectJsonlText(text: string): string | undefined {
  const parts: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    const root = asRecord(jsonValue(line.trim()));
    if (!root) continue;
    const part = asRecord(root.part);
    const item = asRecord(root.item);
    const message = asRecord(root.message);
    const piece =
      asString(root.text) ||
      asString(root.delta) ||
      asString(root.response) ||
      asString(root.result) ||
      asString(part?.text) ||
      asString(item?.text) ||
      asString(message?.content) ||
      asString(asRecord(item)?.text);
    if (piece) parts.push(piece);
  }
  return parts.join('') || undefined;
}
