export const color = {
    dim: (s) => `\x1b[2m${s}\x1b[0m`,
    bold: (s) => `\x1b[1m${s}\x1b[0m`,
    amber: (s) => `\x1b[38;5;214m${s}\x1b[0m`,
    green: (s) => `\x1b[32m${s}\x1b[0m`,
    red: (s) => `\x1b[31m${s}\x1b[0m`,
    cyan: (s) => `\x1b[36m${s}\x1b[0m`,
};
export function printStatus(agents, currentAgent, profileName) {
    console.log(color.bold(color.amber('MODEL SWITCH')));
    if (profileName)
        console.log(`profile  ${color.cyan(profileName)}`);
    if (currentAgent)
        console.log(`agent    ${color.cyan(currentAgent)}`);
    console.log('');
    for (const agent of agents) {
        const mark = agent.id === currentAgent ? color.green('●') : color.dim('○');
        const state = agent.installed ? color.green('ready') : color.dim('no bin');
        const model = agent.model || '-';
        const provider = agent.providerLabel || '-';
        console.log(`${mark} ${agent.id.padEnd(9)} ${state.padEnd(16)} ${model.padEnd(22)} ${color.dim(provider)}`);
    }
}
export function printSwitch(result) {
    const head = result.applied.length ? color.green('switched') : color.red('not switched');
    console.log(`${head}  ${result.applied.join(', ') || '-'}  ${result.model || ''}  (${result.scope})`);
    for (const skip of result.skipped) {
        console.log(color.dim(`  skip ${skip.agentId}: ${skip.reason}`));
    }
}
export function printProviders(providers) {
    if (!providers.length) {
        console.log('No providers. Try: msw provider add kimi --key sk-...');
        return;
    }
    for (const provider of providers) {
        const protocols = Object.keys(provider.protocols).join(',');
        const key = provider.apiKey ? color.green('key') : color.dim('no-key');
        console.log(`${provider.id.padEnd(18)} ${provider.name.padEnd(22)} ${key}  ${color.dim(protocols)}`);
    }
}
export function printProfiles(profiles, current) {
    if (!profiles.length) {
        console.log('No profiles. Run msw provider add.');
        return;
    }
    for (const profile of profiles) {
        const mark = profile.id === current ? color.green('●') : color.dim('○');
        const bindings = profile.bindings.map((b) => `${b.agentId}:${b.modelId}`).join(', ') || 'no bindings';
        console.log(`${mark} ${profile.id.padEnd(18)} ${profile.name.padEnd(20)} ${color.dim(bindings)}`);
    }
}
export function maskKey(key) {
    if (!key)
        return '';
    if (key.length <= 8)
        return '****';
    return `${key.slice(0, 4)}…${key.slice(-4)}`;
}
