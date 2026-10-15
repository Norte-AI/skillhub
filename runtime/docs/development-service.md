# 本地后台服务

使用 `node scripts/service.mjs start|status|stop` 管理本项目的后台服务。启动采用独立进程组，输入关闭、输出追加至 `.skillhub-data/server.log`，不依赖终端会话保持运行。

```sh
node scripts/service.mjs start
node scripts/service.mjs status
node scripts/service.mjs stop
```

服务默认访问地址为 `http://127.0.0.1:4317`。启动等待 `/ready` 成功；该接口包含数据库可用性检查。服务已由此脚本启动时，重复启动只返回已有 PID。端口已有可用的非托管服务时，脚本要求先关闭该服务。

配置继承环境变量：

- `SKILLHUB_DATABASE_URL`：覆盖项目开发数据库地址。
- `SKILLHUB_DATA_DIR`：覆盖 PID 与日志目录，相对路径按项目根目录解析。
- `SKILLHUB_SIGNING_KEY_FILE`：覆盖签名密钥。未指定时，自动使用存在的 `.skillhub-keys/private.pem`。
- `SKILLHUB_HOST`、`PORT`：覆盖监听地址和端口。

脚本不会在输出中打印数据库连接串、令牌或密钥内容。日志及 PID 文件权限为 `0600`。PID 文件保存进程号、启动时间身份、Node 路径和服务入口；停止前同时核对这些信息，避免误杀 PID 已被复用的其他进程。

`stop` 发送 `SIGTERM`，等待正常退出，不强制结束未退出的进程。无法确认进程归属时停止操作并保留记录供检查。`.service.lock` 防止并发启动和停止；如果操作被强制中断后遗留该文件，请先确认没有另一个管理命令正在运行，再清理锁文件。

故障时先运行 `status`，然后查看日志。数据库应先启动，再启动本服务。该脚本用于本机开发的持续运行；系统重启后的自动启动仍由系统服务管理器配置。
