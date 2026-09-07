#!/usr/bin/env -S node --disable-warning=ExperimentalWarning
'use strict';

const { existsSync } = require('node:fs');
const { join } = require('node:path');
const { pathToFileURL } = require('node:url');
const { execSync, spawn } = require('node:child_process');

const DISABLE_WARNING = '--disable-warning=ExperimentalWarning';

function warningAlreadyDisabled() {
  if (process.execArgv.includes(DISABLE_WARNING) || process.execArgv.includes('--no-warnings')) return true;
  const options = process.env.NODE_OPTIONS || '';
  return options.includes('disable-warning=ExperimentalWarning') || /\b--no-warnings\b/.test(options);
}

function isInteractiveTui() {
  if (!process.stdin.isTTY || !process.stdout.isTTY) return false;
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h') || args.includes('help')) return false;
  return !args.some((item) => !item.startsWith('-'));
}

function restoreTerminal() {
  try {
    if (process.stdin.isTTY) process.stdin.setRawMode(false);
  } catch {}
  try {
    process.stdin.pause();
  } catch {}
  try {
    process.stdout.write('\x1b[?25h\x1b[?1049l\x1b[0m');
  } catch {}
  try {
    execSync('stty sane < /dev/tty', { stdio: 'ignore' });
  } catch {}
}

if (!warningAlreadyDisabled()) {
  const child = spawn(
    process.execPath,
    [DISABLE_WARNING, ...process.execArgv, ...process.argv.slice(1)],
    { stdio: 'inherit' },
  );
  try {
    process.stdin.pause();
    if (typeof process.stdin.unref === 'function') process.stdin.unref();
  } catch {}
  child.on('error', (error) => {
    console.error(error);
    process.exit(1);
  });
  child.on('exit', (code, signal) => {
    restoreTerminal();
    if (signal) {
      try {
        process.kill(process.pid, signal);
      } catch {
        process.exit(1);
      }
      return;
    }
    process.exit(code ?? 0);
  });
} else {
  if (isInteractiveTui()) {
    process.stdout.write('\x1b[?1049h\x1b[?25l');
    process.on('exit', restoreTerminal);
  }

  const cli = join(__dirname, '..', 'dist', 'cli.js');
  if (!existsSync(cli)) {
    restoreTerminal();
    console.error('model-switch: missing dist/cli.js');
    console.error('Reinstall: npm uninstall -g model-switch && npm i -g github:zhoushuai2050/model-switch');
    process.exit(1);
  }

  import(pathToFileURL(cli).href).catch((error) => {
    restoreTerminal();
    console.error(error);
    process.exit(1);
  });
}
