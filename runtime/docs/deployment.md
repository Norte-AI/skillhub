# 容器部署与恢复

这里提供可部署配置，尚未向外部域名或远程主机部署。配置使用 Node 22、Git 和 PostgreSQL，持久化数据库、数据目录与 Git 市场；新产物使用挂载的 Ed25519 密钥签名。现有本机开发服务和数据库不受此配置影响，默认容器名称前缀为 `skillhub-app`。

## 准备

Docker Compose 需要管理员令牌、独立数据库密码、数据库连接 URL 和已有私钥文件。先按 [签名说明](signing.md) 创建密钥，再在项目根目录创建未纳入 Git 的 `.env.deploy`：

```dotenv
SKILLHUB_POSTGRES_PASSWORD=replace-with-strong-password
SKILLHUB_DATABASE_URL=postgres://skillhub:replace-with-URL-encoded-password@postgres:5432/skillhub
SKILLHUB_TOKEN=replace-with-strong-admin-token
SKILLHUB_SIGNING_KEY_SOURCE=/absolute/path/to/private.pem
SKILLHUB_BIND_ADDRESS=127.0.0.1
SKILLHUB_PORT=4318
```

需要职责分离时，在 `.env.deploy` 设置不同的 `SKILLHUB_EDITOR_TOKEN`、`SKILLHUB_REVIEWER_TOKEN` 和 `SKILLHUB_PUBLISHER_TOKEN`，分别用于上传、审核和发布；留空则不启用该独立身份。

数据库密码包含保留字符时，连接 URL 内必须进行 URL 编码；POSTGRES_PASSWORD 保持原始密码。不要在终端输出完整 Compose 配置或提交该文件。Compose 本地 secret 使用文件挂载，须确认容器 node 用户能读取挂载文件；不同 Docker 平台可能保留宿主权限；Linux 部署时为专用密钥副本设置容器 node 用户的 UID/GID（1000:1000）与 0600 权限，再挂载。若遇到 EACCES，应使用仅容器可读的受控挂载或 secret 管理方案，不要直接公开私钥。

## 构建与启动

在项目根目录执行：

```sh
docker compose --env-file .env.deploy -f infra/docker-compose.app.yml config --quiet
docker compose --env-file .env.deploy -f infra/docker-compose.app.yml build
docker compose --env-file .env.deploy -f infra/docker-compose.app.yml up -d --wait
curl -fsS http://127.0.0.1:4318/ready
```

默认使用 4318 的示例端口，避免与本机 4317 冲突；没有设置 SKILLHUB_PORT 时配置默认 4317。应用初始化时自动执行幂等数据库迁移，不自动导入旧数据或种示例。访问管理页面时输入管理员令牌。已实际验证 Docker 镜像构建、Node 22/Git 可运行、服务模块可导入和网页资源存在；尚未启动此 Compose 应用栈或对外部署。healthcheck 只确认进程/数据库就绪，不代替 API、签名、发布和客户端验收。

```sh
docker compose --env-file .env.deploy -f infra/docker-compose.app.yml ps
docker compose --env-file .env.deploy -f infra/docker-compose.app.yml logs --tail 50 app
```

镜像安装依赖使用锁文件 `npm ci --omit=dev`，运行用户为 node。密钥不进入构建上下文或镜像，只以 secret 文件挂载。配置提供 restart policy 和终止等待；Docker healthcheck 标为 unhealthy 不会自动重启仍在运行的进程，需要监控与运维处理。

## 域名与 Git 边界

对外访问由反向代理提供 TLS，默认主机端口只绑定回环。API/MCP 需要 Bearer 身份；请保持 Host 白名单和 Origin 校验。部署域名与代理配置要在实际主机验证，当前未提供域名、证书和远程部署凭据。

Git HTTP 默认只接受 socket 回环来源；本容器配置显式设置 `SKILLHUB_GIT_ALLOW_REMOTE=1`，使桥接端口转发可读取 Git 市场。该开关只放行只读 clone/fetch，**不增加 Git 身份认证**。因此本配置继续将宿主端口绑定回环；若对外部署，反向代理必须为 `/git/` 配置独立访问控制，或使用受控 Git 托管。市场 listing 的 private 字段不能替代 Git 仓库访问控制。服务端不信任 forwarded IP 来放行来源。

服务端 `SKILLHUB_ALLOWED_HOSTS` 接收逗号分隔的主机名，例如 `127.0.0.1,localhost,skillhub.example.com`。加入域名后再验证代理 Host/Origin；不要通过开放任意 Host 解决部署问题。容器接入市场地址示例为 `http://127.0.0.1:4318/git/codex.git`，需要先在新数据库创建并发布市场；它不复用当前 4317 服务的数据。

## 数据一致性与备份

PostgreSQL 支持多个服务进程共享数据；旧 JSON 后端只支持单写进程。Git 市场快照有自己的写入边界，多个应用同时向同一仓库发布前应确认发布互斥策略。不要直接复制正在运行的 PostgreSQL 数据目录作为逻辑备份。

数据库逻辑备份示例：

```sh
docker compose --env-file .env.deploy -f infra/docker-compose.app.yml exec -T postgres \
  pg_dump -U skillhub -d skillhub -Fc > skillhub-backup.dump
```

同时备份 Git 市场卷、需要保留的数据卷和签名密钥。密钥备份单独加密保存，并记录可信公钥与 keyId；数据库/Git/密钥备份应属于同一发布窗口。备份数据库包含设备及权限等敏感数据，不纳入仓库。

恢复时先在隔离环境启动空数据库，使用 `pg_restore` 导入，再恢复 Git 快照和原发布密钥，核对内容修订、Release、渠道 generation、listing、会话绑定及设备撤销状态。恢复命令示例针对已确认的空目标库：

```sh
docker compose --env-file .env.deploy -f infra/docker-compose.app.yml exec -T postgres \
  pg_restore -U skillhub -d skillhub --exit-on-error < skillhub-backup.dump
```

数据库缺失 Git 快照时可以重新发布，但须先核对对应 Release；缺失原签名私钥时无法继续以原密钥签名，不应静默换钥。先完成隔离恢复和签名/HTTP/Git 核验，再切换真实服务。`docker compose down` 保留命名卷；`down -v` 会删除持久化数据，日常停止不要加 `-v`。
