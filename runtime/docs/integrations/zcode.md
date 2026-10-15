# ZCode 接入调查（T04）

日期：2026-10-14。已安装 `/Applications/ZCode.app` 3.15.3，bundle `dev.zcode.app`。对应官方产品为 ZCode，文档站 `zcode.z.ai`；不是 Zed 或第三方同名代码库。PATH 中没有 `zcode` 命令。

## 规则与技能入口

本机存在 `~/.zcode/AGENTS.md`、`~/.zcode/agents`、`~/.zcode/skills` 与 `~/.zcode/cli/config.json`。未读取这些规则正文或配置值。

官方启动任务时拼接全局 `~/.zcode/AGENTS.md` 与当前 Workspace 的 `AGENTS.md`；不扫描多层子目录，不展开 import/include。适配器须生成当前 Workspace 可直接读取的规则正文。[官方 Agent 说明](https://zcode.z.ai/cn/docs/agents)

用户技能入口 `~/.zcode/skills/<name>/SKILL.md`，正文按调用加载；name/description 必需。插件技能放 `skills/<name>/SKILL.md` 单层目录。启用技能的元数据可发现不代表正文已加载。[官方 Skill 说明](https://zcode.z.ai/cn/docs/skill)

角色/子智能体为 `~/.zcode/agents/<name>.md`，下次运行加载。[官方子智能体说明](https://zcode.z.ai/cn/docs/subagents)

## 原生市场与 MCP

推荐 manifest `.zcode-plugin/plugin.json`，兼容 `.claude-plugin/plugin.json`；市场根 `marketplace.json`，包含 name/plugins，条目 source 支持相对目录及 Git 等来源。设置 → 插件 → 创建 → 添加插件市场支持本地目录或仓库地址。更新提示比较市场条目 version 与插件 manifest version，发版须同步二者；插件启停可能即时刷新当前会话，因此不能把“旧会话固定版本”当成客户端原生保证。[官方插件说明](https://zcode.z.ai/cn/docs/plugin)

支持插件 `.mcp.json` 和共享 `.agents/mcp.json` 形式；MCP 能力需独立验证。[官方 MCP 说明](https://zcode.z.ai/cn/docs/mcp-services)

## 加载实验状态

已完成产品/目录/官方入口调查；没有使用桌面 UI 安装样例、启动新会话或验证更新回滚。未发现已确认的独立配置根隔离参数，不能猜测修改 `~/.zcode/cli/config.json`。后续先用临时 Workspace 与本地市场源，经客户端设置安装测试插件；记录规则和参考文件 v1/v2 标记、新旧会话、移除与回滚后的结果。

T04 仍进行中；若进行测试会改动用户级市场状态，记录原值和恢复步骤；文件落盘与真实 loaded 证据分开保留。

## 静态产物与规则注入边界

仓库样例：`examples/native-marketplaces/zcode/v1` 与 `v2`，包含各自 catalog/manifest、核心 Rule、Skill 与参考文件。JSON 已解析通过，字段已对照上文官方页面；尚未通过客户端真实加载或独立 JSON Schema 校验。

启动规则由隔离 Workspace 根 `AGENTS.md` 提供；当前样例插件仅提供技能，不宣称任意插件内 Rule 自动注入。适配器须同时托管 Workspace 指令段，安装插件本身不能算规则接入完成。该加载方式为官方文档支持，未在本机模型会话实测。

## 原生验证命令调查（2026-10-14）

本机 PATH 没有 zcode 命令；应用包 `Contents/Resources/tools` 仅发现 bfs/ripgrep/ugrep。官方插件页面提供 UI 添加市场时校验、marketplace条目 strict 及字段说明，未找到文档化的独立 CLI validate/inspect 命令。[官方插件开发说明](https://zcode.z.ai/cn/docs/plugin)

本轮未使用 UI，以免干扰并行桌面实验；不能记录原生格式验证通过。跨客户端导出技能应满足开放 Agent Skills name 约束，避免把带点的内容 ID 原样当技能名；ZCode官方页面没有充分说明技能名点号的运行时接受规则，不能把插件名允许点号外推成技能名允许点号。共享标准兼容性依据：[Agent Skills 规范](https://agentskills.io/specification)。

## 2026-10-15 应用内CLI与真实会话更新

实际发现随ZCode桌面3.15.3交付的 `/Applications/ZCode.app/Contents/Resources/glm/zcode.cjs`，CLI版本0.16.9；之前“未发现独立CLI”是当时调查边界。它支持 plugins validate、marketplace add/update、install/uninstall与project scope。禁网OS沙箱与独立HOME内已验证原生v1→v2→回滚v1、卸载与用户规则保留，详见 [本机操作](native-client-operations.md)。更新需刷新marketplace，重复install不会自动拉取新目录。

现有登录账号的独立项目真实模型会话已分别返回v1/v2启动规则，调用原生Skill并Read插件缓存参考。后续固定会话路线使用每Release独立plugin ID和不改写的session workspace；实际结果以 [客户端验收](../acceptance/2026-10-15/clients/README.md) 中记录为准，不将模型自报当成可信注入回执。

实际续接与MCP验证已完成：独立v2会话执行后，resume原v1的相同session ID，重新Skill/Read仍为v1；最终本地native-session绑定保护下再次resume也通过。项目级`.zcode/config.json`配置stdio服务，实际模型调用`mcp__norte-hub-acceptance__get_content`读取固定session-probe@1.0.0返回v1，保留仅toolCalls/text的脱敏证据，不读取或导出用户凭据。完整结果见 `docs/acceptance/2026-10-15/clients/zcode-pinned/`。
