export const HELP = `Model Switch — 各种 Agent / 模型的本机切换器

用法:
  msw                         打开终端切换台（按 Agent 筛选供应商，与管理台一致）
  msw status                  查看当前 Agent、模型
  msw ls [providers|agents|models|mcp]
  msw providers               显示所有供应商
  msw use <target>            切换供应商 / 模型
  msw agent <claude|codex|grok-build|gemini|opencode>
  msw agent install [agent]   安装 Agent（npm 全局包）
  msw agent update [agent]    更新到 npm 最新版
  msw model <id>              只切当前 Agent 的模型
  msw run [agent] [--use x] [-- extra]
  msw provider ls             显示所有供应商
  msw provider rm <名称>      删除供应商
  msw provider add <preset> --key <api-key> --agent <claude|codex|grok-build|gemini|opencode>
  msw provider add custom --name <名> --agent <claude|codex|grok-build|gemini|opencode> --base-url <url> --key <key> --models <id>
  msw provider add-model|rm-model|select-model <名> <模型>
  msw provider set-key|ping|presets
  msw mcp add --name <n> --command <cmd>
  msw mcp sync
  msw serve [--port 8787]     打开本机管理台
  msw ping [provider]        通过当前 Agent SDK 测通（不是直连 HTTP）
  msw prompt                  输出 agent/model，供 shell 提示符使用
  msw doctor
  msw log
  msw update                  从 GitHub main 更新到最新版
  msw help
  msw help custom             自定义中转（示例）

切换目标:
  msw use kimi                供应商 kimi
  msw use codex:kimi-k2.5     只切 Codex 到该模型
  msw run --use cheap         仅本次进程生效

数据目录: ~/.model-switch
自定义中转示例: msw help custom
`;

export const HELP_CUSTOM = `完全自定义中转

把中转站配成一个 Provider，然后 msw use <名字> 切换。
至少要有：名字、Key、地址、模型。

供应商按 Agent 隔离：一次只创建一个 Agent 的供应商，不再把两个地址写进同一条供应商。
同一家中转要两边用，就分别加两次。

────────────────────────────────
只给 Codex 用
────────────────────────────────
  msw provider add custom \\
    --name local \\
    --key sk-xxx \\
    --agent codex \\
    --base-url http://127.0.0.1:8000/v1 \\
    --wire-api responses \\
    --models grok-4.6

  msw use local

Codex 新版本只认 wire_api = responses，chat 会在切换时自动改掉。
--base-url 一般要带到 /v1。
密钥写在该供应商自己的 [model_providers] 段里（和 OpenCode 一样），不改全局 auth.json。

────────────────────────────────
只给 Grok Build 用
────────────────────────────────
  msw provider add custom \
    --name local \
    --key sk-xxx \
    --agent grok-build \
    --base-url http://127.0.0.1:8000/v1 \
    --wire-api responses \
    --models grok-4.6

  msw use grok-build:local

Grok Build 写入 ~/.grok/config.toml 的 [model."<id>"]，api_backend 对应 responses / chat_completions。
--base-url 一般要带到 /v1。密钥写在该模型段的 api_key 里。

────────────────────────────────
只给 Claude Code
────────────────────────────────
  msw provider add custom \\
    --name local \\
    --key sk-xxx \\
    --agent claude \\
    --anthropic-url https://relay.example.com \\
    --models grok-4.6

  msw use claude:local

Claude 地址按中转文档里的 ANTHROPIC_BASE_URL 填，不要带末尾 /v1（Claude Code 会再拼 /v1/messages）。
Claude 的 /model 只认 sonnet / opus / haiku；msw 会把真实模型名映射到这些别名。

────────────────────────────────
常用参数
────────────────────────────────
  --agent           claude | codex | grok-build | gemini | opencode；不填则用当前 Agent
  --name            名字，之后 msw use <name>
  --key             API Key
  --base-url        OpenAI 兼容地址（Codex / OpenCode / Grok Build）
  --anthropic-url   Anthropic 兼容地址（Claude Code）
  --gemini-url      Gemini 地址
  --wire-api        现已固定为 responses（Codex 不再支持 chat）
  --models          上游真实模型名，逗号分隔；第一项是默认模型。之后可用 add-model / select-model 管理

────────────────────────────────
配完
────────────────────────────────
  msw ping packy
  msw use packy
  msw run --use packy              # 只这次生效，不改全局

追加 / 选择模型（不用重新加渠道）：
  msw provider add-model packy gpt-5.4
  msw provider select-model packy gpt-5.4
  msw provider rm-model packy gpt-old

测通和启用都使用该供应商当前选中的模型。
`;
