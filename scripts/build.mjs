import { chmodSync, cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const distCli = join(root, 'dist', 'cli.js');
const require = createRequire(join(root, 'package.json'));

function resolveTsc() {
  const local = join(root, 'node_modules', 'typescript', 'bin', 'tsc');
  if (existsSync(local)) return local;
  try {
    return join(dirname(require.resolve('typescript/package.json')), 'bin', 'tsc');
  } catch {
    return existsSync('tsc') ? 'tsc' : '';
  }
}

function copyWeb() {
  mkdirSync(join(root, 'dist'), { recursive: true });
  cpSync(join(root, 'src', 'web'), join(root, 'dist', 'web'), { recursive: true });
}

function chmodBins() {
  for (const rel of ['dist/cli.js', 'bin/msw.cjs', 'bin/msw']) {
    const file = join(root, rel);
    if (!existsSync(file)) continue;
    if (rel === 'dist/cli.js') {
      let code = readFileSync(file, 'utf8');
      if (!code.startsWith('#!')) {
        writeFileSync(file, '#!/usr/bin/env node\n' + code);
      }
    }
    chmodSync(file, 0o755);
  }
}


const tsc = resolveTsc();
if (!tsc) {
  if (existsSync(distCli)) {
    copyWeb();
    chmodBins();
    console.log('typescript not found, using committed dist/');
    process.exit(0);
  }
  console.error('typescript is required to build. Run: npm install');
  process.exit(1);
}

const result = spawnSync(process.execPath, [tsc, '-p', 'tsconfig.json'], {
  cwd: root,
  stdio: 'inherit',
});
if (result.status) process.exit(result.status ?? 1);
copyWeb();
chmodBins();
console.log('built dist/');
