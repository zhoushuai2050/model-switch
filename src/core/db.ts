import './silence-sqlite-warning.ts';
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { dbPath } from './paths.ts';
import type {
  AgentId,
  AppState,
  McpServer,
  ModelRow,
  Protocol,
  ProtocolConfig,
  Provider,
} from './types.ts';
import { AGENT_IDS } from './types.ts';

type Row = Record<string, unknown>;
type SqliteDatabase = import('node:sqlite').DatabaseSync;

const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as typeof import('node:sqlite');

let singleton: SqliteDatabase | null = null;

export function openDb(path = dbPath()): SqliteDatabase {
  mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  migrate(db);
  return db;
}

export function getDb(): SqliteDatabase {
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

function migrate(db: SqliteDatabase): void {
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
      sort_order INTEGER NOT NULL DEFAULT 0,
      selected INTEGER NOT NULL DEFAULT 0,
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
    DROP TABLE IF EXISTS profile_bindings;
    DROP TABLE IF EXISTS profiles;
  `);
  ensureModelColumns(db);
}

function tableColumns(db: SqliteDatabase, table: string): string[] {
  return db.prepare(`PRAGMA table_info(${table})`).all().map((row) => String(asRecord(row).name));
}

function ensureModelColumns(db: SqliteDatabase): void {
  const cols = tableColumns(db, 'models');
  if (!cols.includes('sort_order')) {
    db.exec('ALTER TABLE models ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0');
  }
  if (!cols.includes('selected')) {
    db.exec('ALTER TABLE models ADD COLUMN selected INTEGER NOT NULL DEFAULT 0');
  }
  const providers = db.prepare('SELECT id FROM providers').all().map((row) => String(asRecord(row).id));
  for (const providerId of providers) {
    const models = db
      .prepare('SELECT id, sort_order, selected FROM models WHERE provider_id = ? ORDER BY sort_order, model_id')
      .all(providerId)
      .map((row) => asRecord(row));
    if (!models.length) continue;
    const needOrder = models.every((item) => Number(item.sort_order || 0) === 0);
    const hasSelected = models.some((item) => Number(item.selected) === 1);
    models.forEach((item, index) => {
      db.prepare('UPDATE models SET sort_order = ?, selected = ? WHERE id = ?').run(
        needOrder ? index : Number(item.sort_order || 0),
        Number(item.selected) === 1 || (!hasSelected && index === 0) ? 1 : 0,
        String(item.id),
      );
    });
  }
}

function asRecord(row: unknown): Row {
  return row as Row;
}

export function listProviders(db = getDb()): Provider[] {
  return db.prepare('SELECT * FROM providers ORDER BY created_at ASC, rowid ASC').all().map((row) => toProvider(asRecord(row)));
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
  db.prepare('DELETE FROM providers WHERE id = ?').run(id);
}

export function listModels(db = getDb()): ModelRow[] {
  return db.prepare('SELECT * FROM models ORDER BY provider_id, sort_order, model_id').all().map((row) => toModel(asRecord(row)));
}

export function modelsForProvider(providerId: string, db = getDb()): ModelRow[] {
  return db
    .prepare('SELECT * FROM models WHERE provider_id = ? ORDER BY sort_order, model_id')
    .all(providerId)
    .map((row) => toModel(asRecord(row)));
}

export function upsertModel(model: ModelRow, db = getDb()): void {
  db.prepare(
    `INSERT INTO models (id, provider_id, model_id, alias, agent_hint, sort_order, selected)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       provider_id = excluded.provider_id,
       model_id = excluded.model_id,
       alias = excluded.alias,
       agent_hint = excluded.agent_hint,
       sort_order = excluded.sort_order,
       selected = excluded.selected`,
  ).run(
    model.id,
    model.providerId,
    model.modelId,
    model.alias ?? null,
    model.agentHint ?? null,
    model.sortOrder ?? 0,
    model.selected ? 1 : 0,
  );
}

export function nextModelSortOrder(providerId: string, db = getDb()): number {
  const row = asRecord(db.prepare('SELECT MAX(sort_order) AS max_sort FROM models WHERE provider_id = ?').get(providerId) || {});
  const max = Number(row.max_sort);
  return Number.isFinite(max) ? max + 1 : 0;
}

export function setSelectedModel(providerId: string, modelRowId: string, db = getDb()): void {
  db.prepare(
    'UPDATE models SET selected = CASE WHEN id = ? THEN 1 ELSE 0 END WHERE provider_id = ?',
  ).run(modelRowId, providerId);
}

export function deleteModel(id: string, db = getDb()): void {
  db.prepare('DELETE FROM models WHERE id = ?').run(id);
}

export function deleteModelsForProvider(providerId: string, db = getDb()): void {
  db.prepare('DELETE FROM models WHERE provider_id = ?').run(providerId);
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
    currentModels,
  };
}

export function setState(patch: Partial<AppState>, db = getDb()): AppState {
  const current = getState(db);
  const next: AppState = {
    currentAgent: patch.currentAgent ?? current.currentAgent,
    currentModels: patch.currentModels ? { ...current.currentModels, ...patch.currentModels } : current.currentModels,
  };
  writeState('current_agent', next.currentAgent ?? '');
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
    null,
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
    sortOrder: Number(row.sort_order || 0),
    selected: Number(row.selected) === 1,
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
