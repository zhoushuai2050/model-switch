import { claudeAdapter } from "./claude.js";
import { codexAdapter } from "./codex.js";
import { geminiAdapter } from "./gemini.js";
import { grokBuildAdapter } from "./grok-build.js";
import { opencodeAdapter } from "./opencode.js";
export const adapters = [claudeAdapter, codexAdapter, grokBuildAdapter, geminiAdapter, opencodeAdapter];
export const adapterMap = {
    claude: claudeAdapter,
    codex: codexAdapter,
    'grok-build': grokBuildAdapter,
    gemini: geminiAdapter,
    opencode: opencodeAdapter,
};
export function getAdapter(id) {
    return adapterMap[id];
}
