export const PRESETS = [
    {
        id: 'openai',
        name: 'OpenAI',
        websiteUrl: 'https://platform.openai.com',
        protocols: {
            openai: {
                baseUrl: 'https://api.openai.com/v1',
                wireApi: 'responses',
                authMode: 'openai_auth',
            },
        },
        models: [
            { modelId: 'gpt-5.4', alias: 'gpt' },
            { modelId: 'gpt-4.1' },
        ],
    },
    {
        id: 'anthropic',
        name: 'Anthropic',
        websiteUrl: 'https://console.anthropic.com',
        protocols: {
            anthropic: { baseUrl: 'https://api.anthropic.com', authMode: 'api_key' },
        },
        models: [
            { modelId: 'claude-opus-4-6', alias: 'opus', agentHint: 'claude' },
            { modelId: 'claude-sonnet-4-6', alias: 'sonnet', agentHint: 'claude' },
            { modelId: 'claude-haiku-4-5', alias: 'haiku', agentHint: 'claude' },
        ],
    },
    {
        id: 'deepseek',
        name: 'DeepSeek',
        websiteUrl: 'https://platform.deepseek.com',
        protocols: {
            openai: { baseUrl: 'https://api.deepseek.com/v1', wireApi: 'chat' },
            anthropic: { baseUrl: 'https://api.deepseek.com/anthropic', authMode: 'auth_token' },
        },
        models: [
            { modelId: 'deepseek-chat', alias: 'deepseek' },
            { modelId: 'deepseek-reasoner', alias: 'r1' },
        ],
    },
    {
        id: 'kimi',
        name: 'Moonshot Kimi',
        websiteUrl: 'https://platform.moonshot.cn',
        protocols: {
            openai: { baseUrl: 'https://api.moonshot.cn/v1', wireApi: 'chat' },
            anthropic: { baseUrl: 'https://api.moonshot.cn/anthropic', authMode: 'auth_token' },
        },
        models: [
            { modelId: 'kimi-k2.5', alias: 'kimi' },
            { modelId: 'kimi-k2-thinking', alias: 'kimi-thinking' },
        ],
    },
    {
        id: 'glm',
        name: 'Zhipu GLM',
        websiteUrl: 'https://open.bigmodel.cn',
        protocols: {
            openai: { baseUrl: 'https://open.bigmodel.cn/api/paas/v4', wireApi: 'chat' },
            anthropic: { baseUrl: 'https://open.bigmodel.cn/api/anthropic', authMode: 'auth_token' },
        },
        models: [
            { modelId: 'glm-4.7', alias: 'glm' },
            { modelId: 'glm-4.6' },
        ],
    },
    {
        id: 'qwen',
        name: 'Qwen DashScope',
        websiteUrl: 'https://dashscope.console.aliyun.com',
        protocols: {
            openai: {
                baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
                wireApi: 'chat',
            },
        },
        models: [
            { modelId: 'qwen3-coder-plus', alias: 'qwen' },
            { modelId: 'qwen3-max' },
        ],
    },
    {
        id: 'siliconflow',
        name: 'SiliconFlow',
        websiteUrl: 'https://siliconflow.cn',
        protocols: {
            openai: { baseUrl: 'https://api.siliconflow.cn/v1', wireApi: 'chat' },
        },
        models: [
            { modelId: 'deepseek-ai/DeepSeek-V3.2', alias: 'sf-deepseek' },
            { modelId: 'moonshotai/Kimi-K2-Instruct', alias: 'sf-kimi' },
        ],
    },
    {
        id: 'openrouter',
        name: 'OpenRouter',
        websiteUrl: 'https://openrouter.ai',
        protocols: {
            openai: { baseUrl: 'https://openrouter.ai/api/v1', wireApi: 'chat' },
            anthropic: { baseUrl: 'https://openrouter.ai/api', authMode: 'auth_token' },
        },
        models: [
            { modelId: 'anthropic/claude-sonnet-4.6', alias: 'or-sonnet' },
            { modelId: 'openai/gpt-5.4', alias: 'or-gpt' },
            { modelId: 'moonshotai/kimi-k2', alias: 'or-kimi' },
        ],
    },
    {
        id: 'minimax',
        name: 'MiniMax',
        websiteUrl: 'https://platform.minimax.io',
        protocols: {
            openai: { baseUrl: 'https://api.minimax.io/v1', wireApi: 'chat' },
            anthropic: { baseUrl: 'https://api.minimax.io/anthropic', authMode: 'auth_token' },
        },
        models: [{ modelId: 'MiniMax-M2.5', alias: 'minimax' }],
    },
    {
        id: 'groq',
        name: 'Groq',
        websiteUrl: 'https://console.groq.com',
        protocols: {
            openai: { baseUrl: 'https://api.groq.com/openai/v1', wireApi: 'chat' },
        },
        models: [
            { modelId: 'llama-3.3-70b-versatile', alias: 'groq' },
            { modelId: 'openai/gpt-oss-120b' },
        ],
    },
];
export function getPreset(id) {
    const needle = id.toLowerCase();
    return PRESETS.find((preset) => preset.id === needle || preset.name.toLowerCase() === needle);
}
