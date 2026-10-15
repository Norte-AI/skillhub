# Codex 接入调查（T02）

日期：2026-10-14。本机 Desktop 26.1007.71326；CLI 0.162.0-alpha.17.2。

## 入口与实现判断

官方支持全局 `~/.codex/AGENTS.md` 和从项目根到当前目录的项目指令链；同目录 `AGENTS.override.md` 优先。全局规则不能被适配器整文件覆盖，应采用带边界的托管段，或项目隔离工作区。[官方指令说明](https://learn.chatgpt.com/docs/agent-configuration/agents-md)

技能使用 `SKILL.md` 和可选参考文件，需区分技能可发现与正文被实际调用。[官方技能说明](https://learn.chatgpt.com/docs/build-skills)

仓库市场入口为 `.agents/plugins/marketplace.json`，条目使用 `source: {source: "local", path: "./plugins/<name>"}`；路径相对市场根。插件可采用根 `plugin.json` 的 Agent Plugins 格式，兼容布局 `.codex-plugin/plugin.json`。项目启用配置 `.codex/config.toml` 的 `plugins."<plugin>@<market>".enabled` 仅在可信项目读取。桌面本地插件变更的官方流程需要重启应用。[官方打包与本地市场说明](https://developers.openai.com/plugins/build/plugins)

本机帮助确认 `codex plugin marketplace add/list/upgrade/remove`、`codex plugin add <plugin>@<market> --json` 和 `codex plugin remove` 存在。这里只执行了 `--help`，没有安装或改动配置。

## 最小加载实验计划与当前结果

隔离工作区生成一条规则 `hub_probe_release = v1` 与一个带 `references/probe.md` 的技能，随后生成 v2；使用独立 `CODEX_HOME` 并显式指定项目路径，不能复用或复制真实认证文件。离线验证市场解析、安装文件和启用状态；获得可用测试认证后分别启动新会话、旧会话、更新后的新会话、回滚后的新会话，输出规则标记与参考文件标记。

当前只有版本与命令能力证据：未启动模型会话、未安装样例插件、未验证实际加载、更新或回滚。T02 仍进行中。安装回执不能作为 loaded 回执；必须记录 session ID、release ID、标记和脱敏证据。

## 静态产物与规则注入边界

仓库样例：`examples/native-marketplaces/codex/v1` 与 `v2`，包含各自 catalog/manifest、核心 Rule、Skill 与参考文件。JSON 已解析通过，字段已对照上文官方页面；尚未通过客户端真实加载或独立 JSON Schema 校验。

启动规则由隔离 Workspace 根 `AGENTS.md` 提供；当前样例插件仅提供技能，不宣称任意插件内 Rule 自动注入。适配器须同时托管 Workspace 指令段，安装插件本身不能算规则接入完成。该加载方式为官方文档支持，未在本机模型会话实测。

## 导出审查与隔离 CLI 能力核对（2026-10-14）

用独立系统临时目录设置 `CODEX_HOME`，分别执行 `codex plugin --help` 与 `codex plugin marketplace --help`，均退出 0。前者只有 add/list/marketplace/remove/help，后者只有 add/list/upgrade/remove/help；没有 inspect 或 validate。仅帮助探针创建临时 tmp 子目录，实验结束已删除；未复制 auth、注册真实市场或调用模型。因此当前不能宣称客户端原生 validate 已通过。

审查 `.skillhub-test/exports/codex-v1` 时，catalog/manifest 为有效 JSON，字段与官方兼容格式一致；但导出技能目录与 frontmatter 使用 `review.summary`。它违反 Agent Skills 规范的 name 约束：1–64 字符，仅小写字母/数字/连字符，不可连续连字符，且须等于父目录名。OpenAI技能文档明确技能遵循该开放标准。[OpenAI 技能文档](https://learn.chatgpt.com/docs/build-skills)、[Agent Skills 规范](https://agentskills.io/specification)

修复建议：统一内容 ID 保持不变；在原生导出层生成合规 skill slug，同步目录和 frontmatter，记录 source ID 映射，并处理 `review.summary`/`review-summary` 映射冲突。仅用点替换连字符而不检测冲突不够。此发现是标准兼容性缺陷，不是本机客户端运行时拒绝的实测证据。

## HTTP Git 市场实际识别通过

2026-10-14 使用临时CODEX_HOME访问真实 `http://127.0.0.1:4317/git/codex.git`，添加main与列出市场/可用插件全部退出0。市场skill-hub，插件personal@skill-hub版本1.0.0，installed=false/enabled=false；克隆含合法review-summary技能目录。此前代理不可达由子进程运行时覆盖解决，未改全局配置。临时目录已清理，无安装与模型调用。[完整实验记录](../git-marketplace.md)、[脱敏JSON](codex-git-probe.json)。

## 2026-10-15 实际模型验收更新

已通过现有登录账号执行独立测试项目的真实Codex会话：project AGENTS.md规则自动进入启动上下文，Skill工具实际读取参考文件。三个新会话完成v1→v2→回滚v1；另通过不可变session workspace路线保留原native session ID，在新版本新会话执行后resume旧ID，规则和重新获取的参考均保持v1。真实MCP get_content固定Release调用也已通过。证据见 [客户端验收](../acceptance/2026-10-15/clients/README.md)。这覆盖明确的项目规则/Skill接入路线，不外推为桌面原生插件热加载或可信服务端注入回执。
