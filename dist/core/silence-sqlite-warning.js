const original = process.emitWarning.bind(process);
const patched = process.emitWarning;
if (!patched.__mswSqliteSilenced) {
    const emitWarning = ((warning, ...args) => {
        if (isSqliteExperimentalWarning(warning, args))
            return;
        return original(warning, ...args);
    });
    emitWarning.__mswSqliteSilenced = true;
    process.emitWarning = emitWarning;
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
