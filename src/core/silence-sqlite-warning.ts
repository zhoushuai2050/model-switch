const emitWarning = process.emitWarning.bind(process) as typeof process.emitWarning & {
  __mswSqliteSilenced?: boolean;
};
if (!emitWarning.__mswSqliteSilenced) {
  const wrapped = ((warning: unknown, ...args: unknown[]) => {
    if (isSqliteExperimentalWarning(warning, args)) return;
    return emitWarning(warning as Parameters<typeof process.emitWarning>[0], ...(args as []));
  }) as typeof process.emitWarning & { __mswSqliteSilenced?: boolean };
  wrapped.__mswSqliteSilenced = true;
  process.emitWarning = wrapped;

  const emit = process.emit.bind(process) as (...args: unknown[]) => boolean;
  process.emit = ((event: string | symbol, ...args: unknown[]) => {
    if (event === 'warning' && isSqliteExperimentalWarning(args[0], args.slice(1))) return false;
    return emit(event, ...args);
  }) as typeof process.emit;
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
