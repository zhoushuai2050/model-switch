# Model Switch

各种 Agent 的大模型配置与切换器。管理台负责配置，终端负责秒切。

支持 **Claude Code**、**Codex**、**Gemini CLI**、**OpenCode**。

## 快速开始

需要 **Node.js 22+**。本工具是本机 CLI，不用编译、不用注册账号。

推荐先克隆到固定目录，再全局安装。不要用 `npm i -g github:...`：部分 npm 会链到临时 git 目录，装完文件就没了。

```bash
cd ~
git clone https://github.com/zhoushuai2050/model-switch.git ~/.model-switch/app
cd ~/.model-switch/app
npm i -g . --omit=dev --ignore-scripts \
  --registry=https://registry.npmjs.org/ \
  --replace-registry-host=never
hash -r
msw init
msw status
```

更新：

```bash
cd ~/.model-switch/app
git pull
npm i -g . --omit=dev --ignore-scripts \
  --registry=https://registry.npmjs.org/ \
  --replace-registry-host=never
hash -r
msw help
```

如果你是直接从仓库目录里的 `bin/msw` 运行，`git pull` 不会自动更新依赖；请额外执行：

```bash
cd ~/.model-switch/app
npm install --omit=dev --ignore-scripts \
  --registry=https://registry.npmjs.org/ \
  --replace-registry-host=never
```

其中 `undici` 用于在设置 `HTTP_PROXY` / `HTTPS_PROXY` 时让管理台测通请求复用代理。未配置代理时，程序也可以回退到 Node.js 内置 `fetch`；配置了代理则需要确保依赖已经安装。

也可以只克隆、不全局安装：

```bash
git clone https://github.com/zhoushuai2050/model-switch.git
cd model-switch
npm install \
  --registry=https://registry.npmjs.org/ \
  --replace-registry-host=never
node dist/cli.js init
```

加一个渠道并切过去（预设或自定义中转二选一）：

```bash
# 预设，例如 Kimi / DeepSeek
msw provider add kimi --key sk-xxx
msw use kimi

# 或自定义中转（Codex 用）
msw provider add custom   --name agentrouter   --key sk-xxx   --base-url https://agentrouter.org/v1   --wire-api responses   --models gpt-5.6-sol,deepseek-v4-flash

msw use agentrouter
msw status
```

然后**新开终端**再启动 `codex` / `claude`。在 Codex 里用 `/model` 切换该渠道下的模型。

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

浏览器打开本机页面：导入现有配置、添加供应商、一键切换 Profile、测通、同步 MCP。测通会使用当前 Agent 的协议和第一个配置模型，随机生成一条简短提示词实际发送，并显示接口返回内容；这会消耗少量上游 Token。

顶部切换 Claude / Codex / Gemini / OpenCode 后，只显示当前 Agent 能用的供应商卡片。卡片上的 OpenAI / Anthropic / Gemini 标签表示已配置对应地址，测通也只测当前 Agent 的协议。

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
msw ping kimi           # 随机生成一条提示词实际发测试消息
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
