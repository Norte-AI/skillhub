# Skill 上传、审核与使用

本文用于本项目的作者、审核人和使用者。示例服务地址为 `http://127.0.0.1:4317`。上传生成待审稿；审核通过后生成内容修订，再构建和发布新版本；客户端安装完成后，还需要新会话的实际加载证据。Git 市场添加成功只说明市场源可读取。

## 1. 启动环境

在项目根目录运行：

```sh
npm run db:up
npm run db:migrate
npm run dev:db
```

启动后访问 `http://127.0.0.1:4317/` 使用管理页面查看市场、上传、审核和构建。另一个终端检查 `curl http://127.0.0.1:4317/ready`。已有示例数据可继续使用；需要初始化示例时运行 `npm run seed:db`。如果配置了 `SKILLHUB_TOKEN`，后面的 API 请求都需要 `Authorization: Bearer <管理员令牌>`。未配置令牌的回环开发环境允许本机管理员操作。

## 2. 准备 Skill

准备明确的名称、用途、触发条件和操作步骤。内容应说明输入、输出、依赖及失败处理；资源放在相对路径中，例如 `references/checklist.md`。资源路径不允许绝对路径、`..` 或重复项。不要在 Skill、资源或 Git 仓库中放入账号令牌与私钥。

本项目上传 API 接收 JSON，资源为 `{path, body}` 数组；它不是 ZIP 上传接口。客户端所需的 `SKILL.md` 和插件目录由原生导出器生成。

创建 `skill.json`，正文包含标准 Skill frontmatter：

```json
{
  "contentId": "release-checklist",
  "title": "发布检查",
  "body": "---\nname: release-checklist\ndescription: 发布前核对变更、测试和回滚条件。\n---\n先读取变更说明，再检查测试结果，最后输出尚未解决的问题清单。",
  "resources": [
    { "path": "references/checklist.md", "body": "确认版本号、测试结果、更新说明与回滚版本。" }
  ]
}
```

上传审核稿：

```sh
curl -fsS -X POST http://127.0.0.1:4317/api/submissions \
  -H 'Content-Type: application/json' --data-binary @skill.json
```

保存返回的 submission `id`。此时状态是 pending，尚未产生可发布的内容修订。资源最多 128 个，模块总文本上限 2 MiB；默认 HTTP 请求上限为 1 MiB（含 JSON 编码），超过返回 413。资源不能占用根目录 `SKILL.md`。frontmatter 的 name 使用小写 kebab-case，description 为单行文本。

## 3. 审核

审核人或管理员查看待审列表和具体稿件：

```sh
curl -fsS 'http://127.0.0.1:4317/api/submissions?status=pending'
curl -fsS http://127.0.0.1:4317/api/submissions/SUBMISSION_ID
```

检查用途与触发条件、指令是否可执行、资源路径、依赖、敏感内容和实际测试结果。审核通过：

```sh
curl -fsS -X POST http://127.0.0.1:4317/api/submissions/SUBMISSION_ID/reviews \
  -H 'Content-Type: application/json' \
  -d '{"decision":"approve","comment":"用途、步骤与资源已核对，可进入构建验证。"}'
```

拒绝时使用 `decision: "reject"` 并说明原因；comment 必须非空。通过会原子生成不可变的 Skill 内容 revision；拒绝不会产生内容。修改后重新提交新的 submission，再次审核。已有 Skill 的新稿待审期间，最后已批准修订仍可使用。

服务端可配置 `SKILLHUB_EDITOR_TOKEN`、`SKILLHUB_REVIEWER_TOKEN`、`SKILLHUB_PUBLISHER_TOKEN` 作为独立 Bearer 凭据：editor 上传待审稿，reviewer 审核，publisher 构建、发布与生成 Git 市场；管理员管理设备并保留完整管理能力。各身份的令牌必须不同。请求示例按操作使用对应身份，不把令牌写进 JSON 或 Skill 内容。

`POST /api/content` 是保留的管理员直接管理入口，editor 无权绕过审核直接创建 Skill；需要审核证据时使用 submissions 流程，不能把直接保存当作已审核。

## 4. 创建规则包、构建与发布

将审核通过的内容组合为 Bundle：

```sh
curl -fsS -X POST http://127.0.0.1:4317/api/bundles \
  -H 'Content-Type: application/json' \
  -d '{"id":"release-tools","name":"发布工具","description":"发布前检查","items":["release-checklist"],"targets":["codex"],"tags":["release"]}'
```

提交持久化构建任务，然后查询状态；只有 ready 的 Release 可发布：

```sh
curl -fsS -X POST http://127.0.0.1:4317/api/builds \
  -H 'Content-Type: application/json' \
  -d '{"bundleId":"release-tools","version":"1.0.0"}'
curl -fsS http://127.0.0.1:4317/api/builds
```

保存构建任务 ID，等待成功状态；失败时读取任务错误并修复后重试。

构建成功后，Release 锁定 Bundle 和内容修订。先核对产物、摘要、审核记录，再设置稳定渠道与上架：

```sh
curl -fsS -X POST http://127.0.0.1:4317/api/channels \
  -H 'Content-Type: application/json' \
  -d '{"bundleId":"release-tools","channel":"stable","releaseId":"release-tools@1.0.0"}'

curl -fsS -X POST http://127.0.0.1:4317/api/marketplace/publish \
  -H 'Content-Type: application/json' \
  -d '{"bundleId":"release-tools","releaseId":"release-tools@1.0.0","visibility":"private"}'
```

生产更新应读取渠道当前 generation，并在更新请求带上 `expectedGeneration`，避免覆盖其他人的并发更新。`private/public` 是市场元数据；本地 Git 市场地址应视为能够读取其仓库内容的入口，不能用 listing visibility 替代 Git 访问控制。

## 5. 在 Codex 使用 Git 市场

API 上架后需要重新生成 Git 市场快照。可以在管理页面操作，也可以调用：

```sh
curl -fsS -X POST http://127.0.0.1:4317/api/git-marketplaces/publish \
  -H 'Content-Type: application/json' -d '{"target":"codex"}'
```

或在本机终端运行：

```sh
npm run publish:git:db -- --target codex
```

在本机 Codex 的 Git 市场添加入口填写：

```text
http://127.0.0.1:4317/git/codex.git
```

分支为 `main`，市场名为 `skill-hub`。添加后选择对应插件并安装、启用；既有示例插件名为 `personal`，本文新增包名为 `release-tools`。也可以通过已验证的命令添加：

```sh
codex plugin marketplace add http://127.0.0.1:4317/git/codex.git --ref main --json
```

如果错误中出现连接 `localhost:9910` 失败，说明 Git 把回环服务转发给了失效代理。给当前服务配置直连后重试：

```sh
git config --global http.http://127.0.0.1:4317/.proxy ''
git ls-remote http://127.0.0.1:4317/git/codex.git
```

这条配置只覆盖该 URL 前缀。`127.0.0.1` 指当前电脑；其他电脑不能直接使用这个地址。远程部署应配置可访问域名、TLS 和 Git 访问控制。

## 6. 验证使用状态

| 状态 | 可以证明什么 | 下一步证据 |
|---|---|---|
| 市场已添加 | Git 源和市场清单可读取 | 选择并安装插件 |
| 插件已安装/启用 | 客户端保存并启用了插件 | 创建新会话 |
| CLI `staged` | 内容包下载、摘要校验与隔离缓存完成 | 原生客户端安装与加载 |
| 会话已绑定 | 服务端固定了该会话的 Release | 检查客户端实际输入或会话结果 |
| `injection_claim` 回执 | 客户端声明加载过 | 独立核对实际加载证据 |
| 已验证加载 | 有新会话、插件版本和内容行为证据 | 再测试更新、旧会话和回滚 |

安装后创建新会话，使用 Skill 的触发条件发起测试，记录插件版本、会话标识、预期行为和实际结果。需要证明规则注入时，保留客户端可观察的加载记录或实际输入证据；仅凭模型回答像某个 Skill，不能断言已验证注入。当前回执保留 `trusted:false`，真实三端安装和会话加载仍应逐项验收。

CLI 是隔离暂存工具：

```sh
npm run cli -- install release-tools --client codex --server http://127.0.0.1:4317
npm run cli -- doctor
```

它不会自动证明 Codex、Kimi 桌面或 ZCode 已加载。原生导出支持三目标，但桌面安装入口、更新与加载证据要分别核对。

## 7. v1 → v2 更新与回滚

1. 修改并重新上传 Skill；再次审核通过后生成新 revision。
2. 构建 `release-tools@1.1.0`，确认产物；将 stable 和市场 listing 指向 v2。
3. 重新执行 `publish:git:db`。在客户端刷新市场、更新插件，记录安装版本。
4. 创建新会话验证 v2，同时记录旧会话是否继续保留 v1。不要假定更新会改变已打开会话。
5. 回滚时将 stable 和 listing 重新指向 `release-tools@1.0.0`，重新生成 Git 市场；客户端能否直接降级要实际验证，必要时按客户端入口重新安装指定版本。

CLI 缓存回滚示例：

```sh
npm run cli -- rollback --release release-tools@1.0.0 --client codex
npm run cli -- doctor
```

CLI 回滚恢复隔离状态，不等价于客户端插件降级。渠道回滚、Git 快照回滚和客户端回滚是三个独立结果，应分别检查。

## 8. 产物签名与故障处理

服务端签名采用 Ed25519，覆盖 Release digest、目标 manifest 和 artifact digest；本地内容摘要用于识别篡改，固定可信公钥用于验证发布者。私钥只留在发布环境，公钥通过可信渠道分发。旧的未签名 Release 不会因配置签名自动变成已签名版本，应构建新版本。

密钥创建、服务端环境变量 `SKILLHUB_SIGNING_KEY_FILE` 与 CLI `--trusted-keys` 强制验签步骤见 [签名操作说明](signing.md)。Codex Git 安装与本项目 CLI 验签是独立路径，应分别验收。

遇到错误先保留请求 ID、Release ID、目标客户端和脱敏日志：审核失败先修正文档与资源并重新提交；构建失败检查任务错误；摘要或签名失败停止使用该产物并重新获取可信版本；Git 源不可达检查服务 readiness 与代理；安装后未加载先确认插件启用和新会话，再补客户端证据。不要把设备自报回执标成已验证。

接口细节见 [HTTP API](http-api.md)，环境配置见 [服务端测试环境](backend-testing.md)，里程碑与验收见 [任务计划](tasks-and-plan.md)。

## 9. 内容依赖与共享契约

上传 Skill 或保存 Rule/Role 时可传 `dependencies: ["base-rules"]`。界面也提供依赖内容标识输入。规则包只需列出根内容，构建会递归展开依赖，并锁定每项修订与摘要；共享依赖只包含一次。缺失引用和循环引用都会失败，并返回引用路径。

依赖内容同样受审核门槛约束。排队后任何依赖修订变化会使该构建失败，请确认后重新提交任务。既有 Release 保持旧依赖，不随草稿改变。

共享 JSON Schema 位于 `packages/contracts/schema.json`；Schema 定义字段，运行时进一步校验跨实体引用、内容摘要、审核状态和依赖图。上传使用的 frontmatter name 应与内容标识生成的原生 Skill 名一致，推荐两者都使用同一个小写 kebab-case 名称；不一致会在原生导出构建校验时报错。
