# Kimi 桌面接入调查（T03）

日期：2026-10-14。用户明确目标为 Kimi 桌面应用，版本 3.2.16；不是 Kimi Code CLI。

## 实测身份与范围

`/Applications/Kimi.app/Contents/Info.plist`：名称 Kimi，bundle `com.moonshot.kimichat`，版本 3.2.16；URL schemes 为 `kimi` 与 `kimi-work`。官方产品说明明确 Kimi Work 是 Kimi 电脑客户端内的 Work 模式，和 Kimi Code 是不同产品。[官方 Work 产品说明](https://www.kimi.com/help/kimi-work/overview)

本轮只读取公开资料、应用包版本与非敏感打包资源；没有读取对话、用户凭证、数据库或改变客户端配置。没有打开用户会话、安装插件或调用模型。

## 持久规则与新会话初始化

Work 发布日志 3.2.7 明确新增“会话设定注入”，Work 新会话自动携带会话设定。它是桌面官方支持的持久偏好入口；设定的具体 UI 字段、长度限制、存储位置和可编程更新接口尚未实测。[官方 Work 发布日志](https://www.kimi.com/help/kimi-work/release-notes)

官方插件概述将 System Prompt 列为启用期间追加到主 Agent 的组件，并明确 Work 支持比 Web 更完整的插件组合。可以据此设计“Rule 编译为原生插件系统提示”的候选方案，但 `systemPromptPath`、`sessionStart.skill` 已由桌面包内官方builder纯结构校验通过，具体新会话触发仍须独立验证，不能引用 CLI 实验代替。[官方插件概述](https://www.kimi.com/help/plugins-and-skills/overview)

Kimi Chat 项目的“项目指令”文档明确只覆盖 Chat 项目，且 Chat 与 Work 项目互不互通。因此不能把 Chat 项目指令当作 Work 项目规则入口；也本轮尚未取得桌面读取任意 Workspace `AGENTS.md` 的证据。[官方 Chat 项目说明](https://www.kimi.com/help/features/project)

## 插件市场、安装与 MCP：可行官方路线

桌面 Work 左侧栏 → 插件 → 个人市场有自定义插件入口。官方 Plugin Builder 支持导入原生 `kimi.plugin.json`、其他平台 manifest、纯技能仓库和带 `marketplace.json`/`plugins.json` 的市场仓库；转换并登记个人市场后安装。官方说明安装后当前会话立即可用，因此会话版本固定需要 Skill Hub 自行验证和约束，不能默认客户端保证。[官方个人插件创建与导入](https://www.kimi.com/help/plugins-and-skills/create)

自建 Skill Hub 市场可提供版本固定的仓库/插件下载与桌面导入指引，转换后出现在个人市场。此为有官方支持的人工桥接路线；公开资料中尚未找到通用“添加任意市场源 URL”桌面接口；随后在桌面包内官方builder发现 register-personal 程序化登记入口，见 [桌面原生契约与校验](kimi-desktop-schema.md)，CLI `/plugins marketplace` 不适用于此结论。

MCP 可作为原生插件组件提供。官方 Work 插件中心说明可创建个人插件接入外部服务；具体 HTTP/stdio、鉴权、安装回执和连通性需验收。[官方 Work 插件中心](https://www.kimi.com/help/kimi-work/plugin-center)

## 非敏感本机资源证据

应用包存在 `Contents/Resources/resources/daimon-bundle/README.md` 与 `builtin-skills/README.md`。前者说明运行时状态默认 `$KIMI_SHARE_DIR/daimon`（默认 `~/.kimi/daimon`）；后者说明技能在 provision 阶段放入 `KIMI_SKILLS_ROOT`，部分应用自管技能会覆盖或删除同名目录。这是打包实现线索，不是正式用户扩展契约，不应直接写包内资源或猜测实际用户路径。

`app.asar` 索引包含 `PluginLocalInstallModal`、`PluginInstallModal`、`personal-plugin-install-modal` 和 `plugin-local-loader` 模块；本地安装 UI 打包文本出现 `sessionStartSkill` 标签。仅证明应用包含相应模块，尚不能证明功能开启、权限或实际加载；未调用未公开 IPC/API。

## 后续执行与验收缺口

1. 在桌面设置和 Work 插件入口只读检查会话设定、本地插件上传/安装、个人市场来源入口，避免读取既有对话内容。
2. 生成 desktop 专用 v1/v2 原生插件，Rule 用 system prompt 候选字段，Skill 引用参考文件；先完成结构检查再安装隔离命名样例。
3. 验证全新 Work 会话是否无需手动提及插件即带入 Rule；再显式触发 Skill 核对参考标记。手动选择插件或查询 MCP 不计自动初始化成功。
4. 分别验证当前会话受安装/更新影响、之后的新会话、版本回滚与移除，并记录脱敏证据。同步器暂不写 undocumented 全局路径。

当前状态：产品已确认，官方桌面插件导入路线与持久会话设定已有来源；Rule 自动注入、市场程序化同步、安装回执、更新回滚和 loaded 证据均待实测，T03 未完成。Code CLI 样例已移到 `examples/future/reference/kimi-code-cli/`。

## 桌面 UI 实测（权限开通后）

通过 Computer Use 读取 Kimi 3.2.16 的 Work 模式，已验证：

- 左侧“插件”打开插件中心，有“自定义插件”和“个人”页签。
- “个人”页当前提示在会话中使用 `/plugin builder` 创建插件，完成后出现在这里。
- 点击“自定义插件”会向当前会话输入框填入创建插件提示，并不会打开独立的市场源设置表单。实验没有发送消息，自动填入的草稿已清除。
- “技能 → 自定义技能”提供“上传技能”，支持本地文件夹、ZIP 或 SKILL.md，另有“创建技能”。技能上传入口不能替代插件或核心 Rule 自动加载验收。

当前没有执行上传、插件登记、安装或模型调用。UI 已证实个人市场入口，程序化同步与会话注入仍未验证。后续使用独立测试会话和专用命名插件完成验收，不向既有业务会话发送测试消息。

补充：桌面官方builder验证已完成，退出0（0 ERROR、4 WARN），未登记安装。见 [桌面schema报告](kimi-desktop-schema.md)。
