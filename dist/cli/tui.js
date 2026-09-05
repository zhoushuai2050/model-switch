import { engine } from "../core/engine.js";
import { color } from "./format.js";
export async function runTui() {
    if (!process.stdin.isTTY || !process.stdout.isTTY) {
        const status = engine.status();
        console.log(`${status.current?.id || 'none'}/${status.current?.model || '-'}`);
        return;
    }
    let col = 1;
    let agentIndex = 0;
    let profileIndex = 0;
    let message = 'Enter 切换 · ←/→ 栏 · r 启动 · q 退出';
    const restore = () => {
        process.stdin.setRawMode(false);
        process.stdout.write('\x1b[?25h\x1b[?1049l');
    };
    process.stdout.write('\x1b[?1049h\x1b[?25l');
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding('utf8');
    const onExit = () => {
        restore();
        process.exit(0);
    };
    process.on('SIGINT', onExit);
    process.on('SIGTERM', onExit);
    const render = () => {
        const status = engine.status();
        const agents = status.agents;
        const profiles = engine.listProfiles();
        if (agentIndex >= agents.length)
            agentIndex = 0;
        if (profileIndex >= profiles.length)
            profileIndex = Math.max(0, profiles.length - 1);
        const lines = buildScreen(agents, profiles, col, agentIndex, profileIndex, status.state.currentAgent, status.state.currentProfile, message);
        process.stdout.write('\x1b[H\x1b[J' + lines.join('\n'));
    };
    render();
    await new Promise((resolve) => {
        process.stdin.on('data', (chunk) => {
            const key = String(chunk);
            if (key === '\u0003' || key === 'q') {
                restore();
                resolve();
                return;
            }
            if (key === '\u001b[A') {
                if (col === 0)
                    agentIndex = Math.max(0, agentIndex - 1);
                else
                    profileIndex = Math.max(0, profileIndex - 1);
            }
            else if (key === '\u001b[B') {
                if (col === 0)
                    agentIndex += 1;
                else
                    profileIndex += 1;
            }
            else if (key === '\u001b[D') {
                col = 0;
            }
            else if (key === '\u001b[C') {
                col = 1;
            }
            else if (key === '\r' || key === '\n') {
                try {
                    if (col === 0) {
                        const agent = engine.listAgents()[agentIndex];
                        if (agent)
                            engine.setAgent(agent.id);
                        message = `当前 Agent: ${agent?.id}`;
                    }
                    else {
                        const profile = engine.listProfiles()[profileIndex];
                        if (profile) {
                            const result = engine.use(profile.id);
                            message = `已切换 ${profile.name} → ${result.applied.join(', ') || '无'} ${result.model || ''}`;
                        }
                    }
                }
                catch (error) {
                    message = error instanceof Error ? error.message : String(error);
                }
            }
            else if (key === 'r') {
                restore();
                const spec = engine.launch();
                engine.spawn(spec);
                resolve();
                return;
            }
            render();
        });
        process.stdout.on('resize', render);
    });
}
function buildScreen(agents, profiles, col, agentIndex, profileIndex, currentAgent, currentProfile, message = '') {
    const width = process.stdout.columns || 80;
    const lines = [];
    lines.push(color.bold(color.amber(' MODEL SWITCH')) + color.dim('  本机 Agent / 模型切换台'));
    lines.push(color.dim('─'.repeat(Math.min(width, 80))));
    lines.push(`${col === 0 ? color.amber('▸ Agents') : color.dim('  Agents')}          ${col === 1 ? color.amber('▸ Profiles') : color.dim('  Profiles')}`);
    const rows = Math.max(agents.length, profiles.length, 4);
    for (let i = 0; i < rows; i++) {
        const agent = agents[i];
        const profile = profiles[i];
        const leftSel = col === 0 && i === agentIndex;
        const rightSel = col === 1 && i === profileIndex;
        const left = agent
            ? formatAgent(agent, currentAgent, leftSel)
            : ' '.repeat(32);
        const right = profile
            ? formatProfile(profile, currentProfile, rightSel)
            : '';
        lines.push(`${left}  ${right}`);
    }
    lines.push(color.dim('─'.repeat(Math.min(width, 80))));
    lines.push(message);
    return lines;
}
function formatAgent(agent, current, selected) {
    const mark = agent.id === current ? '●' : '○';
    const body = `${mark} ${agent.id.padEnd(9)} ${(agent.model || '-').slice(0, 18).padEnd(18)}`;
    const text = selected ? color.bold(color.amber(body)) : body;
    return text.padEnd(48);
}
function formatProfile(profile, current, selected) {
    const mark = profile.id === current ? '●' : '○';
    const models = profile.bindings.map((b) => b.modelId).slice(0, 2).join(',') || '-';
    const body = `${mark} ${profile.name.padEnd(16)} ${models}`;
    return selected ? color.bold(color.amber(body)) : body;
}
