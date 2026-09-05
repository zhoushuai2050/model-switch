import './silence-sqlite-warning.ts';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { dbPath } from './paths.ts';
import type {
  AgentId,
  AppState,
  McpServer,
  ModelRow,
  Profile,
  ProfileBinding,
  Protocol,
  ProtocolConfig,
  Provider,
} from './types.ts';
import { AGENT_IDS } from './types.ts';

type Row = Record<string, unknown>;

let singleton: DatabaseSync | null = null;

export function openDb(path = dbPath()): DatabaseSync {
  mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  migrate(db);
  return db;
}

export function getDb(): DatabaseSync {
  if (!singleton) singleton = openDb();
  return singleton;
}

export function resetDbCache(): void {
  if (singleton) {
    try {
      singleton.close();
    } catch {
      // ignore
    }
  }
  singleton = null;
}

function migrate(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS providers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      api_key TEXT NOT NULL DEFAULT '',
      website_url TEXT,
      notes TEXT,
      protocols_json TEXT NOT NULL DEFAULT '{}',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS models (
      id TEXT PRIMARY KEY,
      provider_id TEXT NOT NULL,
      model_id TEXT NOT NULL,
      alias TEXT,
      agent_hint TEXT,
      FOREIGN KEY (provider_id) REFERENCES providers(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS profiles (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      default_agent TEXT,
      sort_index INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS profile_bindings (
      id TEXT PRIMARY KEY,
      profile_id TEXT NOT NULL,
      agent_id TEXT NOT NULL,
      provider_id TEXT NOT NULL,
      model_id TEXT NOT NULL,
      extra_json TEXT,
      UNIQUE (profile_id, agent_id),
      FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE,
      FOREIGN KEY (provider_id) REFERENCES providers(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS mcp_servers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      transport TEXT NOT NULL,
      command TEXT,
      args_json TEXT NOT NULL DEFAULT '[]',
      url TEXT,
      env_json TEXT NOT NULL DEFAULT '{}',
      agents_json TEXT NOT NULL DEFAULT '[]'
    );
    CREATE TABLE IF NOT EXISTS app_state (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS switch_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      at INTEGER NOT NULL,
      profile_id TEXT,
      agent_id TEXT,
      provider_id TEXT,
      model_id TEXT,
      scope TEXT NOT NULL,
      note TEXT
    );
  `);
}

function asRecord(row: unknown): Row {
  return row as Row;
}

export function listProviders(db = getDb()): Provider[] {
  return db.prepare('SELECT * FROM providers ORDER BY name').all().map((row) => toProvider(asRecord(row)));
}

export function getProvider(id: string, db = getDb()): Provider | undefined {
  const row = db.prepare('SELECT * FROM providers WHERE id = ?').get(id);
  return row ? toProvider(asRecord(row)) : undefined;
}

export function upsertProvider(provider: Provider, db = getDb()): void {
  db.prepare(
    `INSERT INTO providers (id, name, api_key, website_url, notes, protocols_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       name = excluded.name,
       api_key = excluded.api_key,
       website_url = excluded.website_url,
       notes = excluded.notes,
       protocols_json = excluded.protocols_json,
       updated_at = excluded.updated_at`,
  ).run(
    provider.id,
    provider.name,
    provider.apiKey,
    provider.websiteUrl ?? null,
    provider.notes ?? null,
    JSON.stringify(provider.protocols),
    provider.createdAt,
    provider.updatedAt,
  );
}

export function deleteProvider(id: string, db = getDb()): void {
  db.prepare('DELETE FROM models WHERE provider_id = ?').run(id);
  db.prepare('DELETE FROM profile_bindings WHERE provider_id = ?').run(id);
  db.prepare('DELETE FROM providers WHERE id = ?').run(id);
}

export function listModels(db = getDb()): ModelRow[] {
  return db.prepare('SELECT * FROM models ORDER BY model_id').all().map((row) => toModel(asRecord(row)));
}

export function modelsForProvider(providerId: string, db = getDb()): ModelRow[] {
  return db
    .prepare('SELECT * FROM models WHERE provider_id = ? ORDER BY model_id')
    .all(providerId)
    .map((row) => toModel(asRecord(row)));
}

export function upsertModel(model: ModelRow, db = getDb()): void {
  db.prepare(
    `INSERT INTO models (id, provider_id, model_id, alias, agent_hint)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       provider_id = excluded.provider_id,
       model_id = excluded.model_id,
       alias = excluded.alias,
       agent_hint = excluded.agent_hint`,
  ).run(model.id, model.providerId, model.modelId, model.alias ?? null, model.agentHint ?? null);
}

export function deleteModelsForProvider(providerId: string, db = getDb()): void {
  db.prepare('DELETE FROM models WHERE provider_id = ?').run(providerId);
}

export function listProfiles(db = getDb()): Profile[] {
  const profiles = db.prepare('SELECT * FROM profiles ORDER BY sort_index, name').all().map((row) => asRecord(row));
  const bindings = db.prepare('SELECT * FROM profile_bindings').all().map((row) => toBinding(asRecord(row)));
  return profiles.map((row) => toProfile(row, bindings.filter((b) => b.profileId === row.id)));
}

export function getProfile(id: string, db = getDb()): Profile | undefined {
  const row = db.prepare('SELECT * FROM profiles WHERE id = ?').get(id);
  if (!row) return undefined;
  const bindings = db
    .prepare('SELECT * FROM profile_bindings WHERE profile_id = ?')
    .all(id)
    .map((item) => toBinding(asRecord(item)));
  return toProfile(asRecord(row), bindings);
}

export function upsertProfile(profile: Profile, db = getDb()): void {
  db.prepare(
    `INSERT INTO profiles (id, name, description, default_agent, sort_index, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       name = excluded.name,
       description = excluded.description,
       default_agent = excluded.default_agent,
       sort_index = excluded.sort_index,
       updated_at = excluded.updated_at`,
  ).run(
    profile.id,
    profile.name,
    profile.description ?? null,
    profile.defaultAgent ?? null,
    profile.sortIndex,
    profile.createdAt,
    profile.updatedAt,
  );
}

export function deleteProfile(id: string, db = getDb()): void {
  db.prepare('DELETE FROM profile_bindings WHERE profile_id = ?').run(id);
  db.prepare('DELETE FROM profiles WHERE id = ?').run(id);
}

export function upsertBinding(binding: ProfileBinding, db = getDb()): void {
  db.prepare(
    `INSERT INTO profile_bindings (id, profile_id, agent_id, provider_id, model_id, extra_json)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(profile_id, agent_id) DO UPDATE SET
       provider_id = excluded.provider_id,
       model_id = excluded.model_id,
       extra_json = excluded.extra_json`,
  ).run(
    binding.id,
    binding.profileId,
    binding.agentId,
    binding.providerId,
    binding.modelId,
    binding.extra ? JSON.stringify(binding.extra) : null,
  );
}

export function deleteBinding(profileId: string, agentId: AgentId, db = getDb()): void {
  db.prepare('DELETE FROM profile_bindings WHERE profile_id = ? AND agent_id = ?').run(profileId, agentId);
}

export function listMcp(db = getDb()): McpServer[] {
  return db.prepare('SELECT * FROM mcp_servers ORDER BY name').all().map((row) => toMcp(asRecord(row)));
}

export function upsertMcp(server: McpServer, db = getDb()): void {
  db.prepare(
    `INSERT INTO mcp_servers (id, name, transport, command, args_json, url, env_json, agents_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       name = excluded.name,
       transport = excluded.transport,
       command = excluded.command,
       args_json = excluded.args_json,
       url = excluded.url,
       env_json = excluded.env_json,
       agents_json = excluded.agents_json`,
  ).run(
    server.id,
    server.name,
    server.transport,
    server.command ?? null,
    JSON.stringify(server.args),
    server.url ?? null,
    JSON.stringify(server.env),
    JSON.stringify(server.agents),
  );
}

export function deleteMcp(id: string, db = getDb()): void {
  db.prepare('DELETE FROM mcp_servers WHERE id = ?').run(id);
}

export function getState(db = getDb()): AppState {
  const rows = db.prepare('SELECT key, value FROM app_state').all().map((row) => asRecord(row));
  const map = Object.fromEntries(rows.map((row) => [String(row.key), String(row.value)]));
  let currentModels: AppState['currentModels'] = {};
  if (map.current_models) {
    try {
      currentModels = JSON.parse(map.current_models);
    } catch {
      currentModels = {};
    }
  }
  const currentAgent = AGENT_IDS.includes(map.current_agent as AgentId)
    ? (map.current_agent as AgentId)
    : undefined;
  return {
    currentAgent,
    currentProfile: map.current_profile || undefined,
    currentModels,
  };
}

export function setState(patch: Partial<AppState>, db = getDb()): AppState {
  const current = getState(db);
  const next: AppState = {
    currentAgent: patch.currentAgent ?? current.currentAgent,
    currentProfile: patch.currentProfile === undefined ? current.currentProfile : patch.currentProfile,
    currentModels: patch.currentModels ? { ...current.currentModels, ...patch.currentModels } : current.currentModels,
  };
  writeState('current_agent', next.currentAgent ?? '');
  writeState('current_profile', next.currentProfile ?? '');
  writeState('current_models', JSON.stringify(next.currentModels));
  return next;
}

function writeState(key: string, value: string, db = getDb()): void {
  db.prepare(
    `INSERT INTO app_state (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  ).run(key, value);
}

export function logSwitch(
  entry: {
    profileId?: string;
    agentId?: string;
    providerId?: string;
    modelId?: string;
    scope: string;
    note?: string;
  },
  db = getDb(),
): void {
  db.prepare(
    `INSERT INTO switch_logs (at, profile_id, agent_id, provider_id, model_id, scope, note)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    Date.now(),
    entry.profileId ?? null,
    entry.agentId ?? null,
    entry.providerId ?? null,
    entry.modelId ?? null,
    entry.scope,
    entry.note ?? null,
  );
}

export function listLogs(limit = 20, db = getDb()) {
  return db
    .prepare(
      `SELECT * FROM switch_logs ORDER BY id DESC LIMIT ?`,
    )
    .all(limit)
    .map((row) => asRecord(row));
}

function toProvider(row: Row): Provider {
  return {
    id: String(row.id),
    name: String(row.name),
    apiKey: String(row.api_key ?? ''),
    websiteUrl: row.website_url ? String(row.website_url) : undefined,
    notes: row.notes ? String(row.notes) : undefined,
    protocols: JSON.parse(String(row.protocols_json || '{}')) as Partial<
      Record<Protocol, ProtocolConfig>
    >,
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  };
}

function toModel(row: Row): ModelRow {
  return {
    id: String(row.id),
    providerId: String(row.provider_id),
    modelId: String(row.model_id),
    alias: row.alias ? String(row.alias) : undefined,
    agentHint: row.agent_hint ? (row.agent_hint as ModelRow['agentHint']) : undefined,
  };
}

function toBinding(row: Row): ProfileBinding {
  return {
    id: String(row.id),
    profileId: String(row.profile_id),
    agentId: row.agent_id as AgentId,
    providerId: String(row.provider_id),
    modelId: String(row.model_id),
    extra: row.extra_json ? (JSON.parse(String(row.extra_json)) as Record<string, unknown>) : undefined,
  };
}

function toProfile(row: Row, bindings: ProfileBinding[]): Profile {
  return {
    id: String(row.id),
    name: String(row.name),
    description: row.description ? String(row.description) : undefined,
    defaultAgent: row.default_agent ? (row.default_agent as AgentId) : undefined,
    sortIndex: Number(row.sort_index ?? 0),
    bindings,
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  };
}

function toMcp(row: Row): McpServer {
  return {
    id: String(row.id),
    name: String(row.name),
    transport: row.transport as McpServer['transport'],
    command: row.command ? String(row.command) : undefined,
    args: JSON.parse(String(row.args_json || '[]')) as string[],
    url: row.url ? String(row.url) : undefined,
    env: JSON.parse(String(row.env_json || '{}')) as Record<string, string>,
    agents: JSON.parse(String(row.agents_json || '[]')) as AgentId[],
  };
}
