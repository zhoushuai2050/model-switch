const emitWarning = process.emitWarning.bind(process);
if (!emitWarning.__mswSqliteSilenced) {
    const wrapped = ((warning, ...args) => {
        if (isSqliteExperimentalWarning(warning, args))
            return;
        return emitWarning(warning, ...args);
    });
    wrapped.__mswSqliteSilenced = true;
    process.emitWarning = wrapped;
    const emit = process.emit.bind(process);
    process.emit = ((event, ...args) => {
        if (event === 'warning' && isSqliteExperimentalWarning(args[0], args.slice(1)))
            return false;
        return emit(event, ...args);
    });
}
function isSqliteExperimentalWarning(warning, args) {
    const parts = [];
    const push = (value) => {
        if (value == null)
            return;
        if (typeof value === 'string') {
            parts.push(value);
            return;
        }
        if (typeof value === 'object') {
            const obj = value;
            for (const key of ['name', 'type', 'message', 'code']) {
                if (obj[key] != null)
                    parts.push(String(obj[key]));
            }
        }
    };
    push(warning);
    for (const arg of args)
        push(arg);
    const text = parts.join(' ');
    return /ExperimentalWarning/i.test(text) && /SQLite/i.test(text);
}
export {};
