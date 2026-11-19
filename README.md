# Deep PTC for Codex · 模型门控工作流插件

Codex 原生插件（CLI / Desktop 通用）。安装后在 **模型名包含 `deepseek` 的会话轮次**自动注入一套工作流偏好，其他模型完全不受影响。

- 不改 Codex 二进制，不改全局 AGENTS.md，不改模型、Provider、API Key、sandbox、approval_policy。
- 只按 Codex 每次事件传入的实时 `model` 字段判定，不读配置默认模型，不猜身份。
- 附带可回滚安装器：安装 / 升级 / 还原 / 卸载全部可逆，写操作带备份与命令回执。

## 门控规则

| 实时模型标识 | 行为 |
|---|---|
| 名称中任意位置包含 `deepseek`（大小写不敏感） | 启用 |
| 名称中任意位置包含常见拼写 `deepseep` | 启用 |
| `deepseek-chat`、`DeepSeek-R1`、`deepseek-v4.1-flash` | 启用 |
| `vendor/deepseek-v4`、`ccs-catcode-123/deepseek-v4.1-flash` | 启用 |
| `my-deepseek-router`、`not-deepseek` 这类自定义路由名 | 启用 |
| `gpt-6.1-sol`、Claude、其他模型 | 不注入、不拦截工具 |
| 缺少模型字段 / 无法识别 | 不启用，不猜测 |
| 不含 `deepseek` 的网关别名（如 `ds-router`） | 用户登记精确别名后启用 |

判定实现在 `codex/marketplace/plugins/deep-ptc-deepseek/scripts/common.mjs` 的 `gate()`：

```js
const named = /deepsee(?:k|p)/u.test(normalized);
```

## 一键安装 / 还原

前提：Node.js 20+；Codex 需要支持 `plugin`、`app-server` 与 Hooks。实测环境：codex-cli 0.144.1、Node v24.16.0、Windows。不需要 `npm install`，不需要 Python，不需要管理员权限。

**Windows**

- `install-codex.cmd`：安装插件，并只信任本插件的四个 Hook 精确哈希。
- `restore-codex.cmd`：撤销最近一次安装 / 升级，恢复配置与插件文件原始字节；可逐级还原。
- `uninstall-codex.cmd`：只卸载本插件与市场登记，保留之后新增的其他配置、项目卡片、检查点与备份。

同名 `.ps1` / `.sh` 为 PowerShell 与 macOS/Linux 入口（非 Windows 未做真机验证）。

安装后**重启 Codex 或打开新会话**，Hook 才会用新代码。桌面端与 CLI 需共享同一个 Codex 用户配置目录；自定义 `CODEX_HOME` 时先设置该变量再运行入口。

命令行等价：

```powershell
node ./codex/installer.mjs install --approve
node ./codex/installer.mjs status
node ./codex/installer.mjs restore
node ./codex/installer.mjs uninstall
```

不想立即信任代码执行 Hook，可先 `node ./codex/installer.mjs install`（不带 `--approve`），再在 Codex `/hooks` 中审阅并信任；此时安装器会明确报告 `trustRequired`，不会把“已登记”当成“已生效”。

## 目录结构

```text
codex/
  installer.mjs                 安装 / 升级 / 还原 / 卸载，事务回滚 + 备份
  hook-control.mjs              通过 app-server 精确读写本插件 Hook 信任
  marketplace/                  Codex 本地市场
    .agents/plugins/marketplace.json
    plugins/deep-ptc-deepseek/
      .codex-plugin/plugin.json
      hooks/hooks.json           SessionStart / UserPromptSubmit / PostCompact / PreToolUse
      scripts/
        common.mjs               设置、门控、原子写入
        hook.mjs                 四个事件的处理与上下文注入
        ptc.mjs                  项目卡片 / 检查点 / 状态辅助 CLI
        vendor/                  复用模块（含 NOTICE）
      skills/deep-ptc/SKILL.md   按需读取的 Skill
  tests/                        adapter + 原生 Hook 端到端测试
```

## 它能做什么

| 能力 | 实现 |
|---|---|
| 轮次级工作流注入 | 四个生命周期 Hook，输出仅对当前轮次生效 |
| 模型门控 | 实时 `model` 字段含 `deepseek` 才启用 |
| 前台长 sleep 拦截 | 词法检测 shell 命令，`sleep > 5s` 时拒绝并提示改用会话轮询 |
| 项目卡片 | 提案 / 批准分离、基线冲突检查、版本快照与精确还原 |
| 恢复检查点 | 持久化 objective / nextAction / 证据，压缩后可从断点续跑 |
| 别名与总开关 | `settings --alias` / `--enabled` / `--block-long-sleeps` |

未迁移：Cordis 注入、DSH React 侧栏、可点击对话卡片、热切换 Shell、后台完成自动唤醒——这些不是 Codex Skill / Hook 能等价伪造的运行时能力。

## 数据与还原

默认 `~/.codex`，设置 `CODEX_HOME` 则跟随。

- `deep-ptc/marketplace/`：独立复制的插件，运行不再依赖解压目录。
- `deep-ptc/settings.json`：启停、精确别名、sleep 检测偏好，升级保留。
- `deep-ptc/projects/`：按项目路径散列隔离的提案、历史、检查点，卸载保留。
- `deep-ptc/backups/<id>/`：配置原件、旧插件、`DIFF.json`、`VERIFICATION.json`。

`restore` 覆盖前核对配置与插件文件哈希；安装后改过配置会停止还原并保留现状，此时用 `uninstall` 只移除插件。安装 / 升级失败会尝试事务回滚，失败副本与完整回执保留在备份目录。

备份可能包含原配置中的敏感信息：仅写本地，不上传、不进日志，不要分享该目录。

## 验证

```powershell
node --test ./codex/tests/adapter.test.mjs ./codex/tests/native-hooks.test.mjs
```

测试全部使用临时 `CODEX_HOME`，不碰真实账号配置；覆盖门控命中 / 不命中、Hook 空操作、sleep 拦截、卡片提案 / 冲突 / 原文保留、检查点、真实 CLI 安装 / 升级 / 还原 / 卸载，以及真实 Codex 请求接本地模拟模型服务的端到端门控检查。请求级测试不调用付费模型，不发送真实会话或 API Key。

## 官方机制参考

- Codex 插件开发：<https://developers.openai.com/plugins/build/plugins>
- Hooks 输入、模型字段与上下文输出：<https://learn.chatgpt.com/docs/hooks>
- Codex Skills：<https://developers.openai.com/codex/skills/>

MIT 授权，见 `LICENSE`；复用模块的授权说明见 `scripts/vendor/NOTICE.md`。