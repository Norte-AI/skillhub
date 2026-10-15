# 本机交付与恢复操作手册

本轮交付范围为本机可运行、可停止、可恢复、可审计。公网域名、TLS、企业身份和远程主机不属于本轮验收条件。原 Node 原型位于 `skill_hub`；组织 fork 的 SkillHub 位于相邻 `skillhub`，两者的数据、令牌与启动命令不可混用。

## 日常运行

需要 Node >=22、Git、Docker Compose。先执行 `npm ci`，再按 [服务端测试环境](backend-testing.md) 准备 PostgreSQL 和运行配置；签名密钥按 [签名说明](signing.md) 单独创建。管理员、编辑、审核、发布令牌用独立随机值，保存在本地环境文件，不写入命令记录或文档。

已有工作台使用 `http://127.0.0.1:4317`；检查 `npm run service:status` 后再决定启动。`npm run service:start` 启动受管后台服务，`npm run service:stop` 停止受管服务。不要对不属于当前 PID 文件的进程执行 kill。`/health` 是存活检查，`/ready` 是存储就绪检查；只有 ready 成功才能继续读写验收。日志路径与 PID 所有权规则见 [服务管理](development-service.md)。

需要全新容器栈时使用 [容器部署](deployment.md)，单独的 Compose project、端口、命名卷和密钥；不得覆盖已有 4317、48130、48230 服务。停止使用 `down`，不要使用 `down -v`。

## 发版、回滚和故障处理

技能上传、审核、发版见 [操作说明](skill-upload-review-use.md)。先审查，再构建，只有 ready Release 才能上架。保留不可变 Release、Git snapshot tag、签名 keyId 和渠道 generation；回滚改变渠道指向，不改写旧产物。使用前在 CLI 固定可信公钥，执行 doctor；下载、暂存、客户端安装、会话加载分别验收。

失败构建在构建列表中显示 failed，修复内容后用新版本重试；不得把 failed 改为 ready。Worker 使用数据库互斥和过期租约，进程重启后可以重新接管；本机基准只证实短任务、多 Worker 无丢失，不代表已经实现分布式弹性扩容或生产大规模容量。

CLI 下载中断不会提交成功状态；SIGKILL 可能留下 `.operation-lock`。先确认锁记录对应的进程已退出、没有其他安装任务，再保留故障记录并移除这个锁目录，重试安装或从可信缓存回滚。不要用自动删除所有锁的脚本。doctor 报漂移时先备份用户修改，禁止用重新计算摘要掩盖签名错误。

## 一致备份窗口

1. 先停止所有 HTTP、MCP 写进程和构建 Worker，等待 Git 发布完成；记录当前 Release、渠道 generation、Git main commit、snapshot tag 和签名 keyId。
2. PostgreSQL 使用部署文档的 `pg_dump -Fc`；禁止直接复制正在运行的数据库卷。用失败即退出的执行器运行，并在退出码为 0 后才将临时备份命名为正式备份。
3. 在同一静止窗口备份数据目录和 Git bare 仓库，检查没有残留 `.publish-lock`。对备份文件计算 SHA256，保存不含凭据的清单。
4. 私钥单独加密备份，权限 0600，可信公钥和 keyId 随交付清单保存；不要把私钥并入可公开报告。
5. 重启原服务并检查 ready、已知 Release 和 Git ls-remote。备份保存到源码目录以外的受控位置。

## 隔离恢复与复核

创建独立空数据库、独立目录、独立端口。先核对 SHA256，再 `pg_restore --exit-on-error`；恢复 Git 与原签名私钥。不得把恢复目标指向运行中的服务。核对不可变 Release 正文和摘要、Ed25519 验签、渠道、listing、固定会话、回执、已撤销令牌仍不可用、Git `fsck --full`、main commit 和 snapshotDigest。复核完成后才能讨论切换。本轮只在隔离目标实际恢复，不切换已有服务。

可重复本机演练：

```sh
npm run test:fault
npm run test:db
npm run bench:build
npm run drill:restore
npm run check
```

`test:db` 创建随机 schema 和恢复数据库，结束时只删除其自建目标。默认本机数据库能执行 pg_dump/pg_restore 演练；自定义数据库不能自动声称此项通过，需配置独立备份工具。`drill:restore` 自动生成临时数据/Git/签名密钥，复制同一窗口快照，删除源，再实际恢复验证，最后仅清理自身临时目录。它不备份真实服务。

基准可配置 `BENCH_JOBS=100`、`BENCH_WORKERS=4`，范围分别为 1..1000 和 1..16。只在单进程隔离 JSON 存储运行；JSON 不支持多进程写入。跨进程共享应使用 PostgreSQL，其互斥和租约由真实数据库集成测试覆盖。报告可以用 `BENCH_REPORT=/absolute/path/report.json` 或 `RESTORE_REPORT=/absolute/path/report.json` 保存。

## 本轮结果与交付清单

2026-10-15 证据位于 [delivery-2026-10-15](evaluations/delivery-2026-10-15/README.md)：100 个构建任务、4 个 Worker、300 个三目标签名产物全部校验通过；短任务吞吐约 92.69 jobs/s，p95 单任务服务时间 57 ms。这是当前机器、当前样本的基准，不是生产 SLA。

交付包含源码、锁文件、Schema、迁移、容器配置、签名说明、上传审核使用说明、客户端接入说明、故障测试、吞吐脚本与备份恢复演练。真实客户端的会话加载证据由客户端验收文档单独记录；本机服务端通过不替代客户端验收。
