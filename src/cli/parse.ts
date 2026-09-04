export interface Args {
  cmd: string;
  args: string[];
  flags: Record<string, string | boolean | string[]>;
  extra: string[];
}

export function parseArgv(argv: string[]): Args {
  const rest = argv.slice(2);
  const flags: Record<string, string | boolean | string[]> = {};
  const positional: string[] = [];
  const extra: string[] = [];
  for (let i = 0; i < rest.length; i++) {
    const token = rest[i];
    if (token === '--') {
      extra.push(...rest.slice(i + 1));
      break;
    }
    if (token.startsWith('--')) {
      const eq = token.indexOf('=');
      const key = eq === -1 ? token.slice(2) : token.slice(2, eq);
      if (eq !== -1) {
        flags[key] = token.slice(eq + 1);
      } else if (rest[i + 1] && !rest[i + 1].startsWith('-')) {
        flags[key] = rest[++i];
      } else {
        flags[key] = true;
      }
      continue;
    }
    if (token.startsWith('-') && token.length === 2) {
      const key = { p: 'port', k: 'key', a: 'agent', h: 'help' }[token[1]] || token[1];
      if (rest[i + 1] && !rest[i + 1].startsWith('-') && token[1] !== 'h') {
        flags[key] = rest[++i];
      } else {
        flags[key] = true;
      }
      continue;
    }
    positional.push(token);
  }
  return {
    cmd: positional[0] || '',
    args: positional.slice(1),
    flags,
    extra,
  };
}

export function flag(args: Args, name: string, fallback = ''): string {
  const value = args.flags[name];
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value[0] || fallback;
  return fallback;
}

export function flagList(value: string | undefined): string[] {
  if (!value) return [];
  return value.split(',').map((item) => item.trim()).filter(Boolean);
}
