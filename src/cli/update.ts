import { spawn } from 'node:child_process';
import { resolveNpm, resolveNpmInvocation } from '../core/agent-install.ts';
import { EngineError } from '../core/engine.ts';

export { resolveNpm };

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

export async function selfUpdate(): Promise<{ npm: string; args: string[] }> {
  const invocation = resolveNpmInvocation();
  const args = updateNpmArgs();
  await new Promise<void>((resolve, reject) => {
    const child = spawn(invocation.command, [...invocation.prefix, ...args], {
      stdio: 'inherit',
      windowsHide: process.platform === 'win32',
    });
    child.on('error', (error) => reject(error));
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new EngineError(`Update failed (exit ${code ?? 1})`));
    });
  });
  return { npm: [invocation.command, ...invocation.prefix].join(' '), args };
}
