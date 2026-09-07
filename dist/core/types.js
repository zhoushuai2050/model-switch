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
export function liveProviderKey(providerId, agent) {
    const base = slug(providerId);
    if (agent === 'codex')
        return base.replace(/-/g, '_') || 'custom';
    return base.replace(/-/g, '') || 'custom';
}
export function payloadModelIds(payload) {
    const extra = payload.extra?.models;
    const listed = Array.isArray(extra)
        ? extra.filter((item) => typeof item === 'string' && item.trim().length > 0)
        : [];
    const models = listed.length ? [...listed] : payload.model ? [payload.model] : [];
    if (payload.model && !models.includes(payload.model))
        models.unshift(payload.model);
    return [...new Set(models)];
}
