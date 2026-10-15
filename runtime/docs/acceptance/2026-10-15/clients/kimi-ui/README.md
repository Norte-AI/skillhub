# Kimi Desktop 真实 Work 激活验收

2026-10-15，Kimi 3.2.16。只通过原生 UI 操作独立新任务与专名测试插件，不向既有业务会话发送任何消息。账号已登录，Work 新建任务和插件中心可用；个人市场初始为空。

测试插件 `norte-hub-acceptance-20261015`，源来自本轮三端隔离验收修复后的 Kimi v1/v2 原生导出，包含 systemPromptPath RULES.md、probe-skill 与 references/probe.md。临时副本在 `.skillhub-test/kimi-ui-20261015/`，不包含密钥或业务内容。

通过官方“自定义插件”入口创建独立任务，发送有界 Plugin Builder 导入请求，只允许处理此测试目录、保持插件内容不变，明确禁止改其它插件/会话/业务文件和购买额度。实际登记、激活、新会话标记及版本结果在本目录后续记录；没有观察到的结果不计通过。

## 实际观察

1. 官方 Builder 登记 v1，回读 id/version/sourcePath 一致；UI 安装成功并显示“已安装Norte Hub Acceptance 20261015”。
2. 安装后全新 Work 会话，不选择插件，不调用工具，询问系统上下文变量，回答 UNKNOWN。不能将安装等同默认 Rule 注入。
3. 同一测试会话明确选择插件（输入框有插件 chip），Skill 工具读取参考文件，返回 `hub_probe_reference = v1`；系统变量仍 UNKNOWN。
4. 独立 V2 插件 `norte-hub-acceptance-20261015-v2`（1.1.0）另行登记/安装，不覆盖 v1；使用 inline systemPrompt + sessionStart.skill 对照，新的显式选择任务返回参考 v2，但系统变量仍 UNKNOWN。
5. 回到 V1 旧会话，要求重新实际读取文件，仍返回参考 v1。独立插件 ID 能保留旧版本资源，但不能据此推断普通同名插件热更新也固定。
6. 插件详情只有“使用”“更多→卸载”，未见默认启用设置；未改变用户全局会话设定。

必须区分：系统规则自动注入（未通过）与显式选插件读取 Skill（通过）。正在以固定版本、显式会话启动读取 RULES 的方式补齐可执行适配；此路线是适配式初始化，不能改称原生自动注入。

## 用户接受的交付标准与显式初始化结果

用户已接受“固定版本 + 显式初始化”路线，原生自动注入仍记未通过。真实 Work 操作已验证：

| 场景 | Rule 标记 | Skill参考标记 | 结果 |
|---|---|---|---|
| v1安装后新任务，不显式选择 | UNKNOWN | 未请求 | 自动初始化不通过 |
| v1显式选插件，仅查询系统规则 | UNKNOWN | v1 | Skill可用，系统规则未观察到 |
| 独立v2插件，inline/systemStart字段对照 | UNKNOWN | v2 | 自动字段未达到预期 |
| 回滚新任务选v1，并实际读取固定RULES.md | v1 | v1 | 显式初始化通过，16:04实际UI结果 |
| 独立v2任务实际读取固定RULES.md | v2 | v2 | 显式初始化通过，17:59实际UI结果 |
| 安装v2后回到旧v1任务重新读取Skill参考 | 未重查规则 | v1 | 独立ID的旧资源保留 |

这里的“通过”只表示指定合成规则与技能参考在真实模型会话取得对应值，不将模型自报当作平台可信注入回执，不声称同名插件原生更新保证旧会话固定。

### 可执行操作说明

1. 每个不可变 Release 使用独立插件 ID 和独立发布目录；v1/v2目录不得原地覆盖。先用官方 Plugin Builder 登记该目录，再在个人市场安装。真实UI验证安装与登记是两个步骤。
2. 新建 Work 任务，在输入框“插件”选择目标固定版本，看到对应插件 chip；不要同时选择另一个版本。
3. 第一条消息显式要求读取目标目录的 `RULES.md` 并作为本会话规则，同时要求使用所选 Skill 读取自己的参考文件。报告规则/参考标记一致后，再进行业务任务。初始化消息不可指向 stable、latest 或可变共享目录。
4. 更新使用新的独立任务、新插件 ID 和新固定目录。旧任务继续保留旧 ID/目录，不能为了更新新会话而卸载旧会话仍使用的插件。
5. 回滚创建新任务并重新选择旧插件 ID，第一条消息初始化旧 RULES，核对规则与参考均旧版本。不要修改现有新版本任务的绑定或覆盖源文件。
6. 验收任务及专名插件目前保留便于用户复核；仅当这些测试任务不再需要继续读取资源时，在插件详情“更多→卸载”移除对应专名测试插件。不得删除其它市场或插件。

测试用初始化模板（将插件和路径替换为对应固定 Release 产物）：

```text
这是固定版本的独立新会话。请先实际读取 <固定插件绝对目录>/RULES.md 并作为本会话规则；随后使用已选择的插件 Skill，读取该 Skill 自己的参考文件。报告规则版本和参考版本，二者不一致则停止。不要读取其它版本或业务文件，不修改文件。
```

此步骤是明确的适配式初始化，仍需要用户/Agent在会话首条消息执行；它不是全局默认自动加载。没有改动用户的全局会话设定。

### 固定旧会话最终复核

17:59，独立 V2 已显式初始化后，回到“读取固定V1规则与探针值”再次实际读取其 RULES 与参考：两个标记仍为 v1。实际输出“本会话（V1）固定规则未变……两者仍为 V1，与 V2 任务隔离”。见 [结构化会话结果](explicit-session-results.json)。

## MCP 真实调用历史：stdio未通过，HTTP复验通过

18:00–18:05，另建专名 `norte-hub-mcp-20261015`，固定合成验收数据与本项目 Node MCP 入口；显式设置空数据库 URL，避免继承真实数据库。官方 Builder 校验0错误，但登记回读 `mcpServerNames=[]`；补官方脚手架 `.mcp.json` 同内容后仍未形成可见工具。仅调查随应用交付的官方资源和测试目录，未修改全局设置。

真实 UI 安装显示“已安装Norte Hub MCP Acceptance 20261015”。随后创建独立任务“MCP真实调用验收”，明确选择此插件，要求仅用 MCP `get_content(releaseId=session-probe@1.0.0, contentId=hub-session-rule, target=kimi)`，禁止以文件读取或命令行冒充。

实际模型最终报告：本会话没有 `skillhub-acceptance` 工具，尝试按标准工具名加载被拒绝；**工具不可用，调用失败，无版本标记**。这项不能计为真实 MCP 通过，也不能用其它客户端或 Node SDK 测试替代。

当前失败定位在 Kimi 桌面插件对该本地 stdio MCP 声明的识别/激活，不是服务端 get_content 协议断言失败。进一步可调查官方当前支持的 remote MCP 兼容入口；没有实测成功前，矩阵保持未通过。

### MCP过滤根因与修复（18:09）

只读定位随应用交付的 `node_modules/@moonshot-ai/agent-core/dist/index.mjs`：`readMcpServers` 使用运行时 Schema，随后 `normalizePluginMcpServer` 对 stdio command 执行额外约束；包含 `/` 的绝对命令会告警并丢弃，只有 PATH 命令或 `./` 开头的插件内路径可用。原测试 `/opt/homebrew/bin/node` 正好触发该过滤，Python validator 未覆盖这个运行时边界。

将专名测试插件1.0.1改为 `command: "node"`（args仍为本项目MCP绝对入口，env仍指合成目录），官方重新登记后落盘 `mcpServerNames=["skillhub-acceptance"]`。卸载旧1.0.0（UI明确条目保留在个人市场）并重新安装1.0.1，插件详情实际出现“应用 → skillhub-acceptance → 已连接”。这一步同时验证专名测试插件卸载/重装，不影响v1/v2规则插件与已有业务插件。

以下是stdio元数据修复对照格式，尚未通过真实模型工具公布，不作为推荐交付入口：

```json
{
  "mcpServers": {
    "skillhub": {
      "command": "node",
      "args": ["/absolute/path/to/skill_hub/apps/mcp/src/index.mjs"],
      "env": {"SKILLHUB_DATA_DIR": "/absolute/path/to/isolated/data", "SKILLHUB_DATABASE_URL": ""}
    }
  }
}
```

不要把 `command` 改为 Node 绝对路径；需要插件自带可执行入口时用 `./` 相对路径。remote MCP可用官方Schema的 `url` + `transport: "http"` 或 `"sse"`，本轮HTTP真实调用已通过，因此推荐下面的HTTP入口。不要在报告中写真实数据库URL/访问令牌。

## HTTP MCP 真实调用复验：通过（覆盖前面的失败结论）

18:13，专名 `norte-hub-http-20261015`，清单使用 `{ "url": "http://127.0.0.1:48971/mcp", "transport": "http" }`。官方登记回执识别 `skillhub-http`，真实UI安装显示“已连接”。新建独立任务“HTTP MCP 验收”，明确选该插件后，实际 `get_content` 返回 `session-probe@1.0.0`、version `1.0.0`、target `kimi`、正文 `hub_probe_release = v1`。

[服务端脱敏请求记录](http-methods.jsonl) 包含 initialize、notifications/initialized、tools/list，以及10:13:29Z的 `tools/call/get_content/releaseId=session-probe@1.0.0`，不记录headers/token。不是靠模型自报代替协议调用。stdio修复后的工具未公布仍保留为失败历史，交付使用实测成功的HTTP方式。

独立stdio失败测试插件 `norte-hub-mcp-20261015` 已通过UI卸载，确认框明确个人市场条目保留；未卸载v1/v2和HTTP成功插件。测试源目录、规则、参考和用户验收记录保留。

### 重跑和日常接入

在仓库根目录运行：

```sh
node docs/acceptance/2026-10-15/clients/kimi-ui/http-fixture.mjs
```

这是验收专用loopback48971，自动创建合成v1/v2、stable指v2，固定请求v1可检查渠道更新不混入；Ctrl-C/SIGTERM清理自身临时数据。此次临时服务已停止；保留的HTTP测试插件再次调用前必须重启此脚本。不要将无鉴权fixture作为真实业务服务。

日常接入原平台持久服务 `http://127.0.0.1:4317/mcp`，先注册设备并分配Bundle，使用其设备令牌；在Kimi受控环境配置 `SKILLHUB_DEVICE_TOKEN`，插件清单只引用环境变量，不写令牌正文：

```json
{
  "mcpServers": {
    "skillhub": {
      "url": "http://127.0.0.1:4317/mcp",
      "transport": "http",
      "bearerTokenEnvVar": "SKILLHUB_DEVICE_TOKEN"
    }
  }
}
```

变量须由实际启动Kimi的受控环境提供；仅在另一个终端export不保证桌面进程继承。未配置则应认证失败，不能改成关闭鉴权。`4317`是原平台，不能把fork网页的登录cookie或账号密码当作其Bearer令牌。固定Release读取与显式初始化步骤保持一致。
