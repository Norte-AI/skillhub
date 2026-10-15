# Codex Git 市场安装、更新与回滚

2026-10-14 使用本机 `codex-cli 0.162.0-alpha.17.2` 的 `plugin` 子命令帮助和真实隔离安装验证。不同 CLI 版本应先检查 `codex plugin --help`。操作脚本不会调用模型，也不会发送对话。

## 隔离安装

项目服务运行在 `http://127.0.0.1:4317`，Codex 市场地址为 `http://127.0.0.1:4317/git/codex.git`。

脚本必须明确提供绝对路径的 `--codex-home`。以下使用独立临时目录，不修改现有 Codex 安装：

```sh
node scripts/codex-market.mjs --codex-home /tmp/skillhub-codex-check --action add
node scripts/codex-market.mjs --codex-home /tmp/skillhub-codex-check --action install
node scripts/codex-market.mjs --codex-home /tmp/skillhub-codex-check --action list
```

默认插件为 `personal`，市场为 `skill-hub`，Git 分支为 `main`。可以提供 `--source`、`--marketplace`、`--plugin`，添加 Git 市场时可提供 `--ref`。本地目录来源不接受 `--ref`。

脚本将 `CODEX_HOME` 仅设置到其子进程。对于 localhost 来源，还为该来源的 HTTP origin 添加子进程 Git 直连配置，以解决本机代理 `9910` 不可用的问题；不会写全局 Git 配置。来源地址不接受明文用户名和密码。

对应真实 CLI 命令为：

```sh
CODEX_HOME=/tmp/skillhub-codex-check codex plugin marketplace add http://127.0.0.1:4317/git/codex.git --ref main --json
CODEX_HOME=/tmp/skillhub-codex-check codex plugin add personal@skill-hub --json
CODEX_HOME=/tmp/skillhub-codex-check codex plugin list --marketplace skill-hub --available --json
```

直接运行 CLI 时不会自动应用脚本提供的 Git 直连配置。

## 正常使用

在 Codex 桌面的插件市场添加上述 Git URL，安装 `personal`，确认其处于启用状态。安装完成后开启一个新对话，使用 Skill 的适用任务验证其行为。既有对话和新对话应分别留存加载证据。

若明确要使用脚本管理实际安装，把 `--codex-home` 改为实际 Codex 目录，例如 `/Users/badpasta/.codex`。此时操作会修改该安装；本次验收只使用临时目录。

## 更新

先在 Skill Hub 完成审核、构建、stable 渠道更新和 Git 市场发布，再执行：

```sh
node scripts/codex-market.mjs --codex-home /tmp/skillhub-codex-check --action update
node scripts/codex-market.mjs --codex-home /tmp/skillhub-codex-check --action list
```

`update` 按顺序运行 `plugin marketplace upgrade skill-hub --json` 和 `plugin add personal@skill-hub --json`。Git 市场刷新失败，或 JSON 返回非空 `errors`，就停止安装步骤。升级市场快照本身不会替代重新安装插件。

## 回滚

在 Skill Hub 将渠道切回指定旧版本，并重新发布 Git 市场，然后执行同样的 `update`。列表中的安装版本应回到旧版本。历史发布记录仍保留。

指定历史 Git ref 适合新建隔离目录核验：

```sh
node scripts/codex-market.mjs --codex-home /tmp/skillhub-codex-old-check --action add --ref <历史提交或标签>
node scripts/codex-market.mjs --codex-home /tmp/skillhub-codex-old-check --action install
```

已添加市场再次 `add` 可能返回 `alreadyAdded: true`，不能将此结果当作市场已切换到另一个 ref 的证据。既有安装的回滚采用服务端渠道回滚及重新发布流程。

## 卸载

```sh
node scripts/codex-market.mjs --codex-home /tmp/skillhub-codex-check --action remove
```

这调用 `plugin remove personal@skill-hub --json`，移除插件及其本地缓存，保留市场配置。

## 实际验收证据与边界

- `/tmp/skillhub-codex-isolated`：通过 HTTP Git URL 添加市场，安装 `personal@skill-hub` 版本 `1.0.0`，CLI 列表确认 `installed: true`、`enabled: true`。
- 同一隔离目录：市场 upgrade 与重新安装成功，源版本仍为 `1.0.0`。
- `/tmp/hub-native-version-O1Qhzg/home`：单独的本地市场副本安装 `1.0.1`，随后恢复副本中的旧版本，重新安装得到 `1.0.0`，CLI 列表确认旧版本启用。该步骤验证原生 CLI 支持降版，未改动真实服务端渠道。
- 无模型会话或桌面新旧对话加载实验，故不将 CLI 安装及启用状态等同于实际指令注入成功。Kimi 和 ZCode 的加载验收另行执行。
- 临时目录是本次证据所在位置，清理之后不可再依赖其中的缓存；可按上述命令重新生成。
