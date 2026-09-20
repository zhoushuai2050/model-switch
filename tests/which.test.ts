import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { executableExts, findBinary } from '../src/adapters/which.ts';

test('executableExts skips extensionless files on Windows', () => {
  assert.deepEqual(executableExts('linux'), ['']);
  const win = executableExts('win32', '.COM;.EXE;.BAT;.CMD;.VBS');
  assert.equal(win[0], '.exe');
  assert.ok(win.includes('.cmd'));
  assert.ok(!win.includes(''));
});

test('findBinary prefers Windows .cmd over a Unix shim', () => {
  const dir = mkdtempSync(join(tmpdir(), 'msw-which-'));
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'codex'), '#!/usr/bin/env node\n');
  writeFileSync(join(dir, 'codex.cmd'), '@echo off\n');
  const found = findBinary(['codex'], {
    platform: 'win32',
    path: dir,
    pathext: '.EXE;.CMD;.BAT',
  });
  assert.equal(found, join(dir, 'codex.cmd'));
});

test('findBinary prefers Windows .exe over .cmd', () => {
  const dir = mkdtempSync(join(tmpdir(), 'msw-which-exe-'));
  writeFileSync(join(dir, 'claude.cmd'), '@echo off\n');
  writeFileSync(join(dir, 'claude.exe'), 'exe');
  const found = findBinary(['claude'], {
    platform: 'win32',
    path: dir,
    pathext: '.EXE;.CMD;.BAT',
  });
  assert.equal(found, join(dir, 'claude.exe'));
});
