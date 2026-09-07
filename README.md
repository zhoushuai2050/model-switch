# Model Switch

各种 Agent 的大模型配置与切换器。管理台负责配置，终端负责秒切。

支持 **Claude Code**、**Codex**、**Gemini CLI**、**OpenCode**。

## 快速开始

需要 **Node.js 22+**。本工具是本机 CLI，不用编译、不用注册账号。

从 GitHub 的 tar 包全局安装（Linux / macOS / Windows 同一条命令）。不要 `git clone`，也不要 `npm i -g github:...`：npm 会把全局命令链到临时 git 目录，装完目录被删，`msw` 就坏了。也不要 `npm i -g model-switch`：npm 上这个名字是别人的包。

```bash
npm i -g https://github.com/zhoushuai2050/model-switch/archive/refs/heads/main.tar.gz \
  --omit=dev --ignore-scripts \
  --registry=https://registry.npmjs.org/
```

Linux / macOS 再执行 `hash -r`。检查：

```bash
msw help
msw status
```

更新：再装一遍即可，不用在本机留一份仓库。

```bash
npm uninstall -g model-switch
npm i -g https://github.com/zhoushuai2050/model-switch/archive/refs/heads/main.tar.gz \
  --omit=dev --ignore-scripts \
  --registry=https://registry.npmjs.org/
```

`--omit=dev` 不装 TypeScript；`--ignore-scripts` 跳过构建（包里已带 `dist/`）。依赖 `undici` 会从 npm 安装，给管理台测通走 `HTTP_PROXY` / `HTTPS_PROXY`；没配代理时回退到 Node 内置 `fetch`。

### 系统支持

| | Linux / macOS | Windows |
|---|---|---|
| `msw` 命令、管理台、加供应商、`msw use` 写配置 | 支持 | 支持 |
| 终端 TUI（`msw`） | 支持 | Windows Terminal 一般可用；退出时 `stty` 无效，老控制台可能残留下一屏状态 |
| `msw run` 直接拉起 Agent | 支持 | 可能失败（`codex.cmd` 等需 `shell`）；建议 `msw use` 后新开终端自己跑 `codex` / `claude` |
| Agent live 路径 | `~/.codex`、`~/.claude`、`~/.gemini`、`~/.config/opencode` | `%USERPROFILE%\.codex` 等；OpenCode 仍写 `%USERPROFILE%\.config\opencode` |

数据始终在 `~/.model-switch/`（Windows 为 `%USERPROFILE%\.model-switch`），和安装位置无关。

只想从源码开发时才 clone：

```bash
git clone https://github.com/zhoushuai2050/model-switch.git
cd model-switch
npm install --registry=https://registry.npmjs.org/
node dist/cli.js status
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
msw provider ls         # 显示所有供应商
msw provider rm kimi    # 删除供应商
msw use kimi            # 切供应商
msw use codex:kimi-k2.5 # 只切 Codex 的模型
msw model glm-4.7       # 当前 Agent 换模型
msw run                 # 用当前配置启动
msw run --use cheap     # 仅本次进程生效
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

浏览器打开本机页面：添加供应商、一键切换、测通、同步 MCP。测通会使用当前 Agent 的协议和第一个配置模型，随机生成一条简短提示词实际发送，并显示接口返回内容；这会消耗少量上游 Token。

顶部切换 Claude / Codex / Gemini / OpenCode 后，只显示当前 Agent 能用的供应商卡片。卡片上的 OpenAI / Anthropic / Gemini 标签表示已配置对应地址，测通也只测当前 Agent 的协议。

## 数据

| 路径 | 用途 |
|---|---|
| `~/.model-switch/model-switch.db` | 唯一真相源（SQLite） |
| `~/.model-switch/backups/` | live 配置备份，每个 Agent 保留 10 份 |
| Codex live | `$CODEX_HOME/config.toml`、`msw-model-catalog.json` |
| Claude live | `~/.claude/settings.json` |
| Gemini live | `~/.gemini/.env` |
| OpenCode live | `~/.config/opencode/opencode.json`、`~/.local/share/opencode/auth.json` |

切换时做原子写，不会抹掉 Codex 的 `[projects]` 等无关段落。

第三方渠道按 OpenCode 的方式写入：密钥和模型都挂在该供应商自己的配置上。Codex 用 `[model_providers.<id>]` 的 `experimental_bearer_token` / `http_headers`，**不会**改全局 `auth.json`（那是官方 ChatGPT/OpenAI 登录）。OpenCode 则写 `provider.<id>.options.apiKey` 和对应的 `models`。

## 常用命令

```bash
msw provider presets
msw provider ls
msw provider add deepseek --key sk-xxx
msw provider rm deepseek
msw provider add custom --name local --base-url http://127.0.0.1:8000/v1 --key sk-local --wire-api responses --models grok-4.6
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

Codex 新版本只认 `wire_api = "responses"`，旧的 `chat` 会在切换时自动改掉。`--base-url` 一般要带到 `/v1`。密钥写在该供应商自己的 `[model_providers]` 段，对齐 OpenCode 的 `provider.<id>.options.apiKey`，不改全局 `auth.json`。

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
msw run --use packy
```

追加模型，不用重新加渠道：在管理台编辑该供应商的模型列表。

## 设计

- **全局切换**：改 live 配置
- **会话切换**：`msw run --use` 只影响本次进程
- **适配器**：新 Agent 实现 `detect / apply / sessionLaunch` 即可接入
