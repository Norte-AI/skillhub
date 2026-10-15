# HTTP、MCP 与 PostgreSQL 测试环境

当前包含工作台、上传审核、构建、签名、Git 分发与 HTTP/MCP/PostgreSQL。Codex 隔离安装与降版已验证；真实三端新旧会话加载另行验收。

## 当前地址

| 服务 | 地址 | 用途 |
|---|---|---|
| HTTP API | `http://127.0.0.1:4317/api/marketplace` | 市场数据，返回 JSON |
| 健康检查 | `http://127.0.0.1:4317/health` | 进程可用性 |
| 就绪检查 | `http://127.0.0.1:4317/ready` | 数据库可访问性 |
| MCP | `http://127.0.0.1:4317/mcp` | Streamable HTTP，使用 MCP 客户端 POST 协议访问 |
| PostgreSQL | `127.0.0.1:55432`，数据库 `skillhub` | 开发数据库，schema `skillhub` |

MCP 地址不是插件市场源，也不是普通网页。它采用无状态传输，GET 返回405；支持5个工具、2个资源模板和手动加载 Prompt。市场与管理工作台位于根地址 `/`。

## 启动和检查

在项目目录中运行：

```sh
npm install
npm run db:up
npm run db:migrate
npm run seed:db
npm run dev:db
```

另一个终端运行：

```sh
npm run backend:smoke
npm run test:db
npm run check
```

数据库脚本默认使用仅回环可访问的 Compose 开发数据库。环境变量 `SKILLHUB_DATABASE_URL` 可覆盖业务库，`SKILLHUB_TEST_DATABASE_URL` 可覆盖测试库；脚本不自动读取 `.env`，配置示例见根目录 `.env.example`。

`backend:smoke` 检查真实运行服务的 HTTP、数据库 readiness、HTTP MCP 和 PostgreSQL STDIO MCP，确认它们读取同一示例 Release。测试代码按随机 schema 隔离，不修改运行中的 `skillhub` 业务 schema；备份恢复演练另外创建并删除自己的恢复数据库。

普通 `npm test` 在没有测试数据库 URL 时明确跳过真实 PG 测试；完整服务端验收使用 `npm run test:db`。同一业务源应只选择一个后端，不同时启动 JSON 与 PostgreSQL 两套写服务。

## 已验证能力

- PostgreSQL 幂等迁移、实体存储、多实例读取与事务回滚。
- 内容修订和 Release 不可变、重复版本拒绝、渠道 generation 比较更新与回滚。
- HTTP 请求结构、大小、Content-Type、分页和准确错误状态。
- HTTP Host 白名单与 Origin 检查。默认允许 localhost/127.0.0.1/[::1]，部署域名通过 `SKILLHUB_ALLOWED_HOSTS` 显式配置。
- 管理员与设备分权；设备仅可访问所分配规则包；设备令牌只保存哈希，轮换和撤销跨进程生效。
- 固定会话绑定与幂等回执，防止跨设备或跨版本伪造绑定；客户端回执始终未验证。
- MCP 工具、资源和 Prompt 使用同一权限，支持 HTTP 与 STDIO。
- 审计记录身份、动作和对象；HTTP 响应有请求 ID，日志不保存令牌或请求正文。
- 隔离数据库 pg_dump/pg_restore 恢复及连接中断后的连接池恢复。

本机示例 `personal@1.0.0` 已从旧 JSON 事务导入 PostgreSQL，旧文件保留。数据库容器重启后 HTTP 与 MCP 仍读取同一版本。

## 身份与客户端证据边界

开发服务默认仅绑定回环地址；未配置 `SKILLHUB_TOKEN` 时允许本机管理员测试。设置该变量后，HTTP 与 HTTP MCP 都需要管理员或设备 Bearer token。非回环部署必须配置管理员令牌；远程部署的 TLS 由反向代理处理，当前没有 OAuth 授权服务器。

管理员通过 `/api/devices` 登记设备、`/api/devices/{id}/token` 发放令牌，通过 `/revoke` 撤销。设备只能提交 fetched、installed、injection_claim 回执。会话版本绑定和服务端取到内容，都不代表客户端已注入规则；所有当前回执保持 `trusted:false`、`verification:unverified`。

HTTP完整接口见 [HTTP API](http-api.md)，MCP工具和资源见 [MCP说明](../apps/mcp/README.md)，数据库操作与恢复见 [PostgreSQL说明](../infra/README.md)。

## 后续范围

本轮不进行三端客户端安装或对话操作。工作台、持久化构建 Worker、产物签名与 CLI 固定公钥验签已实现。三端真实加载、移动端视觉验收和大规模吞吐仍待完成。数据库目前按 schema 串行化写入，分页先在应用层完成，尚未进行大规模吞吐测试。

本地长期运行推荐 `npm run service:start`，检查 `npm run service:status`，停止 `npm run service:stop`。已存在 `.skillhub-keys/private.pem` 时后台启动默认启用签名。详细见 [服务管理](development-service.md) 与 [上传审核使用](skill-upload-review-use.md)。
