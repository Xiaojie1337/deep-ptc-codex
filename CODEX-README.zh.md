# Deep PTC for Codex · DeepSeek 自动模式

本仓库是 **Codex 原生插件**，不是修改 Codex 二进制，也不把提示词全局塞进 AGENTS.md。仓库自带安装器、插件、测试与还原工具，解压即可用。

## 一键安装 / 还原

前提：安装 Node.js 20+；Codex CLI 需要支持 `plugin`、`app-server` 和 Hooks。实际验证版本：**codex-cli 0.144.1、Node v24.16.0、Windows**。不需要 npm install，不需要 Python，不需要管理员权限。

**Windows**：

- 双击 `install-codex.cmd`：安装原生插件，并明确授权信任**本插件的四个 Hook 精确哈希**。
- 双击 `restore-codex.cmd`：撤销最近一次安装 / 升级，恢复之前插件文件和配置原始字节；可逐级还原。
- 双击 `uninstall-codex.cmd`：仅卸载本插件及其市场登记，保留安装后新增的其他 Codex 配置、项目卡片、检查点和备份。

同名 `.ps1`、`.sh` 是 PowerShell 和 macOS/Linux 入口。非 Windows 平台已提供脚本，但未做真机验证。

安装之后**重启 Codex，或打开新会话**。桌面端和 CLI 必须使用同一个 Codex 用户配置目录；使用自定义 `CODEX_HOME` 时，先设置该环境变量再运行安装入口。桌面端需要本身支持原生插件和 Hooks；此次端到端验证使用 CLI，未自动操作桌面端 UI。

命令行等价入口（在解压目录执行）：

```powershell
node ./codex/installer.mjs install --approve
node ./codex/installer.mjs status
node ./codex/installer.mjs restore
node ./codex/installer.mjs uninstall
```

如果希望**先安装、不立即信任代码执行 Hook**，使用 `node ./codex/installer.mjs install`，然后在 Codex `/hooks` 中检查并信任本插件，或明确执行带 `--approve` 的安装。普通安装会报告 `trustRequired`，不会把“已登记”冒充“已生效”。

安装脚本只通过 Codex 官方 `plugin` 命令和 app-server 配置 API 注册插件 / 精确信任本插件 Hook；不改模型、模型服务商、API Key、全局 sandbox 或 approval_policy，也不替换已有 AGENTS.md / Skill。Hook 代码发生更新后应重新检查并安装，信任记录不代表信任任意第三方代码。

## 识别和启用规则

每次 `SessionStart`、`UserPromptSubmit`、`PostCompact`、`PreToolUse`，都使用 **Codex 本次事件传入的实时 `model` 字段**，不读 API Key，不猜模型身份，不拿 config.toml 默认模型冒充本会话正在用的模型。

| 实时模型标识 | 行为 |
|---|---|
| 名称中任意位置包含 `deepseek` 或 `deepseep`（大小写不敏感，容忍常见拼写错误） | 启用 |
| `deepseek-chat`、`DeepSeek-R1`、`deepseek-v4.1-flash` | 启用 |
| `vendor/deepseek-v4`、`ccs-catcode-123/deepseek-v4.1-flash` | 启用 |
| `gpt-6.1-sol`、Claude、其他模型 | 不注入、不拦截工具 |
| 缺少模型字段 / 无法识别 | 不启用，不猜测 |
| 网关把 DeepSeek 改名为 `ds-router` 等（名称不含 deepseek） | 用户登记精确别名后启用 |

插件可以长期保持安装和启用；**实际工作流由模型门控决定**。这不是切换全局 `enabled` 配置，所以多个模型会话并存时不会互相开关插件。附带 Skill 关闭隐式调用，其他模型不会自动加载它。手动请求项目记录仍可调用辅助工具。

Hook 说明明确只对当前 DeepSeek 轮次生效；切换模型后的旧对话中可能仍有历史文本，插件不会删除聊天历史。如需彻底隔离已有上下文，请为不同模型开新会话。

### 配置网关别名 / 临时关闭

安装目录默认是：`~/.codex/deep-ptc/marketplace/plugins/deep-ptc-deepseek`。

PowerShell 示例：

```powershell
$homeDir = if ($env:CODEX_HOME) { $env:CODEX_HOME } else { Join-Path $HOME '.codex' }
$ptc = Join-Path $homeDir 'deep-ptc/marketplace/plugins/deep-ptc-deepseek/scripts/ptc.mjs'
node $ptc status --model 'ccs-catcode-123/deepseek-v4.1-flash'
node $ptc settings --alias 'ds-router'
node $ptc settings --enabled false
node $ptc settings --enabled true
node $ptc settings --remove-alias 'ds-router'
```

`status --model` 只是对指定字符串做门控诊断，不是读取桌面端实时模型。真实启用由 Hook 输入决定。别名是用户显式配置，不能从服务器地址可靠推断路由后端。

## 已迁移的能力与宿主边界

| 原 DeepSeek Harness 能力 | Codex 适配 |
|---|---|
| 进度汇报、轻量计划、按需工具 / Skill 读取 | DeepSeek 轮次专属 Hook 工作流 |
| 长任务与可插话 | 使用 Codex 原生 exec/session 工具；不复制调度器 |
| 前台长 sleep 检测 | 复用原 `sleep-lint.mjs`，仅 DeepSeek shell 调用超过 5 秒时拒绝 |
| 特点 / 功能 / 需求卡片 | 复用原 `project-cards.mjs` 格式，辅助 CLI 持久化 |
| 变更提案与人工采用 | 提案与批准分离、基线冲突检查、版本快照 |
| 上下文恢复 | 持久化检查点，保留真实证据、文件及下一步 |
| Cordis 注入、DSH React 侧栏、可点击对话卡片、热切换 Shell、后台完成自动唤醒 | **未迁移为等价 UI / 运行时能力**；不是 Codex Skill 能伪装出来的接口 |

长 sleep 检测是常见 shell 写法的词法检测，不是通用沙箱或任意程序运行时限制；可用 `settings --block-long-sleeps false` 关闭它。插件不绕过宿主权限，也不保证工具里所有自定义执行器都能被识别。

## 项目记录辅助工具

Hook 会把实际辅助脚本与 Skill 的绝对路径交给模型，平时可以直接说：

> 把当前功能整理为项目卡片，先给我看提案。
>
> 保存恢复检查点，下次从验收测试继续。
>
> 看看项目卡片的历史版本，把最近的改动还原给我确认。

也可以手动运行（`$ptc` 见上节）：

```powershell
node $ptc --help
node $ptc cards list --cwd 'C:/your-project'
node $ptc cards propose --cwd 'C:/your-project' --file 'C:/change.json'
node $ptc cards accept --cwd 'C:/your-project' --id '上一条返回的真实提案ID' --approve
node $ptc cards history --cwd 'C:/your-project'
node $ptc checkpoint show --cwd 'C:/your-project'
```

新的 `change.json` 示例：

```json
{"kind":"features","title":"已实现功能","items":["DeepSeek 自动启用，其余模型不注入"]}
```

编辑已有卡片时提供 `id`，并在 `items` 中保留其他条目；更新会替换该卡片的整个条目列表。已有条目使用 `{ "id": "F1", "text": "更新后的内容" }` 保持稳定编号。`propose` 不修改项目文件；只有批准后 `accept` 才写入。基线已变动时拒绝保存，重新审阅新提案。项目卡片、检查点不会被提升成系统指令。

## 持久化与还原细节

默认用户配置位置 `~/.codex`；设置 `CODEX_HOME` 则跟随该路径。

- `deep-ptc/marketplace/`：独立复制的市场和插件，运行不再依赖原下载目录；使用包内一键还原 / 卸载工具时请保留安装包或重新解压。
- `deep-ptc/settings.json`：启停、精确模型别名、sleep 检测偏好；升级保留。
- `deep-ptc/projects/`：按项目路径散列隔离的提案、历史和检查点；卸载保留。
- `deep-ptc/backups/<真实备份ID>/`：配置原件、旧插件、文件哈希差异 `DIFF.json` 与安装命令回执 `VERIFICATION.json`。

备份可能含原有配置中的敏感信息；文件仅写入本地，不上传、不在报告中打印配置内容，不要把此目录分享出去。非 Windows 文件以用户私有权限创建；Windows 继承用户目录 ACL。

`restore` 在覆盖前核对安装后的配置哈希和插件文件哈希。若你随后改过配置或插件，**停止还原且保留现状**，防止抹掉后来工作；此时使用 `uninstall` 可只移除本插件。安装 / 升级故障会尝试事务回滚，失败副本和完整命令回执会保留，不把失败当成成功。

项目卡片更新有独立 `transaction.json` 恢复日志。断电或落盘中断留下未决日志时，写操作会停止并报告真实路径；需核对日志里的 before / next 和当前文档后恢复，不盲目重试。快照最多保留 20 个，提案最多 20 个，记录文件上限 1 MiB，不建议把完整终端日志或密钥写进去。

## 验证

```powershell
node --test ./codex/tests/adapter.test.mjs ./codex/tests/native-hooks.test.mjs
```

测试使用临时 `CODEX_HOME`，不安装到你的真实账号配置。覆盖模型与别名门控、Hook 空操作、前台 sleep、卡片提案 / 冲突 / 原文保留 / 精确恢复、检查点、真实 CLI 安装 / 升级 / 还原 / 卸载，以及真实 Codex 请求接本地模拟模型服务的端到端启用检查。

请求级测试不调用付费模型，不发送真实会话或 API Key。测试进程的外部 HTTP(S) 代理指向本地模拟服务，阻断无关在线元数据请求。真实 DeepSeek 服务商的 API 兼容性、你的桌面端具体版本和 DSH 侧栏 UI 不属于此次本地测试通过项。

## 官方机制参考

- OpenAI Codex/Work 插件开发：`https://developers.openai.com/plugins/build/plugins`
- Hooks 输入、模型字段、信任及上下文输出：`https://learn.chatgpt.com/docs/hooks`
- Codex Skills：`https://developers.openai.com/codex/skills/`

MIT 授权，见仓库根目录 `LICENSE`。复用模块未修改，随插件附带 `scripts/vendor/NOTICE.md`。
