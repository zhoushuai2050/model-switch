#!/usr/bin/env node
'use strict';

const { existsSync, lstatSync, mkdirSync, symlinkSync } = require('node:fs');
const { join } = require('node:path');

const prefix = process.env.npm_config_prefix;
const isGlobal = String(process.env.npm_config_global) === 'true';
const target = join(__dirname, 'msw.cjs');
if (!isGlobal || !prefix || !existsSync(target)) process.exit(0);

const binDir = join(prefix, 'bin');
mkdirSync(binDir, { recursive: true });

for (const name of ['msw', 'model-switch']) {
  const link = join(binDir, name);
  try {
    lstatSync(link);
    continue;
  } catch {
    try {
      symlinkSync(target, link);
    } catch {
      // ignore permission / policy errors
    }
  }
}

const linked = join(binDir, 'msw');
if (existsSync(linked)) {
  console.log(`[model-switch] ${linked}`);
} else {
  console.log(`[model-switch] msw was not linked. Add to PATH or run:`);
  console.log(`  export PATH="${binDir}:$PATH"`);
  console.log(`  node "${target}" help`);
}
