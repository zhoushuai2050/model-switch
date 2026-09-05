export const HELP = `Model Switch — 各种 Agent / 模型的本机切换器

用法:
  msw                         打开终端切换台
  msw status                  查看当前 Agent、模型、Profile
  msw ls [agents|providers|profiles|models|mcp]
  msw use <target>            切换 Profile / Provider / 模型
  msw agent <claude|codex|gemini|opencode>
  msw model <id>              只切当前 Agent 的模型
  msw run [agent] [--profile x] [-- extra]
  msw provider add <preset> --key <api-key>
  msw provider add custom --name <名> --base-url <url> --key <key> --models <id>
  msw provider ls|rm|set-key|ping|presets
  msw profile add <name>
  msw profile bind <id> --agent <a> --provider <p> --model <m>
  msw mcp add --name <n> --command <cmd>
  msw mcp sync
  msw serve [--port 8787]     打开本机管理台
  msw ping [provider]
  msw prompt                  输出 agent/model，供 shell 提示符使用
  msw doctor
  msw log
  msw help
  msw help custom             自定义中转（示例）

切换目标:
  msw use kimi                Profile 或供应商 kimi
  msw use codex:kimi-k2.5     只切 Codex 到该模型
  msw use profile:work
  msw run --profile cheap     仅本次进程生效

数据目录: ~/.model-switch
自定义中转示例: msw help custom
`;
export const HELP_CUSTOM = `完全自定义中转

把中转站配成一个 Provider，然后 msw use <名字> 切换。
至少要有：名字、Key、地址、模型。

────────────────────────────────
只给 Codex 用
────────────────────────────────
  msw provider add custom \\
    --name local \\
    --key sk-xxx \\
    --base-url http://127.0.0.1:8000/v1 \\
    --wire-api responses \\
    --models grok-4.6

  msw use local

Codex 新版本只认 wire_api = responses，chat 会在切换时自动改掉。
--base-url 一般要带到 /v1。

────────────────────────────────
同一家中转给 Codex + Claude
────────────────────────────────
  msw provider add custom \\
    --name packy \\
    --key sk-xxx \\
    --base-url https://relay.example.com/v1 \\
    --anthropic-url https://relay.example.com \\
    --wire-api responses \\
    --models claude-sonnet-4-6,gpt-4.1

  msw use packy
  msw use claude:packy
  msw use codex:gpt-4.1

Codex 看 --base-url，Claude Code 看 --anthropic-url。
Claude 地址按中转文档里的 ANTHROPIC_BASE_URL 原样填。

────────────────────────────────
只给 Claude Code
────────────────────────────────
  msw provider add custom \\
    --name cc-relay \\
    --key sk-xxx \\
    --anthropic-url https://relay.example.com \\
    --models claude-sonnet-4-6

  msw use claude:cc-relay

────────────────────────────────
常用参数
────────────────────────────────
  --name            名字，同时当 id，之后 msw use <name>
  --key             API Key
  --base-url        OpenAI 兼容地址（Codex / OpenCode）
  --anthropic-url   Anthropic 兼容地址（Claude Code）
  --gemini-url      Gemini 地址；不填则 Gemini 会用 --base-url
  --wire-api        现已固定为 responses（Codex 不再支持 chat）
  --models          上游真实模型名，逗号分隔；第一项是默认模型

────────────────────────────────
配完
────────────────────────────────
  msw ping packy
  msw use packy
  msw run --profile packy          # 只这次生效，不改全局

追加模型（不用重新加渠道）：
  msw profile bind packy --agent codex --provider packy --model gpt-5.4
  msw use packy
`;
