# Model Switch

本机切换 Claude Code、Codex、Gemini CLI、OpenCode 的模型和供应商。

需要 Node.js 22+。先装好你要用的 Agent（`codex` / `claude` / `gemini` / `opencode`），再用 `msw` 改它们的配置。

## 系统界面

两套界面，数据同源。

终端切换台：

```bash
msw
```

顶部切 Agent，左侧选供应商、右侧选模型，Enter 启用，`r` 启动 Agent，`q` 退出。

网页管理台：

```bash
msw serve
```

浏览器打开 http://127.0.0.1:8787 。顶部切 Agent 后，只显示这个 Agent 能用的供应商。卡片上可以启用、测通、查看/编辑；工具栏可以打开当前 Agent 的配置文件。

## 安装

```bash
npm i -g https://github.com/zhoushuai2050/model-switch/archive/refs/heads/main.tar.gz \
  --omit=dev --ignore-scripts \
  --registry=https://registry.npmjs.org/
```

Linux / macOS 再执行 `hash -r`，然后：

```bash
msw help
msw status
```

不要用 `npm i -g model-switch`（npm 上是别人的包），也不要 `npm i -g github:...`（会装坏）。

更新：

```bash
npm uninstall -g model-switch
npm i -g https://github.com/zhoushuai2050/model-switch/archive/refs/heads/main.tar.gz \
  --omit=dev --ignore-scripts \
  --registry=https://registry.npmjs.org/
```

Linux / macOS 完整可用。Windows 上用 `msw use` 改配置，然后新开终端自己启动 Agent；不要用 `msw run`。

## 加供应商

看有哪些预设：

```bash
msw provider presets
```

有 OpenAI、Anthropic、DeepSeek、Kimi、GLM、Qwen、SiliconFlow、OpenRouter、MiniMax、Groq。

用预设：

```bash
msw provider add kimi --key sk-xxx
```

用中转站或本地接口（至少要有名字、Key、地址、模型）：

```bash
msw provider add custom \
  --name local \
  --key sk-xxx \
  --base-url http://127.0.0.1:8000/v1 \
  --models grok-4.6,gpt-5.6-sol
```

- Codex / OpenCode 用 `--base-url`（一般要带到 `/v1`）
- Claude Code 另加 `--anthropic-url`
- `--models` 填上游真实模型名，逗号分隔，第一项是默认模型

同一家中转同时给 Codex 和 Claude：

```bash
msw provider add custom \
  --name packy \
  --key sk-xxx \
  --base-url https://relay.example.com/v1 \
  --anthropic-url https://relay.example.com \
  --models gpt-5.6-sol,claude-sonnet-4-6
```

只给 Claude：

```bash
msw provider add custom \
  --name cc-relay \
  --key sk-xxx \
  --anthropic-url https://relay.example.com \
  --models claude-sonnet-4-6
```

## 切换

```bash
msw agent codex        # claude | codex | gemini | opencode
msw use local          # 切到刚加的供应商
msw ping local         # 可选，测通会消耗少量 Token
msw status
```

也可以：

```bash
msw                    # 终端界面
msw use codex:grok-4.6 # 只切 Codex 的某个模型
msw model grok-4.6     # 当前 Agent 换模型
```

切完后**新开终端**再启动：

```bash
codex      # 或 claude / gemini / opencode
```

Codex 里用 `/model` 切换该渠道下的模型。

只想这次生效、不改全局：

```bash
msw run --use local
```

## 测通

按当前 Agent 的协议发一条短测试消息，确认地址、Key 和模型名是否可用。会消耗少量 Token。

```bash
msw ping local
msw ping packy --agent claude
```

- Codex / OpenCode 测 OpenAI 地址
- Claude 测 Anthropic 地址
- Gemini 测 Gemini 地址（没填则用 `--base-url`）

管理台供应商卡片上点 **测通**，会逐步显示检查结果。编辑供应商时也可以测。

## 查看 / 编辑

管理台供应商卡片点 **查看/编辑**，可改名称、API Key、OpenAI / Anthropic / Gemini 地址和模型列表，不必删了重加。点弹窗背景不会关闭。

命令行目前只能改 Key：

```bash
msw provider set-key local sk-new
```

工具栏 **查看 Codex 配置**（随顶部选中的 Agent 变化）会直接打开该 Agent 的配置文件，例如：

- Codex：`~/.codex/config.toml`
- Claude Code：`~/.claude/settings.json`
- Gemini：`~/.gemini/.env`
- OpenCode：`~/.config/opencode/opencode.json`

保存前自动备份。保存后要重新启动对应 Agent 才会生效。点弹窗背景也不会关闭，避免误关丢掉未保存的修改。

## 常用命令

```bash
msw                     # 终端切换台
msw status              # 当前 Agent / 模型
msw provider ls         # 列出供应商
msw provider rm kimi    # 删除供应商
msw use kimi            # 切供应商
msw ping kimi           # 测通
msw serve               # 网页管理台
msw help custom         # 自定义中转示例
```

配置存在 `~/.model-switch/`（Windows 为 `%USERPROFILE%\.model-switch`）。
