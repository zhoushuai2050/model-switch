export const AGENT_IDS = ['claude', 'codex', 'gemini', 'opencode'];
export const PROTOCOLS = ['openai', 'anthropic', 'gemini'];
export function isAgentId(value) {
    return AGENT_IDS.includes(value);
}
export function now() {
    return Date.now();
}
export function slug(value) {
    const s = value
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
    return s || 'item';
}
