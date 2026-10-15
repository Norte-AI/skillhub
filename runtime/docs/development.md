# 本地开发与验证

当前实现支持 PostgreSQL 和单进程 JSON 两种后端，使用 Node 原生 ESM。推荐使用 [HTTP/MCP/数据库测试环境](backend-testing.md) 的数据库启动流程；下方无数据库环境变量的命令用于旧文件后端开发。发布签名和完整构建 Worker 仍待实现。

## 启动

需要 Node 22 或以上。先执行种子，再启动服务；不要在服务运行时从其他进程修改同一数据目录。

```sh
npm install
npm run seed
npm run dev
```

默认地址 `http://127.0.0.1:4317`，数据目录 `.skillhub-data/`。种子是本地示例 `personal@1.0.0`，不是已验收的用户正式规范。重跑种子不会覆盖已有示例版本。

如需认证，将 `SKILLHUB_TOKEN` 同时提供给服务和 CLI。默认仅监听回环地址；非回环监听必须设置令牌。管理员令牌用于管理接口；设备令牌由管理员发放，仅授权分配的规则包和自身遥测。远程部署还需配置允许的 Host 与 TLS。

## 隔离暂存

```sh
npm run cli -- list --server http://127.0.0.1:4317
npm run cli -- install personal --client codex --server http://127.0.0.1:4317 --home .skillhub-test
npm run cli -- install personal --client kimi --server http://127.0.0.1:4317 --home .skillhub-test
npm run cli -- install personal --client zcode --server http://127.0.0.1:4317 --home .skillhub-test
npm run cli -- doctor --home .skillhub-test
npm run cli -- rollback --release personal@1.0.0 --client codex --home .skillhub-test
npm run cli -- uninstall --client codex --home .skillhub-test
```

CLI 下载内容、核对 SHA256、保留版本缓存与状态备份。成功表示 staged，`loaded:false`：尚未写入各 Agent 规则入口，也没有真实会话注入证据。卸载移除管理状态，保留缓存以便恢复。

## API

| 接口 | 功能 |
|---|---|
| `GET /health` | 进程健康 |
| `GET /api/content` | 当前内容修订 |
| `POST /api/content` | 保存 Rule / Role / Skill 修订 |
| `GET /api/bundles` | 规则包目录 |
| `GET /api/marketplace?q=&target=codex` | 已上架市场条目、搜索与客户端筛选 |
| `GET /api/marketplace/personal` | 条目详情、版本历史与未验证兼容状态 |
| `POST /api/marketplace/publish` | 将固定 Release 上架 |
| `POST /api/marketplace/unpublish` | 下架并保留历史 |
| `POST /api/bundles` | 保存规则包组合 |
| `GET /api/releases?bundle=personal` | 版本历史 |
| `POST /api/releases` | 构建不可变版本 |
| `POST /api/channels` | 设置或回滚渠道 |
| `GET /api/resolve?bundle=personal&ref=stable` | 解析当前正式版本 |
| `GET /api/artifacts/personal%401.0.0/codex` | 获取目标通用产物 |

POST 使用 `Content-Type: application/json`。产物当前为 generic-package，不代表各客户端原生插件产物；原生市场样例与接入报告分别保存，待后续打包器接入发布核心。

## 检查

```sh
npm test
npm run check
```

测试只在临时目录运行，不覆盖本机 Agent 的规则或凭据。前端市场、完整发布 Worker、签名校验和真实加载适配器仍需继续实现；CLI进程锁已实现。

## 原生市场导出

Codex、ZCode 与 Kimi 桌面可从固定 Release 生成独立产物，输出目录必须不存在，父目录需先创建：

```sh
mkdir -p .skillhub-test/exports
npm run export:marketplace -- --release personal@1.0.0 --target codex --out .skillhub-test/exports/codex-v1
npm run export:marketplace -- --release personal@1.0.0 --target zcode --out .skillhub-test/exports/zcode-v1
npm run export:marketplace -- --release personal@1.0.0 --target kimi --out .skillhub-test/exports/kimi-desktop-v1
```

已存在目录会拒绝覆盖。导出含各客户端隐藏清单、Skill 与参考资料，以及隔离工作区 AGENTS.md。状态为 exported-unverified，Rule 不会仅因安装插件而保证自动注入。Kimi 桌面产物使用 kimi.plugin.json 和 RULES.md；marketplace.json 为明确标识的 Builder 输入索引，不是已验证的原生市场订阅协议。它通过本机官方结构校验，登记安装仍未完成；Code CLI 样例仅在 examples/future/reference/。

MCP 通过 `npm run mcp` 启动 stdio，客户端应以绝对脚本路径并指定 SKILLHUB_DATA_DIR 配置。协议工具读取固定 Release，不代表已注入会话。
