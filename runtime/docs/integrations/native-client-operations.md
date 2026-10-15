# 三端本机接入与可重复验收

日期：2026-10-15。

本模块现位于统一主仓库 `Norte-AI/skillhub` 的 `runtime/`。下文所有 `node scripts/...` 与 `npm run ...` 命令均先在主仓库执行 `cd runtime`；也可在主仓库用 `npm --prefix runtime run client:session -- ...`、`npm --prefix runtime run native:market -- ...`、`npm --prefix runtime run client:receipts -- ...`。应用安装路径 `/Applications/...` 是当前 macOS 默认探测入口，历史验收JSON的旧目录是历史证据，不是新部署依赖。
此文档区分原生文件安装、桌面启用、模型新会话行为与服务端可信回执，避免把任一层当成其他层已完成。

## 原生适配操作

Codex 使用已有 `scripts/codex-market.mjs`，必须显式提供 `--codex-home`。ZCode 与 Kimi Desktop 使用新增 `scripts/native-market.mjs`：

```sh
node scripts/native-market.mjs --client zcode --home /tmp/hub-zcode-home --action probe
node scripts/native-market.mjs --client zcode --home /tmp/hub-zcode-home --action validate --source /tmp/hub-zcode-market
node scripts/native-market.mjs --client zcode --home /tmp/hub-zcode-home --action add --source /tmp/hub-zcode-market
node scripts/native-market.mjs --client zcode --home /tmp/hub-zcode-home --action install --plugin hub-probe --marketplace skill-hub-hub-probe
node scripts/native-market.mjs --client zcode --home /tmp/hub-zcode-home --action update --plugin hub-probe --marketplace skill-hub-hub-probe
node scripts/native-market.mjs --client zcode --home /tmp/hub-zcode-home --action list
node scripts/native-market.mjs --client zcode --home /tmp/hub-zcode-home --action remove --plugin hub-probe --marketplace skill-hub-hub-probe

node scripts/native-market.mjs --client kimi --share-dir /tmp/hub-kimi-share --action probe
node scripts/native-market.mjs --client kimi --share-dir /tmp/hub-kimi-share --action register --source /tmp/hub-kimi-market/plugins/hub-probe --marketplace hub-acceptance
node scripts/native-market.mjs --client kimi --share-dir /tmp/hub-kimi-share --action install --source /tmp/hub-kimi-market/plugins/hub-probe
```

这些例子是独立测试目录，需先通过固定 Release 导出生成源目录。脚本不会调用模型或读取凭据。ZCode 默认使用桌面自带 `Contents/Resources/glm/zcode.cjs`（CLI 0.16.9，桌面 3.15.3）；可通过 `--executable` 使用独立 CLI。Kimi 使用桌面自带 `kimi-daimon` 与 Node shim，`--share-dir` 明确指定范围；不会将 Kimi Code CLI 的结果算作桌面激活。

ZCode 更新必须先刷新市场，再重新安装；仅重复 `install` 仍可能安装市场缓存中的旧版本。适配器任何刷新步骤失败都会停止。服务端将渠道回滚并重新导出市场后，同样的更新流程可重新安装旧版本。

Kimi `register-personal` 只登记；`install` 是离线安装，结果明确 `existingProcessBehavior: restart-required`。它不会热更新运行中的桌面 daemon。Kimi 桌面个人页安装/移除需在相应桌面实例执行；当前官方离线子命令没有可用于此脚本的卸载入口，因此不伪造 remove 成功。

## 一条命令重跑离线原生验收

```sh
node scripts/client-native-acceptance.mjs --output docs/acceptance/local-clients
```

要求 macOS、三款应用已安装。脚本生成独立系统临时根与同一规则/参考文件 v1/v2，使用 macOS `sandbox-exec` 禁止网络并禁止该根以外的写入。没有模型调用，也不复制现有认证。每个子进程使用独立 HOME；Kimi 还显式提供 share-dir。沙箱不可用会失败，不会退回无隔离运行。

验证内容：Codex 原生安装/更新/降版/卸载，ZCode 原生校验/安装/刷新/降版/卸载，Kimi Desktop 官方登记/离线安装/更新/降版，以及所有目标中用户自有规则和笔记保持不变。每次安装读取原生结果并断言实际版本与 enabled。JSON报告保留命令、退出码、原生输出与临时根，方便追溯。临时根是本次工具自行创建的隔离内容；验收后可按报告 root 清理，不能删除真实用户配置。

## 真正模型会话验收

```sh
node scripts/client-session-acceptance.mjs --run-model --output docs/acceptance/codex-sessions
```

该命令会使用当前已登录的 Codex 账号执行三个有界模型请求，消耗账号正常额度；不会读取或复制认证文件，也不购买额度。`--run-model` 是必要的显式开关，普通测试不会自动调用模型。使用独立项目、ephemeral 新会话、read-only sandbox，模型报告启动时自动读取的规则，并实际读取 Skill 参考文件。依次验证 v1、新会话 v2、回滚后新会话 v1，保留会话 ID、使用量和工具事件。

这个脚本验证的是项目 `AGENTS.md` 与 `.agents/skills` 接入路线；原生插件安装成功和桌面插件新会话激活仍单独判断。它也不证明旧会话版本固定或服务端可信注入回执。已完成的实际结果与剩余缺口见 [本次客户端验收](../acceptance/2026-10-15/clients/README.md)。

## 会话固定的产品边界

后台会话绑定与 MCP `get_content` 按固定 Release 读取已实现；旧会话与新会话的本地规则文件不能共享一个可变目录，否则更新可能影响旧会话的后续按需读取。正式接入应为会话提供不可变 Release 路径，旧会话继续绑定旧目录，新会话解析新 stable。不得把原生插件“已启用”或模型自报加载当成服务端可信注入证据。

## 已交付的会话固定适配路线

新增 `packages/adapters/session-workspace.mjs` 与 `scripts/client-session-workspace.mjs`。每个会话使用一个独立、只创建一次的 sessionKey；准备新版本只创建另一个目录，不修改旧会话的任何规则或资源。原生插件名称附 Release digest，因此不同版本不会共用同一插件ID；Codex同时提供项目`.agents/skills`路径，ZCode用项目scope安装该固定版本插件。

```sh
node scripts/client-session-workspace.mjs prepare --root /tmp/hub-sessions --session-key review-old --client codex --release personal@1.0.0 --data /absolute/local-hub-data
node scripts/client-session-workspace.mjs doctor --workspace /tmp/hub-sessions/review-old
node scripts/client-session-workspace.mjs launch --run-model --workspace /tmp/hub-sessions/review-old --prompt-file /absolute/prompt.txt
# 上一步返回原生session ID。再次进入同一会话必须提供相同ID。
node scripts/client-session-workspace.mjs launch --run-model --workspace /tmp/hub-sessions/review-old --prompt-file /absolute/followup.txt --resume <native-session-id>
```

新版本用新的sessionKey与固定Release准备；回滚也只让之后的新会话选择旧Release。已有sessionKey拒绝绑定另一个Release。doctor验证托管文件摘要，拒绝符号链接、漂移及额外注入的Skill。launch在模型调用前验证快照，用进程锁避免同一会话并发启动，并记录实际返回的native session ID；恢复时ID和Release必须与本地绑定一致。模型调用是显式操作，使用当前已登录账号，不复制认证文件。

ZCode的应用内JS入口在独立调用模型时找不到相邻的provider文件。本适配器只复制应用代码和公开随包provider元数据到会话runtime，补齐相邻路径；没有读取或复制用户认证。用户账号仍由客户端按其正常方式使用。

Kimi的prepare可生成不同Release专名的桌面原生包，但launch明确停止并提示使用Desktop Work；不会悄悄换成独立Kimi Code产品。桌面自动规则初始化需另验，不从Codex/ZCode结果推导。

真正模型回归可显式运行：

```sh
node scripts/client-pinned-acceptance.mjs --run-model --client codex --output docs/acceptance/codex-pinned
node scripts/client-pinned-acceptance.mjs --run-model --client zcode --output docs/acceptance/zcode-pinned
```

它保留首次模型返回的session ID，创建新Release的新会话后，再resume旧ID，重新读取旧参考文件；不以两个全新会话替代旧会话续接验收。

## 离线回执队列与幂等重放

`packages/adapters/receipt-queue.mjs`与`npm run client:receipts`补齐客户端侧离线队列。队列记录固定Release、设备、可选会话和证据类别；同一ID相同载荷本地去重，不同载荷拒绝；网络/认证/服务端失败保留文件，收到匹配ID成功回执后才删除。回执不提升为可信注入，禁止本地传入trusted=true或verified。

```sh
npm run client:receipts -- enqueue --queue /absolute/queue --receipt /absolute/receipt.json
# 通过进程环境SKILLHUB_TOKEN提供设备凭据，凭据不写入队列或命令行。
npm run client:receipts -- flush --queue /absolute/queue --server http://127.0.0.1:4317
```

回执JSON允许id、deviceId、sessionId、releaseId、kind、digest、evidence、source。kind沿用服务端fetched/installed/injection_claim/injected/behavior。模型标记应使用injection_claim或behavior，服务端仍保存unverified；不要填写不受证明的注入成功。实际HTTP测试已验证设备认证、重复重放只有一条记录、仍trusted=false，故障与错误ACK保留待重试。

## 合并后路径与 MCP 命令约定

仓库内模块引用和验收脚本子进程入口均按脚本自身位置解析，不依赖旧的相邻`skill_hub`目录。`--data`、`--root`、`--home`和输出目录仍由调用者明确指定；建议使用绝对目录。共享数据由部署配置注入，不将开发者个人`/Users/...`路径硬编码为运行依赖。历史验收报告保留当时真实路径，不在迁移时改造为新执行结果。

Kimi Desktop插件MCP的`command`应使用PATH中的命令名（例如`node`）或官方允许的插件相对命令，不能直接照搬Codex/ZCode使用的绝对可执行路径。桌面运行时会过滤绝对command，Python结构校验通过也不代表实际MCP服务已注册。MCP的args可使用部署时生成的绝对模块路径，例如统一仓库内`runtime/apps/mcp/src/index.mjs`；必须以桌面真实工具调用验证，不能只看manifest。
