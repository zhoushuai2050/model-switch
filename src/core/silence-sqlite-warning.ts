const original = process.emitWarning.bind(process);
const patched = process.emitWarning as typeof process.emitWarning & { __mswSqliteSilenced?: boolean };
if (!patched.__mswSqliteSilenced) {
  const emitWarning = ((warning: unknown, ...args: unknown[]) => {
    if (isSqliteExperimentalWarning(warning, args)) return;
    return original(warning as Parameters<typeof process.emitWarning>[0], ...(args as []));
  }) as typeof process.emitWarning & { __mswSqliteSilenced?: boolean };
  emitWarning.__mswSqliteSilenced = true;
  process.emitWarning = emitWarning;
}

function isSqliteExperimentalWarning(warning: unknown, args: unknown[]): boolean {
  const parts: string[] = [];
  const push = (value: unknown) => {
    if (value == null) return;
    if (typeof value === 'string') {
      parts.push(value);
      return;
    }
    if (typeof value === 'object') {
      const obj = value as { name?: unknown; message?: unknown; type?: unknown; code?: unknown };
      for (const key of ['name', 'type', 'message', 'code'] as const) {
        if (obj[key] != null) parts.push(String(obj[key]));
      }
    }
  };
  push(warning);
  for (const arg of args) push(arg);
  const text = parts.join(' ');
  return /ExperimentalWarning/i.test(text) && /SQLite/i.test(text);
}
