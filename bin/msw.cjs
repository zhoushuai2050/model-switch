#!/usr/bin/env node
'use strict';

const { existsSync } = require('node:fs');
const { join } = require('node:path');
const { pathToFileURL } = require('node:url');

const cli = join(__dirname, '..', 'dist', 'cli.js');
if (!existsSync(cli)) {
  console.error('model-switch: missing dist/cli.js');
  console.error('Reinstall: npm uninstall -g model-switch && npm i -g github:zhoushuai2050/model-switch');
  process.exit(1);
}

import(pathToFileURL(cli).href).catch((error) => {
  console.error(error);
  process.exit(1);
});
