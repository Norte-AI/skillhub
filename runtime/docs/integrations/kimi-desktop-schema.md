# Kimi Desktop 3.2.16 原生插件契约与纯校验

日期：2026-10-14。证据直接来自已安装桌面应用所携带的官方 Plugin Builder，不是 CLI 规则外推。

## 证据路径

脚本根：`/Applications/Kimi.app/Contents/Resources/resources/daimon-bundle/app/daimon/assets/builtin-skills/plugin-builder/scripts/`。

已读取 `validate_plugin.py`、`plugin_common.py`、`create_plugin.py`；后者支持 `--with-system-prompt` 和 `--with-session-start`，并生成对应 manifest 与文件。此次没有执行 create、register 或 install。

纯校验命令：`python3 -B <脚本根>/validate_plugin.py <plugin-dir>`。它只读给定插件的 manifest、文本、路径与locale文件，打印ERROR/WARN并退出；不调用登记或安装、不联网或请求令牌。plugin_common定义的网络/登记函数不会在此路径执行。`-B`避免导入生成pycache。WARN不会导致非零退出，ERROR退出1。

## 最小有效 manifest

```json
{
  "name": "skill-hub-probe",
  "version": "0.1.0",
  "interface": {
    "displayName": "Skill Hub Probe",
    "category": "PRODUCTIVITY"
  },
  "skills": "./skills/",
  "systemPromptPath": "./RULES.md",
  "sessionStart": { "skill": "hub-probe" }
}
```

目录同时包含 `RULES.md`、`skills/hub-probe/SKILL.md`（frontmatter name/description）和参考文件。若只验证manifest最少ERROR必填为name/version/interface.category；技能和系统提示组件可省略，但那样没有接入能力。

## 字段限制

- name：校验器要求 kebab-case；公共helper限制≤64字符。version为标准semver。
- category在interface内，helper列举 `PRODUCTIVITY`、`DEVELOPER`、`FINANCE`、`LIFESTYLE_HEALTH`、`SYSTEM`；不要把category放顶层。
- skills为路径字符串或数组；推荐 `./skills/`，每个直接子目录有SKILL.md，frontmatter需name和description。
- systemPrompt是字符串且≤32KiB UTF-8；systemPromptPath必须`./`开头、解析在插件根内、文件存在且≤32KiB。
- sessionStart是对象，skill是非空名字，校验器检查可找到对应插件技能；支持root SKILL.md回退。
- mcpServers必须为 `{name: object}`；每个服务至少url或command。允许键：command/args/env/cwd/executor/url/headers/auth/bearerTokenEnvVar/transport/enabledTools/disabledTools/enabled/startupTimeoutMs/toolTimeoutMs。未知键警告且运行时剥离；`type`不在允许键里，应使用transport。
- agents/commands路径需`./`且不能逃出根。hooks为事件数组，会话事件执行脚本；本探针不包含hooks。
- 不支持的顶层id/entryPoints/permissions/tools/apps/inject/configFile只警告并被忽略。
- defaultLocale/locales/tryPrompts/skillOverrides等发行展示要求缺失会WARN；因此纯结构0错误不等于公开市场发布合格。

## 实测

在系统临时目录生成上面的原生桌面样例（RULES+Skill+reference），运行桌面包内validate，退出码0；完整输出如下。未触碰用户配置、注册市场、安装插件或调用模型，临时目录已自动清理。

```text
[WARN]  interface.defaultLocale is missing (required by the platform, limited to zh-CN/en-US; may be left empty for the personal market)
[WARN]  interface.tryPrompts is missing or empty (required by the platform; at least one sample prompt)
[WARN]  interface.skillOverrides is missing (the platform requires every plugin skill entry to have displayName and description)
[WARN]  interface.locales is missing (required by the platform; locales/ together with defaultLocale must cover both zh-CN and en-US)
=> OK  (0 error, 4 warning)
```

结论：桌面官方结构校验已实测支持systemPromptPath与sessionStart.skill，不再只是CLI引用；实际客户端启用、会话初始化、更新回滚和loaded仍未验收。官方公开产品路线见 [个人插件创建](https://www.kimi.com/help/plugins-and-skills/create)。

## 程序化登记线索（未执行）

plugin_common明确支持 `kimi-daimon --node <node> kimi-plugin register-personal <dir> --share-dir <share> --market <name> --json`。这是一条随桌面builder交付的登记命令；登记不等于安装，随后客户端个人页点击安装。macOS默认share为 `~/Library/Application Support/kimi-desktop/daimon-share`，registry由官方CLI管理，不能直接写其JSON。上述仅源代码证据，未调用登记、不声称已安装。它补齐了此前“尚未发现桌面程序化入口”的调查线索，需root隔离验证命令帮助与行为后采用。

## 官方可执行路径与帮助实测

已确认随桌面交付的可执行入口：

- Daimon：`/Applications/Kimi.app/Contents/Resources/resources/daimon-bundle/bin/kimi-daimon`。
- Node：`/Applications/Kimi.app/Contents/Resources/resources/runtime/node`，它是桌面启动shim，使用应用的 Electron Helper 并设置 `ELECTRON_RUN_AS_NODE=1`，不是独立PATH中的Kimi Code CLI。

launcher明确支持第一组参数 `--node <path>`；plugin_common也构建此形式。在独立临时目录设置 `KIMI_SHARE_DIR=<temp>` 后只执行以下帮助：顶层 `--help`、`kimi-plugin --help`、`kimi-plugin register-personal --help`。三次均退出0，临时目录没有新增文件，结束已清理。未读取registry、会话或凭证。

实测帮助确认：

```text
kimi-daimon kimi-plugin register-personal <source> --share-dir <kimi-share-dir> [--market <name>] [--json]
kimi-daimon kimi-plugin register-personal <source> --home <kimi-code-home> [--market <name>] [--json]
```

实际调用形式应为 `<daimon-path> --node <node-path> kimi-plugin register-personal <absolute-plugin-dir> --share-dir <explicit-share-dir> --market <name> --json`。本地source必须绝对目录且有kimi.plugin.json。market缺省personal，非personal安装标识为`<id>@<market>`。

帮助明确 register-personal只登记不安装；安装请使用桌面个人页或控制协议 `kimiPlugin.personal.installPlugin`。同族普通 `kimi-plugin install` 不读Daimon配置、不连接运行中的daemon、不热更新已有Daimon进程，因此离线install结果不能当桌面激活证据。以上登记/安装命令只确认帮助与代码，尚未执行。

## 隔离登记预检限制（未执行）

计划对象 `.skillhub-test/exports/kimi-desktop-v1/plugins/personal` 已存在，manifest包含name/version/interface.category/skills/systemPromptPath。执行前检查发现打包 `dist/src/runner/cli.js` 与实现chunks经过字符串混淆；可读builder的plugin_common只能确认命令构造、registry目标约定，不能完整审计登记实现的联网、真实home回退读取和启动服务路径。依本次实验要求“源码无法确认隔离则不执行”，没有调用register-personal；无退出码或新增registry证据。

帮助把 `--home` 与 `--share-dir` 展示为两种替代目标形式；尚未确认两者同时传入的优先级和允许性，不能猜测组合参数可隔离。下一步需获得可审计实现/确认隔离目标解析，或由root采用受控独立进程沙箱验证后再登记。此前纯validate与help成功证据保持有效，但不代表登记成功。

## 2026-10-15 隔离登记与离线安装已实测

通过macOS `sandbox-exec`禁止网络和临时根外写入，以独立HOME及明确share-dir运行官方register-personal和install，全部成功。原生结果确认v1→v2→回滚v1、enabled=true，且明确`existingProcessBehavior=restart-required`。官方validate也以Python3.14实际运行通过（0ERROR，个人市场展示字段WARN仍保留）。证据见 `docs/acceptance/2026-10-15/clients/native-clients.json`。这取代此前“源码隔离无法确认而未执行”的历史状态；操作是受OS强制限制的真实命令，不代表真实桌面实例已激活。

发现官方登记器对自动生成的quoted frontmatter name返回带字面引号的skillNames。导出器现将已校验为安全kebab-case的自动name写为不带引号的YAML值；重跑登记断言skillNames恰为probe-skill，通过。用户原有frontmatter不在这里被静默重写。
