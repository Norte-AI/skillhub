# HTTP API 与权限边界

服务入口 `apps/server/src/index.mjs`。`createServer({ store?, dataDir?, databaseUrl?, token?, authenticate?, allowLocalAdmin?, maxBodyBytes?, handleMcpRequest?, logger? })` 使用 storage factory；`databaseUrl` 默认 `SKILLHUB_DATABASE_URL`，管理员 token 默认 `SKILLHUB_TOKEN`。外部 store 同样执行幂等 init。返回 `{server,store,close}`，close 先停 HTTP 再关闭数据库；进程接收 SIGINT/SIGTERM 调用 close。

## 认证与授权

管理员 bearer token 可管理全部内容。设备 bearer token 由 `/api/devices/:id/token` 单次返回，由 store 保管哈希；设备列表只输出允许的公共字段，不返回凭证。撤销后旧 token 失效。

没有配置管理员 token 时，只有回环地址和 allowLocalAdmin 开启才能匿名本地管理。非回环主机启动必须配置管理员 token。请求 Origin 与 Host 不一致拒绝；这不替代 token 权限校验。

设备可读取 assignments 中 bundle 的版本、产物和市场条目；不能读可变内容库、设备管理或审计。设备只能为自己提交会话绑定和 receipt，不可伪造 deviceId、使用他人 session 或访问未分配 release。设备 receipt kind 仅允许 fetched/installed/injection_claim，source 强制 client-reported；store 的回执 trusted=false，提交声明不会升级为已验证。

## 路由

| 方法与路径 | 权限 | 用途 |
| --- | --- | --- |
| GET /health | 无认证 | 进程存活，不查询数据库 |
| GET /ready | 无认证 | 数据库可用返回 200，失败 503，不暴露详情 |
| GET /api/content | 管理员 | 可变内容列表 |
| POST /api/content | 管理员 | 内容修订 |
| GET /api/bundles | 管理员 / 设备已分配 | 规则包列表 |
| POST /api/bundles | 管理员 | 保存包定义 |
| GET /api/releases?bundle= | 管理员 / 设备已分配 | 版本列表 |
| GET /api/releases/:id | 管理员 / 设备已分配 | 固定版本详情 |
| POST /api/releases | 管理员 | bundleId/version 构建 |
| POST /api/channels | 管理员 | bundleId/channel/releaseId，支持 expectedGeneration CAS |
| GET /api/resolve?bundle=&ref=stable | 管理员 / 设备已分配 | 固定版本解析 |
| GET /api/artifacts/:releaseId/:target | 管理员 / 设备已分配 | codex/kimi/zcode 产物 |
| GET /api/marketplace?q=&target= | 管理员 / 设备已分配 | 市场查询 |
| GET /api/marketplace/:bundleId | 管理员 / 设备已分配 | 市场条目 |
| POST /api/marketplace/publish | 管理员 | 固定版本上架 |
| POST /api/marketplace/unpublish | 管理员 | 下架 |
| GET /api/devices | 管理员 | 无凭证的设备列表 |
| POST /api/devices | 管理员 | id/name/client/assignments |
| POST /api/devices/:id/token | 管理员 | 返回一次原始设备 token，不要求 JSON body |
| POST /api/devices/:id/revoke | 管理员 | 撤销设备 token，不要求 JSON body |
| GET /api/sessions | 管理员 / 设备自身 | 会话绑定列表 |
| POST /api/sessions | 管理员 / 设备自身 | id/deviceId/releaseIds/source（设备可省 deviceId/source） |
| GET /api/receipts?deviceId=&sessionId= | 管理员 / 设备自身 | 回执列表，设备忽略他人 deviceId 筛选 |
| POST /api/receipts | 管理员 / 设备自身 | id/deviceId/sessionId?/releaseId/kind/digest?/evidence?/source? |
| GET /api/audit | 管理员 | 领域操作审计 |
| /mcp | 共用管理员/设备认证 | 转交 handleMcpRequest；MCP handler负责同样的资源权限 |

## 校验、错误与分页

带 body 的 POST 必须 `application/json`，顶层须对象，拒绝 null/数组。默认 body 上限 1MiB，以收到的字节数计算；超限后丢弃并消费剩余请求再返回413，避免销毁socket导致客户端收不到错误。token/revoke无payload路由不要求Content-Type。

400 为 JSON/字段/目标校验；401 未认证；403 越权；404 路由或资源不存在；409 重复版本、CAS冲突或不可变绑定冲突；413 超限；415 MIME；500 内部错误只返回 `Internal server error`，不回显数据库路径或凭证。

列表不传分页参数保持旧数组响应。传 `limit`（1–200，默认50）或 `cursor`（非负偏移）后返回 `{items,nextCursor}`。游标是列表偏移，当前实现不保证并发修改时的快照分页；固定 Release 与 Session 内容不可变。

认证后路由（含 MCP）使用 withAuditActor 将管理员/设备身份传入领域审计；只记录 role/deviceId，不携带token或body。

每个响应带服务端生成的 `X-Request-ID`。logger可记录 `{requestId,method,path,status,durationMs}`；启动入口启用 JSON 日志，不记录 Authorization、请求body、证据文本或查询参数。

## 验证

`tests/http-security.test.mjs` 覆盖 malformed JSON/object、MIME、UTF-8字节超限413、错误码/500脱敏、设备资源隔离、伪造设备与他人session拒绝、分页/readiness/close及MCP认证上下文。

`tests/http-devices.test.mjs` 使用真实文件store与auth验证管理员发token、设备分配过滤、回执不可变冲突、trusted=false、CAS409、撤销401与日志不含token；`tests/server.test.mjs` 保留原发布链路回归。HTTP针对Postgres的整体联调由项目集成验证另行记录。

## 上传审核、构建与页面（2026-10-14 增补）

`GET /`、`/assets/app.js`、`/assets/style.css` 提供六页工作台，静态资源不包含凭证；数据接口仍鉴权，Token 仅保留当前页面内存。

| 方法与路径 | 用途 |
| --- | --- |
| GET /api/submissions?status= | 待审、批准、拒绝记录；不传 status 返回全部 |
| GET /api/submissions/:id | 固定提交详情 |
| POST /api/submissions | contentId/title?/body/resources?/id?；生成 pending 快照 |
| POST /api/submissions/:id/reviews | decision=approve 或 reject，comment 非空；一次事务决定并创建批准修订 |
| GET /api/builds | 构建任务、状态、失败原因 |
| POST /api/builds | bundleId/version；返回 202，状态 queued |
| POST /api/git-marketplaces/publish | target=codex 或 zcode，将已上架固定版本生成 Git 快照 |

构建任务通过 queued/running/ready/failed 状态推进，记录输入摘要；排队后输入发生变化则失败，不默默构建新内容。Worker 通过租约领取任务，恢复过期 running 任务；原生目标导出校验与签名成功后才提交不可变 Release。同步 POST /api/releases 也执行原生导出校验。

批准只将精确稿件写入内容库，不自动上架。已纳入审核的内容不能通过直接编辑绕过发布门槛；新稿待审不阻止旧批准版本发布。

可配置 SKILLHUB_EDITOR_TOKEN、SKILLHUB_REVIEWER_TOKEN、SKILLHUB_PUBLISHER_TOKEN，必须使用不同凭据；配置任一 staff token 后关闭匿名本地管理。管理员仍具备全部权限。编辑可提交、保存规则/角色与包定义，审核人只能审核，发布人可构建、设置渠道、上架/下架及同步 Git。三者均可读取内容、审核、包、版本、构建和审计，不可管理设备；设备权限保持原来的分配规则。编辑不能通过 POST /api/content 直接创建 Skill，须走 submissions。MCP 保持管理员/设备访问，staff 不被自动赋予运行时 MCP 权限。

SKILLHUB_ALLOWED_HOSTS 配置逗号分隔的请求主机名；不含协议或端口。默认 Git 仅接受回环来源；Docker 桥接或代理需明确设置 SKILLHUB_GIT_ALLOW_REMOTE=1，仍只提供 clone/fetch，不允许 push。Git 读取是匿名分发，private 元数据不等同于 Git 授权。

内容与提交支持可选 dependencies 字符串数组，规则包构建递归展开并锁定依赖；所有传递 Skill 同样受审核检查。共享字段契约见 ../packages/contracts/schema.json，依赖循环或缺失报错，排队输入摘要覆盖完整依赖闭包。
