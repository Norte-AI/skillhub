# Kimi Code CLI 调查（后续参考，不属于首版 T03）

日期：2026-10-14。实际调查目标为本机 Kimi Code CLI 0.38.0；不代表 Kimi.app、Kimi Work 或 Kimi Claw。

## 当前 CLI 入口

本机 `kimi --help` 给出 `--skills-dir`、`--agent-file`（Markdown）、`--agent`、`--prompt`、`acp`、`web` 与 `doctor`；文档链接为 `https://moonshotai.github.io/kimi-code/`。旧版 Python kimi-cli 的 YAML agent 与 `~/.kimi` 路径不能用于这版 CLI。

数据根默认 `~/.kimi-code`，支持 `KIMI_CODE_HOME` 隔离；通用 `~/.agents` 资源仍位于真实用户 home。当前本机存在 `config.toml` 与 `mcp.json`，尚无 `skills/` 或 `plugins/` 目录。[官方数据位置](https://moonshotai.github.io/kimi-code/en/configuration/data-locations.html)

全局指令可放 `$KIMI_CODE_HOME/AGENTS.md`，项目使用 `AGENTS.md` 或 `.kimi-code/AGENTS.md`。`SYSTEM.md` 会替换默认系统提示，因此首版不要采用覆盖用户系统提示方式。[官方 Agent 与规则说明](https://www.kimi.com/code/docs/en/kimi-code-cli/customization/agents)

插件 manifest 优先 `kimi.plugin.json`，兼容 `.kimi-plugin/plugin.json`；`skills`、`systemPromptPath`、`sessionStart.skill` 和 `mcpServers` 可用于技能、规则初始化与工具接入。自建市场通过 `/plugins marketplace <path-or-url>`，catalog 使用 `version: "2"` 与 `plugins: [{id, source}]`。安装 `/plugins install <path-or-url>`；本地内容复制到 `plugins/managed/<id>`。变更需 `/reload` 或新会话，安装作用域为用户级。[官方插件说明](https://www.kimi.com/code/docs/en/kimi-code-cli/customization/plugins)

## 隔离探针与验收缺口

实测在系统临时目录设置 `KIMI_CODE_HOME=<temp>` 运行 `kimi doctor`，退出码 0，报告两份配置不存在，使用内置默认值；临时目录未新增文件，已自动清理。这证明数据根参数被当前 CLI 接受，不证明模型加载。

下一步：在隔离数据根安装带 `sessionStart.skill` 的 v1/v2 样例，规则与参考文件使用不同可核对标记；检查安装产物，使用受控测试认证运行 `kimi -p` 新会话，并对比旧会话、更新、回滚。不得读取或复制用户认证材料到仓库。

当前没有实际模型会话与插件安装证据，此 CLI 不计入首版验收。用户最终所指 Kimi 是否就是 Kimi Code CLI 尚未确认；CLI 结果不得替代 Kimi 桌面产品验收。

## 静态产物与规则注入边界

仓库样例：`examples/future/reference/kimi-code-cli/v1` 与 `v2`，包含各自 catalog/manifest、核心 Rule、Skill 与参考文件。JSON 已解析通过，字段已对照上文官方页面；尚未通过客户端真实加载或独立 JSON Schema 校验。

启动规则通过 `kimi.plugin.json` 的 `systemPromptPath: "./RULES.md"` 注入；`sessionStart.skill: "hub-probe"` 初始化技能。该结论为官方文档支持，未在本机模型会话实测。
