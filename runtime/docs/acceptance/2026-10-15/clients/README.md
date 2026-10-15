# 本机客户端验收记录

日期：2026-10-15。任务范围 T02–T04、T15–T17、T22–T25 与 T28 的客户端部分。原始首版要求以 `docs/tasks-and-plan.md` 为准；本记录不将服务端/SDK测试换算成客户端验收。

| 项目 | Codex | ZCode | Kimi Desktop |
|---|---|---|---|
| 原生版本 | CLI 0.162.0-alpha.17.2 | Desktop 3.15.3 / bundled CLI 0.16.9 | Desktop 3.2.16 |
| 原生包安装与实际使用 | 隔离安装与enabled通过 | 隔离安装与enabled通过 | 离线安装及真实UI安装、显式选择Skill通过 |
| 原生v1→v2→回滚v1 | 通过 | 通过，必须刷新marketplace | 离线版本断言通过；UI独立版本选择与回滚通过 |
| 原生卸载 | 通过 | 通过 | UI专名stdio失败样例卸载通过，个人市场与源文件保留 |
| 用户自有规则/笔记保留 | 通过 | 通过 | 通过（隔离share目录） |
| 真正模型新会话v1/v2/回滚 | 通过，项目规则/Skill路线 | v1/v2及回滚后全新v1会话通过 | 固定版本插件＋显式读取RULES初始化通过；原生自动注入未通过 |
| 真正客户端MCP固定Release调用 | 通过 | 通过 | HTTP真实调用通过，保留stdio失败记录 |
| 旧模型会话保持固定版本 | 适配路线通过，同一session ID续接仍v1 | 适配路线通过，同一session ID续接仍v1 | UI独立版本插件已验证，详见kimi-ui |
| 服务端可信注入证据 | 未取得 | 未取得 | 未取得 |

`native-clients.json` 是可重跑离线原生探针的完整记录。全程 macOS OS sandbox 禁网、禁止临时根外写入，原生安装不是模拟工具。ZCode官方插件CLI随桌面应用内置，之前文档“未发现独立CLI”的结论已被本次实际发现覆盖。Kimi使用真正Desktop附带Daimon命令，不借用独立Kimi Code CLI结论。

`codex-sessions/model-sessions.json` 与三个JSONL记录真实模型新会话，Release为session-probe@1.0.0、1.1.0、1.0.0。模型均未显式打开AGENTS.md而报告正确规则，并实际调用工具读取参考文件。`codex-sessions/mcp.jsonl` 另记录真实Codex MCP get_content调用成功，固定releaseId=session-probe@1.0.0，非SDK模拟调用。

模型输出本身是行为证据，不提升为可信服务端注入回执。Codex模型测试使用现有账号、ephemeral独立会话和read-only权限；未复制认证或更改实际用户配置。ZCode使用独立临时项目及项目scope插件，通过当前登录账号创建专用测试会话，不向既有聊天发送消息。

复跑入口与操作方法见 [三端本机操作](../../../integrations/native-client-operations.md)。Kimi Desktop实际UI结果见[kimi-ui](kimi-ui/README.md)，原生自动Rule注入未通过；用户接受的固定版本+显式初始化路线另列，不将其改称原生自动。

## 不可变会话适配已完成

`codex-pinned/pinned-sessions.json`与`zcode-pinned/pinned-sessions.json`均记录旧会话首次v1→独立新会话v2→恢复同一个旧native session ID并实际重读reference仍v1。不是两个新会话代替续接。原生插件ID附Release digest，独立workspace不被stable更新改写。`bound-resume.jsonl`是最终加入native-session绑定防护后的实际再次续接结果。

`client-session-workspace.mjs`提供prepare/doctor/launch，`npm run client:session -- ...`可执行。绑定后禁止其他Release覆盖；resume ID必须匹配；受控资源额外插入、修改或symlink被doctor拒绝。普通回归不会调用模型；显式--run-model使用现有登录账号。

原生安装、会话适配与回执队列测试18项通过，语法检查另见根整合结果。MCP协议、服务端离线缓存、签名/损坏/并发恢复已有独立测试；它们不伪装成三种桌面产品自身的能力。

ZCode项目级`.zcode/config.json`专名stdio MCP已真实连接并调用`mcp__norte-hub-acceptance__get_content`，返回固定session-probe@1.0.0的v1正文。`zcode-pinned/mcp.json`是实际响应；`mcp-tools.json`仅抽取我们新建测试session的toolCalls/text，未复制原始请求headers或认证内容。

## 对原验收矩阵的逐项映射

| 原验收项 | 已取得证据 | 判断边界 |
|---|---|---|
| 市场筛选、正确产物选择 | 现有marketplace/exporter测试；native-clients三端同一包目标 | 服务端/原生CLI层，桌面市场筛选UI不混算 |
| 首次安装与新会话 | Codex/ZCode真实新会话；Kimi UI独立插件 | Kimi显式初始化遵循用户接受范围 |
| stable更新后新会话 | 原生1.0.0→1.1.0；Codex/ZCode模型v2；Kimi UI v2 | stable解析与Release发布由服务端测试覆盖 |
| 旧会话规则与资源固定 | codex-pinned/zcode-pinned同一ID续接；Kimi UI旧任务重读 | 使用独立Release名称及session workspace适配 |
| MCP固定Release | codex-sessions/mcp.jsonl、zcode-pinned/mcp-tools.json、Kimi另记录 | 仅SDK成功不算此项 |
| 回滚后新会话旧版本 | Codex真实v1→v2→v1；三端原生版本断言；Kimi UI记录 | ZCode回滚后全新v1会话已通过，见rollback-new.jsonl；不以旧会话复用代替 |
| 离线/无缓存 | 三端禁网原生探针、现有CLI缓存故障回归 | 客户端原生离线模型能力不在证据内 |
| 中断/损坏/并发 | 原有CLI/签名回归+新launch锁和绑定/doctor测试 | 真实模型被取消保留失败，不伪报通过 |
| 用户规则与漂移 | native-clients用户AGENTS/笔记不变；session doctor变更与symlink拒绝 | 不改真实用户业务文件 |
| 卸载保留用户内容 | Codex/ZCode原生卸载；Kimi UI测试插件卸载另记录 | Kimi离线CLI无remove不虚构 |
| 获取/安装/注入/自报分离 | CLI仍loaded:false；模型行为单独JSONL；MCP工具事件 | 没有可信注入传感器，模型自报始终unverified |
| 行为案例与失败追溯 | 模型标记事件、原生退出码、失败共享更新resume记录 | 失败记录保留，最终适配路线复验成功 |

ZCode最终回滚后全新会话也通过：`zcode-pinned/rollback-new.jsonl`与`rollback-summary.json`记录新session ID并返回v1。新session不复用旧ID。离线回执队列已实现，真实HTTP集成验证成功设备重放、幂等及unverified边界，测试见receipt-queue.test.mjs。

Kimi真实UI已安装并选用独立v1/v2插件；用户接受的显式初始化路线实际读取固定RULES与reference，验证v1、v2以及回到v1旧任务仍为v1。详见[kimi-ui显式会话结果](kimi-ui/explicit-session-results.json)。自动系统Rule注入仍未通过；HTTP MCP真实取固定Release通过，服务端脱敏initialize/tools/list/tools/call证据见kimi-ui/http-methods.jsonl；专名stdio失败插件UI卸载通过，个人市场及源文件保留。
