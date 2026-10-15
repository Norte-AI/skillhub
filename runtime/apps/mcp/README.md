# MCP 入口

使用官方 [TypeScript SDK](https://ts.sdk.modelcontextprotocol.io/server)，支持本地 STDIO 与无状态 Streamable HTTP。依赖固定为 `@modelcontextprotocol/sdk@1.32.1` 与 `zod@4.6.7`。

## 本地 STDIO

```sh
SKILLHUB_DATA_DIR=/absolute/path/to/.skillhub-data node apps/mcp/src/index.mjs
```

由本地客户端启动，默认身份是本地管理员；访问权由操作系统及目录权限控制。stdout 仅用于 MCP 协议。设置 `SKILLHUB_DATABASE_URL` 时通过统一存储工厂使用 PostgreSQL，否则使用指定文件目录。连接后通过协议 initialize 与 tools/list 检查可用性。

## HTTP 挂载与认证

```js
import { handleMcpRequest } from './apps/mcp/src/index.mjs';
// 根 HTTP 服务 /mcp 路由中，每次请求先验证身份：
await handleMcpRequest(req, res, { store, identity, maxBodyBytes: 1024 * 1024 });
```

`identity` 为服务端认证结果 `{role:'admin'}` 或 `{role:'device',deviceId,assignments?}`，不能来自请求体。也可使用 `createMcpHttpHandler({store,authenticate,maxBodyBytes})` 包装；缺失或无效身份返回 401。入口要求 JSON Content-Type，正文默认最多 1 MiB，读取超时 15 秒，分别以 415、413、408 报错。根服务负责令牌有效性、设备认证、Host/Origin 校验与 HTTPS。入口复用项目令牌认证，不实现 OAuth 授权服务器。

采用官方 [无状态 HTTP 示例](https://github.com/modelcontextprotocol/typescript-sdk/blob/v1.x/src/examples/server/simpleStatelessStreamableHttp.ts) 的每请求新建 Server/Transport 模式，避免跨身份泄露协议会话状态。仅 POST，非 POST 返回 405；无持久 MCP session、SSE 订阅或请求恢复。根服务健康检查为 GET /health；存储就绪检查为 GET /ready。MCP 协议检查使用携带认证的 initialize 和 tools/list，GET /mcp 的 405 是预期行为。

管理员可读取全部内容；设备只能读取当前分配的内容包，存储支持 `getDevice` 时每次读取其当前 assignments，避免令牌中旧权限继续有效。工具、Resource 与 Prompt 共用权限检查。每次调用前执行存储可选的 `refresh()`；PostgreSQL 后端可直接从数据库读取。

工具：

- `resolve_bundle({bundleId, ref?: "stable"})`：解析后返回固定 releaseId。
- `get_bundle({releaseId})`：读取发布时的内容包快照。
- `get_content({releaseId, target?: "codex", contentId?})`：读取固定版本内容。
- `get_release_diff({fromReleaseId, toReleaseId})`：同内容包版本间的增删和摘要变更。
- `report_receipt({releaseId,kind,id?,sessionId?,digest?,evidence?,deviceId?})`：只接受 fetched、installed、injection_claim 自报。设备身份从认证结果派生；管理员必须明确 deviceId。结果均为 trusted:false，不接受 injected 或 behavior。

Resource 模板为 `skillhub://releases/{releaseId}/manifest` 和 `skillhub://releases/{releaseId}/content/{contentId}`。URI 变量需编码，例如 `allowed%401.0.0`。没有全库资源枚举，按模板读取授权的固定版本。

Prompt `load_bundle({bundleId,ref?})` 是用户或客户端主动调用的手动入口，返回固定版本引用。资源阅读、Prompt 调用与自报回执均不保证配置注入或真实会话行为。

调用方需要自行记录首个 resolve 返回的 releaseId，并在同一会话后续读取中复用。服务无法保证 Agent 主动调用工具、配置注入或内容实际加载。

```sh
node --test tests/mcp*.test.mjs
```
