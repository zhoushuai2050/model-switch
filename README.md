# Model Switch

本机切换 Claude Code、Codex、Grok Build、Gemini CLI、OpenCode 的模型和供应商。

需要 Node.js 22+。可以先自己装 Agent（`claude` / `codex` / `grok` / `gemini` / `opencode`），也可以在管理台每个 Agent 页面里安装、选版本或卸载。

## 系统界面

两套界面，数据同源。

终端切换台：

```bash
msw
```
<img width="1419" height="598" alt="image" src="https://github.com/user-attachments/assets/f4e1955b-9a45-4857-8260-f27fbb3ef705" />


顶部切 Agent，左侧选供应商、右侧选模型，Enter 启用，`r` 启动 Agent，`q` 退出。

网页管理台：

```bash
msw serve
```
<img width="1906" height="759" alt="image" src="https://github.com/user-attachments/assets/ddb6be27-9952-407b-9cd5-85568cd1006e" />

浏览器打开 http://127.0.0.1:8787 。顶部切 Agent 后，只显示这个 Agent 能用的供应商。工具栏只显示 Agent 名和版本：未安装时点安装，已安装时可以卸载；有新版本时显示更新版本，并列出最近 10 个 npm 版本。卡片上可以点选模型、启用、测通、编辑；添加模型会弹出窗口。左下角可切换主题和中文 / English。

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

更新（不用先卸载）：

```bash
msw update
```

或直接再装一遍：

```bash
npm i -g https://github.com/zhoushuai2050/model-switch/archive/refs/heads/main.tar.gz \
  --omit=dev --ignore-scripts \
  --registry=https://registry.npmjs.org/
```

Linux / macOS 完整可用。Windows 上用 `msw use` 改配置，然后新开终端自己启动 Agent；不要用 `msw run`。

## 加供应商

供应商按 Agent 隔离：一次只创建一个 Agent 的供应商，不再创建同时给多个 Agent 用的供应商。网页管理台顶部选中哪个 Agent，添加的就是那个 Agent 的供应商。

看有哪些预设：

```bash
msw provider presets
```

有 OpenAI、Anthropic、DeepSeek、Kimi、GLM、Qwen、SiliconFlow、OpenRouter、MiniMax、Groq。

用预设（必须指定 Agent，或先 `msw agent claude`）：

```bash
msw provider add kimi --key sk-xxx --agent claude
msw provider add kimi --key sk-xxx --agent codex
```

这会生成两条独立供应商，名字可以相同。

只给 Codex / OpenCode / Grok Build：

```bash
msw provider add custom \
  --name local \
  --key sk-xxx \
  --agent grok-build \
  --base-url http://127.0.0.1:8000/v1 \
  --models grok-4.6,gpt-5.6-sol
```

只给 Claude：

```bash
msw provider add custom \
  --name local \
  --key sk-xxx \
  --agent claude \
  --anthropic-url https://api.lvyrix.com \
  --models grok-4.6
```

- Codex / OpenCode / Grok Build 用 `--base-url`（一般要带到 `/v1`）
- Claude Code 用 `--anthropic-url`（不要带末尾 `/v1`，Claude Code 会自己拼 `/v1/messages`；带了 msw 写入时也会去掉）
- `--models` 填上游真实模型名，逗号分隔，第一项是默认模型
- 同一家中转要给 Claude 和 Codex 用，请分别添加两次，不要写两个地址到同一条供应商
- 之后可给供应商增删模型，并选择一个当前模型：测通和启用/启动都用这个当前模型

```bash
msw provider add-model local gpt-5.6-sol
msw provider select-model local gpt-5.6-sol
msw provider rm-model local grok-4.6
```

## 切换

```bash
msw agent codex        # claude | codex | grok-build | gemini | opencode
msw agent install claude
msw agent install grok-build --version 1.0.30
msw agent uninstall gemini
msw agent update grok-build
msw use local          # 切到刚加的供应商
msw ping local         # 可选，通过 Agent SDK 测通，会消耗少量 Token
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
claude     # 或 codex / grok / gemini / opencode
```

Codex 里用 `/model` 切换该渠道下的模型。Claude Code 的 `/model` 只认 `sonnet` / `opus` / `haiku`；msw 会把界面模型写成这些别名，再用 `ANTHROPIC_DEFAULT_*_MODEL` 映射到上游真实模型名。不要在 Claude 里手动选自定义名。思考强度、权限等其它配置会保留。

只想这次生效、不改全局：

```bash
msw run --use local
```

## 测通

按当前 Agent 启动其 SDK / 非交互模式，随机问一句平常的话（例如「1+1等于几？」），和你在 SDK 里手动打字一样。走的是真正启动 Agent 时的同一套配置映射（例如 Claude Code 只认 `sonnet` / `opus` / `haiku`，真实模型名通过 `ANTHROPIC_DEFAULT_*_MODEL` 注入），不会带「测通」字样，也不走专用探测接口。测通用非流式拿完整回复即可。会消耗少量 Token。

```bash
msw ping local
msw ping packy --agent claude
```

- Claude：`claude -p`（print / SDK 模式）
- Codex：`codex exec`
- Grok Build：`grok -p`
- Gemini：`gemini -p`
- OpenCode：`opencode run`

测通会在临时目录写入隔离配置，不会改你正在用的 Agent 配置。需要本机已安装对应 Agent。

管理台供应商卡片上点 **测通**，会逐步显示检查结果。编辑供应商时也可以测。

## 编辑

管理台供应商卡片上可以直接添加、删除、点选模型。点选后该模型成为测通和启用时的默认模型；如果这个供应商正在使用，会立刻写进当前 Agent。

卡片点 **编辑**，可改名称、API Key 和地址，不必删了重加。点弹窗背景不会关闭。

命令行：

```bash
msw provider set-key local sk-new
msw provider add-model local gpt-5.6-sol
msw provider select-model local gpt-5.6-sol
```

工具栏 **查看 Codex 配置**（随顶部选中的 Agent 变化）会直接打开该 Agent 的配置文件，例如：

- Claude Code：`~/.claude/settings.json`
- Codex：`~/.codex/config.toml`
- Grok Build：`~/.grok/config.toml`
- Gemini：`~/.gemini/.env`
- OpenCode：`~/.config/opencode/opencode.json`

保存前自动备份。保存后要重新启动对应 Agent 才会生效。点弹窗背景也不会关闭，避免误关丢掉未保存的修改。

## 常用命令

```bash
msw                     # 终端切换台
msw status              # 当前 Agent / 模型
msw provider ls         # 列出供应商
msw provider rm kimi    # 删除供应商
msw provider add-model kimi gpt-5.4
msw provider select-model kimi gpt-5.4
msw use kimi            # 切供应商（用当前选中的模型）
msw ping kimi           # 测通（用当前选中的模型）
msw agent install claude
msw agent install grok-build --version 1.0.30
msw agent uninstall gemini
msw agent update grok-build
msw serve               # 网页管理台
msw help custom         # 自定义中转示例
```

配置存在 `~/.model-switch/`（Windows 为 `%USERPROFILE%\.model-switch`）。
