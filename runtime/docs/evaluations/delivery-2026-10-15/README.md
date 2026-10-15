# 本机稳定性交付记录

日期：2026-10-15。只操作临时目录、随机 PostgreSQL schema 和自建恢复数据库；未停止或覆盖 4317、48130、48230 服务，未复制真实密钥。

| 项目 | 实测结果 | 证据 |
|---|---|---|
| 有界构建调度/吞吐 | 100 jobs、4 workers、三目标，100 ready，300 签名校验成功；92.69 jobs/s，p95 57 ms | [benchmark.json](benchmark.json) |
| 故障与权限回归 | 26 通过、0失败、0跳过：损坏产物、错误可信密钥、离线回滚、并发锁、符号链接、令牌撤销、Host和权限、Git发布互斥 | [fault-tests.tap](fault-tests.tap) |
| 真实进程终止 | SIGKILL 下载进程，无成功安装状态；doctor识别残留锁；操作员恢复锁后，首次无缓存断网安装准确失败 | [interruption.tap](interruption.tap) |
| PostgreSQL 并发/恢复 | 6通过、0失败、0跳过；双实例租约、并发CAS、事务、令牌会话；真实pg_dump/pg_restore隔离库恢复 | [postgres-recovery.tap](postgres-recovery.tap) |
| 数据/Git/签名联合恢复 | 同一静止窗口复制，删除源，再恢复；Release相等、验签成功、Git fsck/commit/snapshot相等，撤销和会话状态保留 | [restore.json](restore.json) |

复跑命令和正式备份操作顺序见 [本机交付手册](../../local-delivery.md)。基准是单进程 JSON 临时数据、短任务、本机结果；不能外推为生产容量、跨进程 JSON 写入或分布式扩缩容能力。PostgreSQL 备份演练使用现有开发库中的随机测试 schema，只备份该 schema，恢复到随机新库。

未部署公网；用户确认本轮只需本机交付，因此不是本轮阻断。客户端真实新旧会话行为由对应验收记录确认，不能从这些服务端测试推断通过。
