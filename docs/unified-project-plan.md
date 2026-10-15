# Norte SkillHub 统一项目与交付计划

更新：2026-10-15。当前唯一主仓库为 [Norte-AI/skillhub](https://github.com/Norte-AI/skillhub)。此前的 Node 原型 `skill_hub`、上游评估站与组织 fork 的建设成果，现统一为 **Norte SkillHub 一个项目**；下表是唯一当前里程碑和任务状态入口。各模块内部历史计划、测试报告保留为可追溯证据，不再作为并行项目待办表。

## 目标与模块

目标是让团队在同一平台完成技能发布与审核、Git 来源同步、规则组合与签名发布，再让 Codex、ZCode、Kimi Desktop 按固定版本使用并保留可核查证据。

| 模块 | 目录/入口 | 职责 |
|---|---|---|
| 技能注册中心 | `server/`、`web/`、`cli/` | 账号与命名空间、上传、扫描审核、搜索下载、固定版本发布 |
| Git 来源 | 注册中心发布页与来源管理 | GitHub/GitLab公开或凭据别名来源，手动/定时/Webhook同步、持久队列与租约 |
| 规则运行时 | `runtime/` | Rule/Skill/角色组合、不可变Bundle Release、Ed25519签名、渠道与回滚、设备分配、MCP与回执 |
| 客户端适配 | `runtime/scripts/`及`runtime/docs/integrations/` | 三端安装、固定会话工作区、更新回滚、漂移检查、离线回执重放 |
| 本机部署 | `deploy/norte-local/`、`scripts/norte-local.sh` | 同一Compose项目启动、持久卷与私有配置、浏览器同源管理入口 |

注册中心与运行时保留各自数据契约：单Skill的发布版本不能替代Bundle Release的组合摘要、签名和会话绑定。它们通过受控导入衔接，不再要求用户在两个项目间手工搬文件。

## 统一里程碑与任务状态

“历史验证完成”表示对应既有证据已存在；“统一验收中”表示本轮合仓/网关/迁移后的运行行为尚在复核，不提前记完成。

| 里程碑 | 当前任务 | 状态 | 产物/通过标准 |
|---|---|---|---|
| U1 内容可发布 | 上传、审核、权限、签名构建、固定发布、GitHub/GitLab发布与同步 | 完成：本轮Java全量2285项零失败/错误、1跳过；前端1076项通过 | 注册中心与runtime既有测试；私有来源按用户确认以隔离集成验证交付 |
| U2 客户端可使用 | Codex/ZCode固定新旧会话与回滚；Kimi固定版本显式初始化；三端MCP | 完成：历史模型证据及本轮同源分发核验通过 | `runtime/docs/acceptance/2026-10-15/clients/`；Kimi采用用户接受的显式初始化及HTTP MCP |
| U3 一个项目与入口 | runtime入主仓库；SUPER_ADMIN会话网关；同源运行时工作台；已发布Skill导入 | 完成：统一权限/页面/导入验收通过 | `/dashboard/runtime`可达；非管理员拒绝；公开PUBLISHED固定版本导入，冲突/越界拒绝 |
| U4 旧数据可接续 | 只读源快照、私有备份、导入新runtime schema、摘要核对 | 完成：迁移摘要与统一运行链路通过 | 已迁移2个内容项、1 Bundle、1 Release、1渠道、1 listing；初始快照只读verify一致，迁移后HTTP/MCP/Git/签名与设备受限分发链路实测通过 |
| U5 本机可交付 | 单一启动说明、恢复演练、故障检查、当前状态与历史材料归档 | 本机运行验收通过，仓库交付中 | 唯一主仓库与启动脚本、完整备份边界、统一验收报告；不以源码合并代替运行验收 |

下一步完成runtime最终回归及仓库提交/推送，更新U5交付状态。更新本表时附本轮证据路径及失败/修复记录。历史原任务T01–T29映射：T01–T12归U1，T13–T25/T28归U2，T26–T27归U5，T29归统一文档；U3/U4是本轮合仓新增交付。

## 同一平台的操作链路

1. 在注册中心通过ZIP或GitHub/GitLab发布Skill，经过扫描和审核成为PUBLISHED固定版本。
2. SUPER_ADMIN从该固定公开版本执行“导入规则运行时”。导入保留注册中心namespace/slug/version及包SHA256来源；重复相同版本不制造新修订，冲突不覆盖。
3. 在规则运行时组合Bundle、构建签名Release，再切换渠道与分配设备。
4. 使用客户端固定Release工作区，按三端操作文档初始化会话；旧会话绑定保持原Release，渠道更新影响新会话。
5. 安装、获取、模型行为、自报回执分别记录。模型输出不是可信平台注入证明。

首轮导入只接受**公开、已发布、明确版本的UTF-8文本技能包**；不导入私有/待审核版本，不支持二进制资源。20 MiB总包/展开内容、10 MiB单文件、500文件及安全路径限制由服务端校验。后续扩展应单列任务，不能默认为当前已支持。

## 权限、部署与历史边界

浏览器管理沿用注册中心登录会话，Java网关只允许SUPER_ADMIN，运行时服务令牌不下发浏览器。客户端经同源 `/runtime/mcp` 与 `/runtime/api/` 使用独立设备Bearer令牌；浏览器登录cookie不替代设备令牌。Git导出为只读快照，本机端口继续只绑定回环，private listing不等于Git鉴权。

当前本机统一入口为 `http://127.0.0.1:48230/`，运行时页 `/dashboard/runtime`。内部runtime不额外暴露宿主端口。旧4317与48130属于历史开发/评估环境，保留作为迁移来源或回查材料；不再是新用户必须同时启动的另一项目。不得擅自删除旧目录、旧卷、旧密钥或真实客户端配置。

Git平台支持GitHub与GitLab，**不支持Gitee**。公网部署按用户确认不在本轮范围；真实外部私有仓库验证按用户决定后补，隔离验证结果不能写成真实外部验收。

历史证据入口：`runtime/docs/progress.md`、`runtime/docs/tasks-and-plan.md`、`runtime/docs/acceptance/`、`docs/norte-acceptance/`。这些文档含当时地址、代码库划分和测试计数，阅读时以本统一计划与最新部署说明为当前依据。


## 本轮统一验证证据（持续更新）

已完成：runtime最终真实数据库108项、前端1076项通过；初始迁移快照只读verify摘要一致；统一运行时网关匿名401、普通发布者403、SUPER_ADMIN 200，meta与CSP检查通过。端到端公开weather固定版导入及重复导入revision1、三目标签名/stable/listing/Git发布、设备受限MCP固定取件和Git ls-remote均已通过；统一部署18项冒烟通过。Java全量后端结果与最终仓库交付仍在收尾。

同一PostgreSQL中注册中心固定`public` schema，运行时固定`skillhub` schema。Java的Hikari和Flyway均显式指定public，避免账号名skillhub使默认search_path落入运行时schema。修复不使用baseline、不搬表，不改变原迁移历史。


## 可跟踪任务清单

| ID | 任务与验收点 | 状态 | 依据/下一步 |
|---|---|---|---|
| N01 | runtime源码、契约、客户端工具及证据迁入主仓库 | 完成 | `runtime/`作为主项目模块 |
| N02 | 单登录SUPER_ADMIN运行时网关与页面 | 完成 | 浏览器iframe、无内部token、401/403/200、internal拒绝 |
| N03 | 同库public/skillhub schema隔离 | 完成 | Java Hikari/Flyway显式public，无baseline/搬表 |
| N04 | 旧数据只读快照、私有备份及一致迁移 | 完成 | 2内容项/1Bundle/1Release/1渠道/1listing，verify一致 |
| N05 | 注册中心公开PUBLISHED固定版本导入runtime | 完成 | weather实际导入及重复revision1；权限/包路径边界验证 |
| N06 | 同源签名发布、设备API/MCP与Git出口及真实导入衔接 | 完成 | 真实Registry weather→三端签名Bundle通过；设备固定MCP与Git出口通过；12项exporter/productflow检查通过 |
| N07 | 跨卷Git发布EXDEV故障修复 | 完成 | 8定向测试及部署后实际发布 |
| N08 | 统一Compose本机部署、文档与冒烟 | 运行验收完成 | staging18/18；文档以本计划为唯一状态入口 |
| N09 | 本轮后端全量回归、最终仓库提交推送 | 回归通过，仓库交付中 | Java BUILD SUCCESS：2285项，0失败/0错误/1跳过；待commit/push/PR |
| N10 | 旧4317停止并保留数据、密钥、历史 | 完成 | service已停止，原目录/数据/密钥保留；旧README重定向主项目 |
| N11 | 公网部署 | 不执行（用户排除本轮） | 本机loopback交付，不作为阻断 |
| N12 | 真实外部私有GitHub/GitLab取件 | 延期（用户同意后补） | 隔离集成测试已交付，不声称真实外部通过 |
| N13 | Kimi原生自动Rule注入 | 未通过；采用已接受适配 | 用户接受固定版本显式初始化；HTTP MCP实测通过 |
| N14 | Gitee支持 | 不在支持范围 | 当前仅GitHub/GitLab，不能把URL可填写视作支持 |
| N15 | 统一整栈全卷备份恢复演练 | 待执行 | 本轮仅原模块历史恢复与迁移快照验证；尚未实际恢复Registry/MinIO/runtime数据/Git/密钥整套快照 |

本轮详细结果见 [统一验收报告](norte-acceptance/unification-2026-10-15/README.md)。运行验收与仓库交付分别留证；本次统一分支包含上述源码与文档。


旧4317受管服务已停止，旧数据和密钥保留。备份验收分层：原runtime模块真实PG/数据/Git/签名联合恢复演练与本轮迁移只读快照校验已完成；统一Compose整栈所有卷及私有配置的联合恢复尚未执行，见N15。不能把前者泛化为统一整栈恢复已通过。本机运行交付与N15后续演练分别跟踪。


补充边界：N05实际weather固定版本导入通过，但将其继续组合为三目标Bundle时发现SKILL frontmatter name与registry-hash内容ID映射差异导致构建400。已修复exporter并补12项检查，真实weather导入后成功构建三端签名Bundle，N06复验通过。原400保留为故障历史，不是当前未解决项。


后端全量最终结果：BUILD SUCCESS，2285 tests、0 failures、0 errors、1 skipped；不把跳过项计为通过。N09现只剩最终commit/push/PR交付，N06真实weather后续构建复验已通过。


N06最终证据：`runtime/docs/acceptance/2026-10-15/unified-gateway/registry-bundle-results.json`。真实Registry weather固定版本经受控导入、组合、三端构建及验签通过；exporter/productflow 12项检查通过。runtime全量最终复跑收尾中，不再将名称映射400记为当前失败。
