# 原生市场静态探针

包含 Codex、ZCode 各自的 v1/v2 市场与插件；Kimi Code CLI 已移至 `examples/future/reference/kimi-code-cli`，不属于首版；仅静态文件，未注册全局市场或执行模型调用。目录中的 AGENTS.md 是独立实验 Workspace 的规则入口，不代表插件内任意 Rule 自动加载。

Codex：`.agents/plugins/marketplace.json` + `plugins/hub-probe/.codex-plugin/plugin.json`；启动规则由实验 Workspace 的 AGENTS.md 提供。来源：https://developers.openai.com/plugins/build/plugins 与 https://learn.chatgpt.com/docs/agent-configuration/agents-md 。

Kimi Code CLI（后续参考，非桌面首版）：`marketplace.json` + `plugins/hub-probe/kimi.plugin.json`；插件 RULES.md 通过 systemPromptPath 注入，sessionStart.skill 初始化技能。来源：https://www.kimi.com/code/docs/en/kimi-code-cli/customization/plugins 。

ZCode：`marketplace.json` + `plugins/hub-probe/.zcode-plugin/plugin.json`；启动规则由实验 Workspace 的 AGENTS.md 提供，未假设插件支持 systemPrompt 字段。来源：https://zcode.z.ai/cn/docs/plugin 与 https://zcode.z.ai/cn/docs/agents 。

已检查 JSON 语法与文档字段对应关系；不是第三方 JSON Schema 验证或实际客户端加载验收。复制某个客户端的某版本目录到临时 Workspace 后再试验，禁止在现有工作区覆盖 AGENTS.md。
