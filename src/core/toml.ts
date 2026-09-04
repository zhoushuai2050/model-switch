export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function topLevelText(text: string): string {
  const idx = text.search(/^\[/m);
  return idx === -1 ? text : text.slice(0, idx);
}

export function parseTomlValue(raw: string): string | boolean | number | string[] {
  const value = raw.trim();
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (/^-?\d+(\.\d+)?$/.test(value)) return Number(value);
  if (value.startsWith('[')) {
    const inner = value.slice(1, value.lastIndexOf(']'));
    if (!inner.trim()) return [];
    return splitCsv(inner).map((part) => String(parseTomlValue(part)));
  }
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return JSON.parse(value.startsWith("'") ? `"${value.slice(1, -1)}"` : value);
  }
  return value;
}

function splitCsv(text: string): string[] {
  const parts: string[] = [];
  let current = '';
  let quote: string | null = null;
  for (const ch of text) {
    if (quote) {
      current += ch;
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      current += ch;
      continue;
    }
    if (ch === ',') {
      parts.push(current.trim());
      current = '';
      continue;
    }
    current += ch;
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

export function stringifyTomlValue(value: string | boolean | number | string[]): string {
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') return String(value);
  if (Array.isArray(value)) return `[${value.map((item) => stringifyTomlValue(item)).join(', ')}]`;
  return JSON.stringify(value);
}

export function getTopLevel(text: string, key: string): string | undefined {
  const top = topLevelText(text);
  const match = new RegExp(`^${escapeRegExp(key)}\\s*=\\s*(.+)$`, 'm').exec(top);
  if (!match) return undefined;
  return String(parseTomlValue(stripComment(match[1])));
}

export function setTopLevel(
  text: string,
  key: string,
  value: string | boolean | number,
): string {
  const line = `${key} = ${stringifyTomlValue(value)}`;
  const top = topLevelText(text);
  const rest = text.slice(top.length);
  const re = new RegExp(`^${escapeRegExp(key)}\\s*=\\s*.*$`, 'm');
  if (re.test(top)) {
    return top.replace(re, line) + rest;
  }
  const trimmed = top.replace(/\s*$/, '');
  const inserted = trimmed ? `${trimmed}\n${line}\n` : `${line}\n`;
  return inserted + (rest.startsWith('\n') || rest.length === 0 ? rest : `\n${rest}`);
}

export function findTableSpan(text: string, header: string): { start: number; end: number } | null {
  const re = new RegExp(`^\\[${escapeRegExp(header)}\\][ \\t]*$`, 'm');
  const match = re.exec(text);
  if (!match || match.index === undefined) return null;
  const start = match.index;
  const bodyStart = start + match[0].length;
  const after = text.slice(bodyStart);
  const next = /^\[/m.exec(after);
  const end = next ? bodyStart + next.index : text.length;
  return { start, end };
}

export function getTable(
  text: string,
  header: string,
): Record<string, string | boolean | number | string[]> | undefined {
  const span = findTableSpan(text, header);
  if (!span) return undefined;
  const body = text.slice(span.start, span.end).split('\n').slice(1);
  const out: Record<string, string | boolean | number | string[]> = {};
  for (const raw of body) {
    const line = stripComment(raw).trim();
    if (!line) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    out[line.slice(0, eq).trim()] = parseTomlValue(line.slice(eq + 1));
  }
  return out;
}

export function listTables(text: string, prefix?: string): string[] {
  const names: string[] = [];
  const re = /^\[([^\]]+)\][ \t]*$/gm;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text))) {
    const name = match[1];
    if (!prefix || name === prefix || name.startsWith(`${prefix}.`)) names.push(name);
  }
  return names;
}

export function upsertTable(
  text: string,
  header: string,
  entries: Record<string, string | boolean | number | string[] | undefined>,
): string {
  const lines = [`[${header}]`];
  for (const [key, value] of Object.entries(entries)) {
    if (value === undefined) continue;
    lines.push(`${key} = ${stringifyTomlValue(value)}`);
  }
  const block = `${lines.join('\n')}\n`;
  const span = findTableSpan(text, header);
  if (!span) {
    const trimmed = text.replace(/\s*$/, '');
    return trimmed ? `${trimmed}\n\n${block}` : block;
  }
  const before = text.slice(0, span.start);
  let after = text.slice(span.end);
  if (after.startsWith('\n')) after = after.slice(1);
  return before + block + after;
}

export function removeTable(text: string, header: string): string {
  const span = findTableSpan(text, header);
  if (!span) return text;
  const before = text.slice(0, span.start);
  let after = text.slice(span.end);
  if (after.startsWith('\n')) after = after.slice(1);
  return before + after;
}

function stripComment(line: string): string {
  let quote: string | null = null;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quote) {
      if (ch === quote && line[i - 1] !== '\\') quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (ch === '#') return line.slice(0, i);
  }
  return line;
}
