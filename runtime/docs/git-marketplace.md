# Git 插件市场接入

Git 市场向客户端交付版本化目录、原生插件 manifest、Skill 与参考文件。MCP 是运行时查询与工具调用服务；把 MCP 地址添加成 Git 市场不能安装插件，Git 地址也不是 MCP endpoint。

本地 Codex 市场入口为 `http://127.0.0.1:4317/git/codex.git`，分支 main，市场名 skill-hub；服务仓库由 `.skillhub-git/codex.git` 提供。它是当前机器的回环服务，其他设备访问自己的127.0.0.1不会访问这台服务器。后续线上分发需要用户提供真实Git远端地址并完成部署，不自动创建或宣称已有公开远端。

## Codex 官方支持与命令

本机 CLI `codex plugin marketplace add --help` 确认支持 `--ref` 与 `--json`；OpenAI官方文档明确来源可为 HTTP/HTTPS Git URL、SSH Git URL、GitHub简写或本地目录。[官方市场打包说明](https://developers.openai.com/plugins/build/plugins)、[官方CLI参考](https://learn.chatgpt.com/docs/cli/reference)

```sh
codex plugin marketplace add http://127.0.0.1:4317/git/codex.git --ref main --json
codex plugin marketplace list --json
codex plugin list --marketplace skill-hub --available --json
```

添加市场表示登记来源并解析目录，不等于安装插件，不证明Rule已进入新会话。选包安装与实际加载分别记录。

仓库市场使用 `.agents/plugins/marketplace.json`，plugin位于 `plugins/<name>`，source路径相对市场根。不要把API返回的市场查询JSON或MCP配置直接作为Codex原生catalog。

## 发布与更新

Skill Hub发布固定Release后生成原生插件与catalog，包含版本和对应文件，更新市场main的提交。客户端添加的是Git市场快照；刷新使用 `codex plugin marketplace upgrade skill-hub`，随后按客户端流程更新插件。manifest与catalog的版本必须一致，不能只刷新索引便宣称已安装或已加载新版本。

需要可复现固定版本时记录完整Git commit与Release ID；标签/固定ref只跟随对应Git对象，不自动跟随main。回滚应重新指定此前固定产物/提交，并核对文件digest和新会话加载证据。

## 验证范围

Codex隔离实验使用系统临时 CODEX_HOME，不读或复制auth，不修改真实用户市场。只运行 add、marketplace list和plugin list读取识别结果；不运行plugin add，不调用模型。本地Git服务已完成Codex实测，具体结果如下。

Kimi Desktop与ZCode需使用各自原生市场接入入口；此处Codex命令结果不代表其它客户端接入通过。

## Codex 实际验证结果（2026-10-14）

CLI版本 `0.162.0-alpha.17.2`。使用独立系统临时 CODEX_HOME，工作目录也为temp；不读/复制auth。第一次添加失败，Git请求尝试使用不可达 localhost:9910 代理。仅对重试子进程清空proxy环境、设置NO_PROXY回环地址，并用 `GIT_CONFIG_COUNT=1`、`GIT_CONFIG_KEY_0=http.proxy`、空 `GIT_CONFIG_VALUE_0` 覆盖Git运行时代理；没有修改全局Git配置。

重试以下三个命令全部退出0：marketplace add HTTP URL --ref main --json、marketplace list --json、plugin list --marketplace skill-hub --available --json。

- add：marketplaceName为skill-hub，alreadyAdded=false，installedRoot位于临时CODEX_HOME下 `.tmp/marketplaces/skill-hub`。
- list：市场sourceType=git，source为 `http://127.0.0.1:4317/git/codex.git`。
- plugin list：installed为空；available包含 `personal@skill-hub`，version=1.0.0，installed=false、enabled=false。
- 克隆文件：`.agents/plugins/marketplace.json`（name=skill-hub）、`plugins/personal/.codex-plugin/plugin.json`（name=personal/version=1.0.0）、`plugins/personal/skills/review-summary/SKILL.md`。

临时目录已清理。脱敏原始JSON与manifest记录见 [Codex Git探针](integrations/codex-git-probe.json)。此结果证明原生Codex能从实际HTTP Git服务添加并识别市场、解析已发布插件；尚未安装、启用或验证新会话加载。
