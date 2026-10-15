# Norte SkillHub 统一本机部署

本环境用于本机验收，不面向公网。独立 project `norte-web-git-check`，Web 48230、API 48280、MinIO 下载 48290，运行时作为同一项目内部服务接入，不再需要用户另启4317原型项目；旧48130/4317保留作历史评估及迁移来源。需要 Docker Compose v2（支持 `!override`/`!reset`）、Java21、pnpm、Python3。服务使用现有 staging 测试管理员 `admin / Admin@staging2026`，不得直接用于公网。

仓库根执行 `scripts/norte-local.sh up` 构建并启动；`status` 检查，`logs` 查看日志，`down` 停容器但保留数据卷。GitHub与GitLab已配置，自动检查开启；随机Webhook主密钥首次写入 `.norte-local/git-config.json`（0600，目录0700，Git忽略），重启复用同一文件。备份时必须保留数据库、MinIO卷与此配置，否则既有Webhook密钥失效。可通过 `NORTE_LOCAL_STATE` 指定受保护目录。

原有验收环境继续使用其临时私有配置时，先复制到上述 `git-config.json` 再运行脚本，避免意外轮换主密钥。私有仓库配置按[Git发布指南](../../docs/skillhub/guide/git-publish.md)在此JSON中增加凭据别名及授权userId，勿在命令行、文档或Git中写Token。服务端options只返回当前用户获授权的别名。

Colima若无法自动转发VM端口，可用其SSH配置为48230/48280/48290建立独立loopback转发；不要结束已有共享SSH master。标准Docker Desktop通常不需要此步骤。验收环境通过完整staging与18项smoke检查；统一运行站为 http://127.0.0.1:48230/ ，来源页 `/dashboard/git-sources`；旧版本Git来源验收结果不替代本轮合仓后的统一验收。

手动同步、定时检查及Webhook都重新读取已配置仓库/ref并检查账号/命名空间权限，不能用Webhook payload指定来源。相同commit不重复发布；新commit需要新的SKILL.md版本，否则显示失败，保留既有版本。来源仅属创建用户，管理员身份不会继承其来源或跳过审核。


Webhook 接收成功立即返回202，只表示持久排队，不表示技能已发布；后台轮询后查看来源最近结果。数据库V76/V77迁移会在本机升级时自动执行；升级前应按现有备份手册保存数据库和私有配置。租约超时可恢复已领取任务；已成功发布但尚未来得及记录来源状态的崩溃窗口由版本不可变校验拒绝覆盖，需要人工核对已提交版本。


## 一个项目、模块与同源入口

本仓库是唯一主项目，`server/web/cli`为注册中心，`runtime/`为规则运行时。当前唯一状态表见 [统一项目计划](../../docs/unified-project-plan.md)。SUPER_ADMIN登录后打开 `/dashboard/runtime`，由Java按注册中心登录会话授权网关；普通登录用户不能使用运行时管理页。运行时服务令牌只存在内部配置，不下发浏览器。

客户端使用同一Web地址的 `/runtime/mcp`、`/runtime/api/`，携带运行时设备Bearer令牌；只读Git快照位于 `/runtime/git/`。浏览器账号cookie不能替代设备令牌。runtime容器不额外映射宿主4317端口，网关/代理使用Docker内部地址。该Git出口继续依赖本机loopback部署边界，不应直接改为公网。

技能详情的“导入规则运行时”接收公开、PUBLISHED且明确固定版本的UTF-8文本技能包，保留来源namespace/slug/version及包摘要，然后在运行时组合Bundle并签名发布。私有/未审核版本、二进制资源、超限/非法路径及冲突导入被拒绝；不会自动把一次Skill发布当作Bundle签名发布。

## 持久化与迁移

除数据库、MinIO、`git-config.json`外，备份还须覆盖 `.norte-local/runtime-token`、`.norte-local/runtime-keys/`、`runtime-data`、`runtime-git`与`runtime-keys`卷；目录0700、私有文件0600。签名私钥单独加密保管，数据库/Git/密钥属于同一静止发布窗口。不要输出 `docker compose config` 的完整渲染内容或把这些文件加入Git。

旧数据迁移脚本在 `runtime/scripts/migrate-unified.mjs`：源只读快照，目标独立runtime schema，先生成私有备份再导入；不覆盖不一致的非空目标，不迁移到注册中心public schema。用明确环境变量提供连接串，操作方法见 [runtime说明](../../runtime/README.md)。备份与迁移报告可能含设备/审计信息，必须保存在受控路径，不附入公开报告。

当前已导入2内容项、1 Bundle、1 Release、1渠道、1 listing；统一权限、HTTP/MCP、Git、三目标签名与固定版导入核验通过，18项部署冒烟通过；恢复演练历史证据仍保留，最终仓库交付以统一计划更新为准。`down`只停止同一Compose项目并保留卷；日常停止严禁附加`-v`。

Git平台支持GitHub与GitLab，不支持Gitee。公网环境不属于本轮交付范围；真实外部私有仓库验收由用户确认后补，不用隔离测试冒称真实外部已通过。


### 同库schema隔离与Java启动

注册中心使用PostgreSQL `public` schema，规则运行时使用 `skillhub` schema。数据库账号也叫 `skillhub`，PostgreSQL默认search_path可能优先同名schema，因此Java必须同时配置：

```dotenv
SPRING_DATASOURCE_HIKARI_SCHEMA=public
SPRING_FLYWAY_DEFAULT_SCHEMA=public
```

Compose override已固定这两个值；runtime继续显式选择自己的`skillhub` schema。不要用baseline跳过迁移、不要搬表或清空schema来掩盖search_path错误。核验数据库/schema时不得输出连接密码。

本轮已验证runtime最终真实数据库108项、前端1076项通过；源初始迁移快照只读verify摘要一致；运行时网关匿名401、普通发布者403、管理员200，meta与CSP检查通过。统一导入/签名发布/设备MCP/Git与18项部署检查也已通过，具体结果见统一验收报告；本轮Java全量及最终提交收尾单独跟踪。


旧4317受管服务现已停止，原数据、密钥与目录保留，日常使用统一48230。统一整栈全卷备份恢复演练仍待执行（统一计划N15）；本轮不能把原runtime历史恢复成功或迁移只读摘要一致当作Registry/MinIO/runtime/Git/密钥联合恢复已通过。
