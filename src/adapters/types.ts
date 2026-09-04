import type { AgentId, ApplyPayload, McpServer, Protocol } from '../core/types.ts';

export interface LaunchSpec {
  command: string;
  args: string[];
  env: Record<string, string>;
}

export interface Adapter {
  id: AgentId;
  displayName: string;
  protocol: Protocol;
  binaries: string[];
  detect(): { installed: boolean; bin?: string };
  liveFiles(): string[];
  importLive(): ApplyPayload | null;
  apply(payload: ApplyPayload): void;
  readStatus(): { model?: string; baseUrl?: string; providerLabel?: string; configured: boolean };
  sessionLaunch(payload: ApplyPayload, extraArgs: string[]): LaunchSpec;
  syncMcp?(servers: McpServer[]): void;
}
