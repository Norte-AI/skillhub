# 合并部署的数据迁移

此脚本只在操作者明确给出源库、目标库后运行。它不停止旧服务、不猜测密码、不覆盖目标已有数据，也不把原数据库或签名私钥放入Git仓库、Web静态目录或日志。

统一部署使用一台PostgreSQL：Registry原有`public` schema保持不变，Runtime使用独立`skillhub` schema。迁移脚本拒绝以`public`作为源或目标schema，避免混淆Registry实体。

## 迁移步骤

1. 保持旧部署数据与服务可恢复。安排短暂写入冻结窗口：脚本读出的是一个一致性时间点；如果旧库随后继续接收写入，新写入不会自动同步。不要在核验前改客户端指向或删除旧库。
2. 用安全进程环境设置`SKILLHUB_MIGRATION_SOURCE_DATABASE_URL`与`SKILLHUB_MIGRATION_TARGET_DATABASE_URL`。源为旧Runtime数据库，目标为统一部署Registry所在数据库；本机端口分别可能是55432和48232，具体以本机部署配置为准。变量值不得粘贴进操作记录或脚本参数，不使用未提供的账号。
3. 从统一仓库执行：

```sh
npm --prefix runtime run migrate:unified -- --backup-dir /absolute/private-backups/runtime-migration-unique --source-schema skillhub --target-schema skillhub
```

备份目录必须是全新绝对路径；创建权限0700。输出`state.json`、`snapshot-report.json`和`migration-report.json`权限均0600。快照包含设备令牌哈希等内部状态，按敏感备份保护，不公开、不提交版本控制。报告仅显示规范化状态SHA256、各集合数量和备份路径，不含URL、凭据或正文。

4. 独立验证记录的固定快照与目标：

```sh
npm --prefix runtime run migrate:unified -- --verify --snapshot /absolute/private-backups/runtime-migration-unique/state.json --target-schema skillhub
```

此时只需目标环境变量，verify只执行只读事务，不创建schema或写报告。也可不传snapshot，明确提供源库环境，读取当前源库与目标对比；若旧库继续写入会检测为不同，不能自动覆盖。

源端只调用`PostgresStore.readSnapshot()`，不调用会创建或迁移schema的`init()`；底层是`REPEATABLE READ READ ONLY`事务，所有集合在同一快照读取。目标首次初始化schema后调用`importLegacy({state})`，在事务advisory lock下验证完整状态、拒绝非空目标。重复执行若目标完全一致返回`already-identical`；不同目标返回失败，源和目标原有内容保留。没有force覆盖参数。

## 单独保护磁盘内容、签名密钥与Git历史

数据库快照不替代以下文件的备份：

- 原Runtime data目录中的上传文件、导出产物、Git裸仓库和原始发布历史。
- `.skillhub-keys/private.pem`及可信公钥文件；保持原密钥避免历史签名身份变化。
- 部署secret和角色配置，通过secret挂载恢复，不能写入仓库或公开报告。

这些目录应由部署操作者复制到独立0700私有备份目录，密钥0600；按文件SHA256清单核对源/备份，再复制到新的私有挂载卷。排除旧PID、operation/service锁和日志文件，不能把旧进程状态当成新进程。保持Git对象、refs、hooks以外的发布历史原样；不要运行来源仓库脚本或hook。迁移脚本不自动复制或公开这些文件，数据库验证成功也不宣称磁盘与签名恢复完成。必须分别核对新服务读取历史Release、验签与Git refs之后再切换客户端入口。

## 验证范围

`tests/migrate-unified.test.mjs`使用随机独立源/目标schema，真实PostgreSQL验证完整状态导入、重复执行一致、拒绝冲突、源状态未变、0600快照、纯验证和命令行秘密拒绝。测试结束只删除自己的随机schema。测试不执行真实部署迁移、不停止旧4317服务。
