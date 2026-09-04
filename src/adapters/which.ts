import { existsSync } from 'node:fs';
import { delimiter, join } from 'node:path';

export function findBinary(names: string[]): string | undefined {
  const paths = (process.env.PATH || '').split(delimiter);
  const exts = process.platform === 'win32' ? ['', '.cmd', '.exe', '.bat'] : [''];
  for (const name of names) {
    if (name.includes('/') || name.includes('\\')) {
      if (existsSync(name)) return name;
      continue;
    }
    for (const dir of paths) {
      for (const ext of exts) {
        const candidate = join(dir, name + ext);
        if (existsSync(candidate)) return candidate;
      }
    }
  }
  return undefined;
}
