# Norte SkillHub 规则运行时模块

本目录是 **Norte SkillHub 主项目的运行时模块**，从原 Node 原型迁入。唯一主仓库为 [Norte-AI/skillhub](https://github.com/Norte-AI/skillhub)，统一里程碑与当前任务状态见 [统一项目计划](../docs/unified-project-plan.md)。本模块不再作为必须独立运营的另一个平台。

运行时负责 Rule、Skill、角色组合、不可变Bundle Release、Ed25519签名、渠道回滚、设备授权、固定会话、MCP与分层回执。注册中心负责账号、命名空间、技能上传扫描审核、Git发布及来源同步；固定公开PUBLISHED技能版本可以导入运行时继续组合和签名发布。

## 使用统一环境

在主仓库根运行 `scripts/norte-local.sh up`，通过注册中心 `http://127.0.0.1:48230/` 登录。SUPER_ADMIN打开 `/dashboard/runtime`，浏览器请求由Java网关校验同一登录会话，内部运行时令牌不提供给浏览器。部署、持久卷、密钥与备份见 [本机部署](../deploy/norte-local/README.md)。

客户端使用统一地址：

- MCP：`http://127.0.0.1:48230/runtime/mcp`
- API：`http://127.0.0.1:48230/runtime/api/`
- Codex Git快照：`http://127.0.0.1:48230/runtime/git/codex.git`（先构建并发布相应快照）

客户端使用运行时签发并分配范围的设备Bearer令牌，不使用注册中心账号密码或浏览器cookie。三端操作见 [客户端命令](docs/integrations/native-client-operations.md)，能力证据见 [客户端验收](docs/acceptance/2026-10-15/clients/README.md)。Kimi采用用户确认的固定版本显式初始化与实测HTTP MCP；原生自动Rule注入和stdio工具公布失败记录保留。

本轮迁入、旧数据导入及只读摘要核对已通过；统一HTTP/MCP/Git/权限与三目标签名发布已实际验收，部署18项冒烟通过。详细证据见主仓库统一计划，最终仓库交付单独跟踪。

## 独立模块开发与验证

以下命令在 `runtime/` 下运行，仅用于模块开发或隔离验收：

```sh
npm ci
npm run check
npm run test:db
npm run test:fault
npm run bench:build
npm run drill:restore
```

数据库测试按 `docs/backend-testing.md` 配置测试库；不得把开发fixture默认凭据用于统一部署。吞吐基准为本机短任务有界结果，不是生产SLA；恢复脚本只处理其自身合成临时数据。

旧数据迁移使用 `npm run migrate:unified -- --backup-dir <新的绝对私有目录>`。源/目标连接串仅通过 `SKILLHUB_MIGRATION_SOURCE_DATABASE_URL`、`SKILLHUB_MIGRATION_TARGET_DATABASE_URL` 提供，不写入命令参数、Git或日志。脚本只读源快照，备份目录0700/文件0600，拒绝覆盖不一致的非空目标；可用 `--verify --snapshot <私有state.json>` 复核。必须先确认源/目标schema与本机备份位置，再执行；不指向注册中心public schema。

## 文档与历史

- [上传、审核与使用](docs/skill-upload-review-use.md)
- [签名与可信公钥](docs/signing.md)
- [本机故障、吞吐与恢复](docs/local-delivery.md)
- [历史实施记录](docs/progress.md)
- [历史T01–T29计划](docs/tasks-and-plan.md)

历史文档保留原路径、4317地址与双代码库决策以便追溯；当前项目边界、入口、状态以主仓库统一计划和部署手册为准。旧 `skill_hub` 原目录和旧服务保留，不因迁入而自动删除。
