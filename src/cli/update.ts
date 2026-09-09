import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { findBinary } from '../adapters/which.ts';
import { EngineError } from '../core/engine.ts';

export const UPDATE_TARBALL =
  'https://github.com/zhoushuai2050/model-switch/archive/refs/heads/main.tar.gz';
export const UPDATE_REGISTRY = 'https://registry.npmjs.org/';

export function updateNpmArgs(): string[] {
  return [
    'i',
    '-g',
    UPDATE_TARBALL,
    '--omit=dev',
    '--ignore-scripts',
    `--registry=${UPDATE_REGISTRY}`,
  ];
}

export function resolveNpm(): string {
  const sibling = join(dirname(process.execPath), process.platform === 'win32' ? 'npm.cmd' : 'npm');
  if (existsSync(sibling)) return sibling;
  return findBinary(['npm']) || 'npm';
}

export async function selfUpdate(): Promise<{ npm: string; args: string[] }> {
  const npm = resolveNpm();
  const args = updateNpmArgs();
  await new Promise<void>((resolve, reject) => {
    const child = spawn(npm, args, {
      stdio: 'inherit',
      shell: process.platform === 'win32',
    });
    child.on('error', (error) => reject(error));
    child.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new EngineError(`Update failed (exit ${code ?? 1})`));
    });
  });
  return { npm, args };
}
