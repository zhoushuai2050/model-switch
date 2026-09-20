import { spawn, type ChildProcess, type SpawnOptions } from 'node:child_process';
import { existsSync } from 'node:fs';
import { delimiter, join } from 'node:path';

export function executableExts(
  platform: string = process.platform,
  pathext = process.env.PATHEXT,
): string[] {
  if (platform !== 'win32') return [''];
  const prefer = ['.exe', '.cmd', '.bat', '.com'];
  const extra = String(pathext || '.EXE;.CMD;.BAT;.COM')
    .split(';')
    .map((item) => item.trim().toLowerCase())
    .filter((item) => item.startsWith('.') && !prefer.includes(item));
  return [...prefer, ...extra];
}

export function findBinary(
  names: string[],
  opts: { platform?: string; path?: string; pathext?: string } = {},
): string | undefined {
  const platform = opts.platform ?? process.platform;
  const paths = (opts.path ?? process.env.PATH ?? '').split(delimiter);
  const exts = executableExts(platform, opts.pathext ?? process.env.PATHEXT);
  for (const name of names) {
    if (name.includes('/') || name.includes('\\') || /^[a-zA-Z]:/.test(name)) {
      if (existsSync(name)) return name;
      continue;
    }
    for (const dir of paths) {
      if (!dir) continue;
      for (const ext of exts) {
        const candidate = join(dir, name + ext);
        if (existsSync(candidate)) return candidate;
      }
    }
  }
  return undefined;
}

export function quoteCmdArg(value: string): string {
  if (!/[\s&<>|^()"]/.test(value)) return value;
  return `"${value.replace(/"/g, '""')}"`;
}

export function windowsCmdLine(command: string, args: string[] = []): string {
  return [command, ...args].map(quoteCmdArg).join(' ');
}

export function spawnBinary(command: string, args: string[], options: SpawnOptions = {}): ChildProcess {
  const win = process.platform === 'win32';
  const script = win && /\.(cmd|bat)$/i.test(command);
  if (script) {
    const comspec = process.env.ComSpec || 'cmd.exe';
    const line = windowsCmdLine(command, args);
    return spawn(comspec, ['/d', '/s', '/c', `"${line}"`], {
      ...options,
      windowsHide: options.windowsHide ?? true,
      windowsVerbatimArguments: true,
    });
  }
  return spawn(command, args, {
    ...options,
    windowsHide: options.windowsHide ?? win,
  });
}
