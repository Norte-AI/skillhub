# 首版客户端环境调查（T01）

调查日期：2026-10-14（Asia/Shanghai）。范围：只读产品身份、版本、目录和官方资料；未读取密钥或修改全局配置。

| 客户端 | 实测产品与版本 | 入口 | 状态 |
| --- | --- | --- | --- |
| Codex | Desktop 26.1007.71326，build 20398；CLI 0.162.0-alpha.17.2 | `/Applications/ChatGPT.app`，bundle `com.openai.codex`；CLI `/Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex` | 产品已确认 |
| Kimi | Kimi Code CLI 0.38.0 | `/Users/badpasta/.kimi-code/bin/kimi`，arm64 可执行文件 | 后续参考，不属于首版目标 |
| Kimi 桌面 | Kimi 3.2.16，bundle `com.moonshot.kimichat` | `/Applications/Kimi.app` | 用户已确认首版目标；需验证 Work 与 Chat 模式 |
| ZCode | Desktop 3.15.3，build 3.15.3.8237，bundle `dev.zcode.app` | `/Applications/ZCode.app` | 产品身份已确认；PATH 中无 `zcode` 命令 |

本机配置根：Codex `/Users/badpasta/.codex`；Kimi Code（非首版）`/Users/badpasta/.kimi-code`；ZCode `/Users/badpasta/.zcode`。`/Users/badpasta/.kimi` 当前仅发现 `kimi-claw` 子目录，不能作为当前 Kimi Code CLI 配置根。

证据命令：`command -v codex kimi zcode`、`codex --version`、`kimi --version`、`kimi --help`、读取各应用 `Contents/Info.plist` 的名称/版本字段及目录名称。没有读取 auth、credentials、OAuth 或配置中的值。

实施结论：三类客户端均有官方自建插件市场路径，市场和 manifest 格式不同；Skill Hub 应输出三份适配产物。Kimi 首版目标已由用户明确为桌面 Kimi.app；CLI 调查仅保留作后续参考。桌面个人插件市场已有官方入口，但接入与真实加载须独立验证。T01 身份调查已有证据，T02–T04 新会话加载仍未验收。

见 [Codex](codex.md)、[Kimi](kimi.md)、[ZCode](zcode.md)。

桌面补充：Kimi.app 声明 `kimi` 与 `kimi-work` URL schemes。应用包内包含 daimon-bundle 与 builtin-skills；这些打包资源不是可写的用户规则入口。详情见 [Kimi Desktop](kimi-desktop.md)。
