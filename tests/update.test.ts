import assert from 'node:assert/strict';
import { test } from 'node:test';
import { UPDATE_REGISTRY, UPDATE_TARBALL, updateNpmArgs } from '../src/cli/update.ts';

test('msw update reinstalls the GitHub tarball in one command', () => {
  const args = updateNpmArgs();
  assert.deepEqual(args, [
    'i',
    '-g',
    UPDATE_TARBALL,
    '--omit=dev',
    '--ignore-scripts',
    `--registry=${UPDATE_REGISTRY}`,
  ]);
  assert.match(UPDATE_TARBALL, /model-switch\/archive\/refs\/heads\/main\.tar\.gz$/);
});
