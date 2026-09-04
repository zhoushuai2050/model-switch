import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getTable, getTopLevel, setTopLevel, upsertTable } from '../src/core/toml.ts';

test('setTopLevel inserts before tables and preserves projects', () => {
  const src = `model = "old"
model_provider = "crs"
approval_policy = "never"

[model_providers.crs]
base_url = "http://127.0.0.1:8000/v1"
name = "crs"

[projects."/tmp"]
trust_level = "trusted"
`;
  let next = setTopLevel(src, 'model', 'kimi-k2.5');
  next = setTopLevel(next, 'model_provider', 'kimi');
  next = upsertTable(next, 'model_providers.kimi', {
    name: 'Moonshot Kimi',
    base_url: 'https://api.moonshot.cn/v1',
    wire_api: 'chat',
  });
  assert.equal(getTopLevel(next, 'model'), 'kimi-k2.5');
  assert.equal(getTopLevel(next, 'model_provider'), 'kimi');
  assert.equal(getTopLevel(next, 'approval_policy'), 'never');
  assert.match(next, /\[projects\."\/tmp"\]/);
  assert.equal(getTable(next, 'model_providers.kimi')?.base_url, 'https://api.moonshot.cn/v1');
  assert.equal(getTable(next, 'model_providers.crs')?.name, 'crs');
});
