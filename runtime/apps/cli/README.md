# Runtime 本地 CLI

本模块属于统一主仓库的 `runtime/`。下列命令先从主仓库执行 `cd runtime`；安装依赖用 `npm ci --ignore-scripts`。CLI 使用 Node.js 原生 ESM。所有安装结果仅为 `staged`，不会修改 Codex、Kimi 或 ZCode 的全局配置，也不表示真实会话已加载规则。

```sh
node apps/cli/src/index.mjs list --server http://127.0.0.1:8787
node apps/cli/src/index.mjs install demo --client codex --server http://127.0.0.1:8787 --home /tmp/skillhub-demo
node apps/cli/src/index.mjs doctor --home /tmp/skillhub-demo
node apps/cli/src/index.mjs rollback --release r1 --client codex --server http://127.0.0.1:8787 --home /tmp/skillhub-demo
node apps/cli/src/index.mjs uninstall --client codex --home /tmp/skillhub-demo
```

`--client` 支持 `codex`、`kimi`、`zcode`。省略 `--home` 时使用 `~/.skillhub`。缓存已有目标版本时，回滚无需服务器连接；回滚限制在当前客户端安装的同一内容包内。

目录包含 `cache/<releaseId>/<client>.json`、`state/<client>.json` 和 `backups/<client>-<uuid>.json`。替换状态前保存上一份状态，下载或摘要校验失败时保留当前状态。`doctor` 检查活动状态及全部缓存的摘要，发现异常时命令退出码为 1。卸载移除该客户端的状态，保留缓存与备份供恢复使用。

原型每客户端同时只管理一个内容包；同一管理目录暂不支持多个 CLI 写进程并发执行。后续客户端适配器仍需实现配置注入与真实会话加载验证。

```sh
node --test tests/cli.test.mjs
```

原生客户端适配与固定会话启动另见 [三端操作文档](../../docs/integrations/native-client-operations.md)。在主仓库根目录也可直接 `npm --prefix runtime run client:session -- ...`。
