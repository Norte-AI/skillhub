# PostgreSQL 开发与恢复

开发数据库固定使用 `postgres:17.11-alpine`，仅映射 `127.0.0.1:55432`，数据保存在 Compose 的 `skillhub-postgres` volume。PostgreSQL 官方列出 17 系列仍在支持期，建议使用该系列当前 minor；升级镜像前先完成恢复演练。[官方版本策略](https://www.postgresql.org/support/versioning/)

```sh
docker compose -f infra/docker-compose.yml up -d --wait
export SKILLHUB_DATABASE_URL='postgres://skillhub:skillhub-local-development@127.0.0.1:55432/skillhub'
```

默认密码是开发 fixture，部署环境通过 `SKILLHUB_POSTGRES_PASSWORD` 设置自己的值，并使用对应连接串。修改这个变量不会修改已初始化 volume 内的数据库角色密码。

`createStore({databaseUrl,dataDir})` 返回尚未初始化的 store：配置数据库时使用 PostgreSQL，否则保留 JSON 文件后端；调用方执行 `await store.init()`。HTTP、MCP 应使用同一个数据库和 schema，默认 schema 为 `skillhub`。关闭服务时调用 `store.close()`；传入外部 `pg.Pool` 时由调用方关闭 Pool。

## 存储与并发

每个内容修订、Bundle、Release、渠道、市场条目、设备、会话绑定、回执和审计事件分别写入自己的实体表，payload 使用 JSONB。数据库不是整个 `hub.json` 的单行存储。Release 和内容修订保留不可变历史；会话绑定、回执和审计事件采用追加策略。

`schema_migrations` 记录迁移版本，`init()` 幂等执行。写操作在同一 Pool client 上执行事务，先取得 schema 对应的 transaction advisory lock，再加载最新实体、运行业务校验和保存变化；失败时回滚全部变更。渠道 `expectedGeneration` 在这个临界区中比较，避免多个进程覆盖彼此的发布。读操作使用只读 Repeatable Read 事务取得一致快照，每次读均刷新，设备令牌撤销能被其他进程读到。[node-postgres 事务要求](https://node-postgres.com/features/transactions)、[PostgreSQL advisory locks](https://www.postgresql.org/docs/17/explicit-locking.html#ADVISORY-LOCKS)、[事务隔离](https://www.postgresql.org/docs/17/transaction-iso.html)

首版写锁按 schema 串行化，读操作加载实体集合。适用于当前小团队规模；大目录的分页和更细粒度锁尚未实现。

## 导入旧 JSON

```sh
node packages/storage/import-legacy.mjs --data .skillhub-data --database-url "$SKILLHUB_DATABASE_URL"
```

可用 `--schema <name>` 指定目标 schema。导入要求目标业务实体为空，拒绝覆盖已有数据；检查内容/产物摘要、引用关系和路径。整次导入在一个写事务里完成，失败后目标仍为空，原 JSON 文件保持原样。不要同时让旧文件后端和新数据库后端各自接受写入。

## 自动验证与恢复演练

```sh
SKILLHUB_TEST_DATABASE_URL="$SKILLHUB_DATABASE_URL" node --test tests/storage*.test.mjs
SKILLHUB_TEST_DATABASE_URL="$SKILLHUB_DATABASE_URL" SKILLHUB_TEST_PG_DOCKER_BACKUP=1 node --test tests/storage-postgres.test.mjs
```

没有测试 URL 时，真实 PostgreSQL 测试明确跳过，不当作已验证。测试为每次运行创建 `skillhub_test_<uuid>` schema，并仅删除这些测试 schema。数据库 dump/restore 演练额外要求本地上述 Compose fixture 和显式 `SKILLHUB_TEST_PG_DOCKER_BACKUP=1`。

恢复测试使用容器内 PostgreSQL 工具，以 `pg_dump --schema <fixture> --format=custom` 仅备份新建的测试 schema，再通过 `pg_restore --single-transaction --exit-on-error` 恢复到新建的 `skillhub_restore_<uuid>` 数据库。核对不可变版本、渠道、固定会话、回执、审计记录及已撤销令牌后，仅删除自己的恢复数据库。不会 restore 到运行中的业务数据库。[pg_dump](https://www.postgresql.org/docs/17/app-pgdump.html)、[pg_restore](https://www.postgresql.org/docs/17/app-pgrestore.html)

生产备份应保存到业务之外的存储，并在独立数据库演练恢复。数据库备份包含设备令牌哈希和证据文本，应设置与业务数据相同的访问权限。
