import "./silence-sqlite-warning.js";
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { dbPath } from "./paths.js";
import { AGENT_IDS } from "./types.js";
let singleton = null;
export function openDb(path = dbPath()) {
    mkdirSync(dirname(path), { recursive: true });
    const db = new DatabaseSync(path);
    db.exec('PRAGMA journal_mode = WAL');
    db.exec('PRAGMA foreign_keys = ON');
    migrate(db);
    return db;
}
export function getDb() {
    if (!singleton)
        singleton = openDb();
    return singleton;
}
export function resetDbCache() {
    if (singleton) {
        try {
            singleton.close();
        }
        catch {
            // ignore
        }
    }
    singleton = null;
}
function migrate(db) {
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
function asRecord(row) {
    return row;
}
export function listProviders(db = getDb()) {
    return db.prepare('SELECT * FROM providers ORDER BY name').all().map((row) => toProvider(asRecord(row)));
}
export function getProvider(id, db = getDb()) {
    const row = db.prepare('SELECT * FROM providers WHERE id = ?').get(id);
    return row ? toProvider(asRecord(row)) : undefined;
}
export function upsertProvider(provider, db = getDb()) {
    db.prepare(`INSERT INTO providers (id, name, api_key, website_url, notes, protocols_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       name = excluded.name,
       api_key = excluded.api_key,
       website_url = excluded.website_url,
       notes = excluded.notes,
       protocols_json = excluded.protocols_json,
       updated_at = excluded.updated_at`).run(provider.id, provider.name, provider.apiKey, provider.websiteUrl ?? null, provider.notes ?? null, JSON.stringify(provider.protocols), provider.createdAt, provider.updatedAt);
}
export function deleteProvider(id, db = getDb()) {
    db.prepare('DELETE FROM models WHERE provider_id = ?').run(id);
    db.prepare('DELETE FROM profile_bindings WHERE provider_id = ?').run(id);
    db.prepare('DELETE FROM providers WHERE id = ?').run(id);
}
export function listModels(db = getDb()) {
    return db.prepare('SELECT * FROM models ORDER BY model_id').all().map((row) => toModel(asRecord(row)));
}
export function modelsForProvider(providerId, db = getDb()) {
    return db
        .prepare('SELECT * FROM models WHERE provider_id = ? ORDER BY model_id')
        .all(providerId)
        .map((row) => toModel(asRecord(row)));
}
export function upsertModel(model, db = getDb()) {
    db.prepare(`INSERT INTO models (id, provider_id, model_id, alias, agent_hint)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       provider_id = excluded.provider_id,
       model_id = excluded.model_id,
       alias = excluded.alias,
       agent_hint = excluded.agent_hint`).run(model.id, model.providerId, model.modelId, model.alias ?? null, model.agentHint ?? null);
}
export function deleteModelsForProvider(providerId, db = getDb()) {
    db.prepare('DELETE FROM models WHERE provider_id = ?').run(providerId);
}
export function listProfiles(db = getDb()) {
    const profiles = db.prepare('SELECT * FROM profiles ORDER BY sort_index, name').all().map((row) => asRecord(row));
    const bindings = db.prepare('SELECT * FROM profile_bindings').all().map((row) => toBinding(asRecord(row)));
    return profiles.map((row) => toProfile(row, bindings.filter((b) => b.profileId === row.id)));
}
export function getProfile(id, db = getDb()) {
    const row = db.prepare('SELECT * FROM profiles WHERE id = ?').get(id);
    if (!row)
        return undefined;
    const bindings = db
        .prepare('SELECT * FROM profile_bindings WHERE profile_id = ?')
        .all(id)
        .map((item) => toBinding(asRecord(item)));
    return toProfile(asRecord(row), bindings);
}
export function upsertProfile(profile, db = getDb()) {
    db.prepare(`INSERT INTO profiles (id, name, description, default_agent, sort_index, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       name = excluded.name,
       description = excluded.description,
       default_agent = excluded.default_agent,
       sort_index = excluded.sort_index,
       updated_at = excluded.updated_at`).run(profile.id, profile.name, profile.description ?? null, profile.defaultAgent ?? null, profile.sortIndex, profile.createdAt, profile.updatedAt);
}
export function deleteProfile(id, db = getDb()) {
    db.prepare('DELETE FROM profile_bindings WHERE profile_id = ?').run(id);
    db.prepare('DELETE FROM profiles WHERE id = ?').run(id);
}
export function upsertBinding(binding, db = getDb()) {
    db.prepare(`INSERT INTO profile_bindings (id, profile_id, agent_id, provider_id, model_id, extra_json)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(profile_id, agent_id) DO UPDATE SET
       provider_id = excluded.provider_id,
       model_id = excluded.model_id,
       extra_json = excluded.extra_json`).run(binding.id, binding.profileId, binding.agentId, binding.providerId, binding.modelId, binding.extra ? JSON.stringify(binding.extra) : null);
}
export function deleteBinding(profileId, agentId, db = getDb()) {
    db.prepare('DELETE FROM profile_bindings WHERE profile_id = ? AND agent_id = ?').run(profileId, agentId);
}
export function listMcp(db = getDb()) {
    return db.prepare('SELECT * FROM mcp_servers ORDER BY name').all().map((row) => toMcp(asRecord(row)));
}
export function upsertMcp(server, db = getDb()) {
    db.prepare(`INSERT INTO mcp_servers (id, name, transport, command, args_json, url, env_json, agents_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       name = excluded.name,
       transport = excluded.transport,
       command = excluded.command,
       args_json = excluded.args_json,
       url = excluded.url,
       env_json = excluded.env_json,
       agents_json = excluded.agents_json`).run(server.id, server.name, server.transport, server.command ?? null, JSON.stringify(server.args), server.url ?? null, JSON.stringify(server.env), JSON.stringify(server.agents));
}
export function deleteMcp(id, db = getDb()) {
    db.prepare('DELETE FROM mcp_servers WHERE id = ?').run(id);
}
export function getState(db = getDb()) {
    const rows = db.prepare('SELECT key, value FROM app_state').all().map((row) => asRecord(row));
    const map = Object.fromEntries(rows.map((row) => [String(row.key), String(row.value)]));
    let currentModels = {};
    if (map.current_models) {
        try {
            currentModels = JSON.parse(map.current_models);
        }
        catch {
            currentModels = {};
        }
    }
    const currentAgent = AGENT_IDS.includes(map.current_agent)
        ? map.current_agent
        : undefined;
    return {
        currentAgent,
        currentProfile: map.current_profile || undefined,
        currentModels,
    };
}
export function setState(patch, db = getDb()) {
    const current = getState(db);
    const next = {
        currentAgent: patch.currentAgent ?? current.currentAgent,
        currentProfile: patch.currentProfile === undefined ? current.currentProfile : patch.currentProfile,
        currentModels: patch.currentModels ? { ...current.currentModels, ...patch.currentModels } : current.currentModels,
    };
    writeState('current_agent', next.currentAgent ?? '');
    writeState('current_profile', next.currentProfile ?? '');
    writeState('current_models', JSON.stringify(next.currentModels));
    return next;
}
function writeState(key, value, db = getDb()) {
    db.prepare(`INSERT INTO app_state (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(key, value);
}
export function logSwitch(entry, db = getDb()) {
    db.prepare(`INSERT INTO switch_logs (at, profile_id, agent_id, provider_id, model_id, scope, note)
     VALUES (?, ?, ?, ?, ?, ?, ?)`).run(Date.now(), entry.profileId ?? null, entry.agentId ?? null, entry.providerId ?? null, entry.modelId ?? null, entry.scope, entry.note ?? null);
}
export function listLogs(limit = 20, db = getDb()) {
    return db
        .prepare(`SELECT * FROM switch_logs ORDER BY id DESC LIMIT ?`)
        .all(limit)
        .map((row) => asRecord(row));
}
function toProvider(row) {
    return {
        id: String(row.id),
        name: String(row.name),
        apiKey: String(row.api_key ?? ''),
        websiteUrl: row.website_url ? String(row.website_url) : undefined,
        notes: row.notes ? String(row.notes) : undefined,
        protocols: JSON.parse(String(row.protocols_json || '{}')),
        createdAt: Number(row.created_at),
        updatedAt: Number(row.updated_at),
    };
}
function toModel(row) {
    return {
        id: String(row.id),
        providerId: String(row.provider_id),
        modelId: String(row.model_id),
        alias: row.alias ? String(row.alias) : undefined,
        agentHint: row.agent_hint ? row.agent_hint : undefined,
    };
}
function toBinding(row) {
    return {
        id: String(row.id),
        profileId: String(row.profile_id),
        agentId: row.agent_id,
        providerId: String(row.provider_id),
        modelId: String(row.model_id),
        extra: row.extra_json ? JSON.parse(String(row.extra_json)) : undefined,
    };
}
function toProfile(row, bindings) {
    return {
        id: String(row.id),
        name: String(row.name),
        description: row.description ? String(row.description) : undefined,
        defaultAgent: row.default_agent ? row.default_agent : undefined,
        sortIndex: Number(row.sort_index ?? 0),
        bindings,
        createdAt: Number(row.created_at),
        updatedAt: Number(row.updated_at),
    };
}
function toMcp(row) {
    return {
        id: String(row.id),
        name: String(row.name),
        transport: row.transport,
        command: row.command ? String(row.command) : undefined,
        args: JSON.parse(String(row.args_json || '[]')),
        url: row.url ? String(row.url) : undefined,
        env: JSON.parse(String(row.env_json || '{}')),
        agents: JSON.parse(String(row.agents_json || '[]')),
    };
}
