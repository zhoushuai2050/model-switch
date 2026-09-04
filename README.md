# Model Switch

各种 Agent 的大模型配置与切换器。管理台负责配置，终端负责秒切。

支持 **Claude Code**、**Codex**、**Gemini CLI**、**OpenCode**。

## 快速开始

需要 Node.js 22+。

```bash
cd model-switch
node src/cli.ts init
node src/cli.ts provider add kimi --key sk-xxx
node src/cli.ts agent codex
node src/cli.ts use kimi
node src/cli.ts status
```

安装到 PATH：

```bash
npm link
msw status
```

## 终端切换

```bash
msw                     # TUI
msw use kimi            # 切 Profile / 供应商
msw use codex:kimi-k2.5 # 只切 Codex 的模型
msw model glm-4.7       # 当前 Agent 换模型
msw run                 # 用当前配置启动
msw run --profile cheap # 仅本次进程生效
msw serve               # 打开 http://127.0.0.1:8787
```

Shell 提示符：

```bash
# zsh/bash
export PS1='$(msw prompt 2>/dev/null) '"$PS1"
```

## 管理台

```bash
msw serve --port 8787
```

浏览器打开本机页面：导入现有配置、添加供应商、一键切换 Profile、测通、同步 MCP。

## 数据

| 路径 | 用途 |
|---|---|
| `~/.model-switch/model-switch.db` | 唯一真相源（SQLite） |
| `~/.model-switch/backups/` | live 配置备份，每个 Agent 保留 10 份 |
| Codex live | `$CODEX_HOME/config.toml`、`auth.json` |
| Claude live | `~/.claude/settings.json` |
| Gemini live | `~/.gemini/.env` |
| OpenCode live | `~/.config/opencode/opencode.json` |

切换时做原子写，不会抹掉 Codex 的 `[projects]` 等无关段落。

## 常用命令

```bash
msw provider presets
msw provider add deepseek --key sk-xxx
msw provider add custom --name local --base-url http://127.0.0.1:8000/v1 --key sk-local --wire-api responses --models grok-4.6
msw profile add work
msw profile bind work --agent codex --provider kimi --model kimi-k2.5
msw mcp add --name filesystem --command npx --args -y,@modelcontextprotocol/server-filesystem
msw mcp sync
msw ping kimi
msw doctor
msw help custom
```

内置预设：OpenAI、Anthropic、DeepSeek、Kimi、GLM、Qwen、SiliconFlow、OpenRouter、MiniMax、Groq。

## 完全自定义中转

把中转站配成一个 Provider，然后 `msw use <名字>` 切换。至少要有：名字、Key、地址、模型。

终端里同样可以看：`msw help custom`。

### 只给 Codex 用

```bash
msw provider add custom \
  --name local \
  --key sk-xxx \
  --base-url http://127.0.0.1:8000/v1 \
  --wire-api responses \
  --models grok-4.6

msw use local
```

Codex 新版本只认 `wire_api = "responses"`，旧的 `chat` 会在切换时自动改掉。`--base-url` 一般要带到 `/v1`。

### 同一家中转给 Codex + Claude

```bash
msw provider add custom \
  --name packy \
  --key sk-xxx \
  --base-url https://relay.example.com/v1 \
  --anthropic-url https://relay.example.com \
  --wire-api responses \
  --models claude-sonnet-4-6,gpt-4.1

msw use packy
msw use claude:packy
msw use codex:gpt-4.1
```

Codex 看 `--base-url`，Claude Code 看 `--anthropic-url`（按中转文档的 `ANTHROPIC_BASE_URL` 原样填）。

### 只给 Claude Code

```bash
msw provider add custom \
  --name cc-relay \
  --key sk-xxx \
  --anthropic-url https://relay.example.com \
  --models claude-sonnet-4-6

msw use claude:cc-relay
```

### 常用参数

- `--name` 名字，同时当 id，之后 `msw use <name>`
- `--key` API Key
- `--base-url` OpenAI 兼容地址（Codex / OpenCode）
- `--anthropic-url` Anthropic 兼容地址（Claude Code）
- `--gemini-url` Gemini 地址；不填则 Gemini 会用 `--base-url`
- `--wire-api` 现已固定为 `responses`（Codex 不再支持 `chat`）
- `--models` 上游真实模型名，逗号分隔；第一项是默认模型

### 配完

```bash
msw ping packy
msw use packy
msw run --profile packy
```

追加模型，不用重新加渠道：

```bash
msw profile bind packy --agent codex --provider packy --model gpt-5.4
msw use packy
```

## 设计

- **Profile**：一次切换可落到多个 Agent
- **全局切换**：改 live 配置
- **会话切换**：`msw run --profile` 只影响本次进程
- **适配器**：新 Agent 实现 `detect / importLive / apply / sessionLaunch` 即可接入
