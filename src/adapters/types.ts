import type { AgentId, ApplyPayload, McpServer, Protocol } from '../core/types.ts';

export interface LaunchSpec {
  command: string;
  args: string[];
  env: Record<string, string>;
}

export interface ProbeSpec extends LaunchSpec {
  pathEnv: Record<string, string>;
  outputFile?: string;
}

export interface ProbeParseInput {
  stdout: string;
  stderr: string;
  code: number | null;
  timedOut: boolean;
  spawnError?: string;
  outputFileText?: string;
}

export interface ProbeParseResult {
  reply?: string;
  error?: string;
}

export interface Adapter {
  id: AgentId;
  displayName: string;
  protocol: Protocol;
  binaries: string[];
  detect(): { installed: boolean; bin?: string };
  liveFiles(): string[];
  apply(payload: ApplyPayload): void;
  readStatus(): { model?: string; baseUrl?: string; providerLabel?: string; providerId?: string; configured: boolean };
  sessionLaunch(payload: ApplyPayload, extraArgs: string[]): LaunchSpec;
  probeSpec(payload: ApplyPayload, prompt: string, isolatedHome: string): ProbeSpec;
  parseProbe(input: ProbeParseInput): ProbeParseResult;
  syncMcp?(servers: McpServer[]): void;
}
