export function parseEnv(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

export function stringifyEnv(values: Record<string, string>, original?: string): string {
  const existing = original ? parseEnv(original) : {};
  const keys = new Set([...Object.keys(existing), ...Object.keys(values)]);
  const seen = new Set<string>();
  const lines: string[] = [];
  if (original) {
    for (const raw of original.split(/\r?\n/)) {
      const trimmed = raw.trim();
      if (!trimmed || trimmed.startsWith('#')) {
        lines.push(raw);
        continue;
      }
      const eq = trimmed.indexOf('=');
      const key = eq === -1 ? trimmed : trimmed.slice(0, eq).trim();
      if (key in values) {
        lines.push(`${key}=${escapeEnv(values[key])}`);
        seen.add(key);
      } else {
        lines.push(raw);
        seen.add(key);
      }
    }
  }
  for (const key of keys) {
    if (seen.has(key) || !(key in values)) continue;
    lines.push(`${key}=${escapeEnv(values[key])}`);
  }
  let text = lines.join('\n');
  if (!text.endsWith('\n')) text += '\n';
  return text;
}

function escapeEnv(value: string): string {
  if (/[\s#"']/.test(value)) return JSON.stringify(value);
  return value;
}
