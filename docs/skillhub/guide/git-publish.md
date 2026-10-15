# 从 Git 仓库发布 Skill

`publish-git` 从公开 HTTPS Git 仓库取出一个确定的提交，把指定目录打包后提交到 SkillHub。它复用现有发布校验、安全扫描、命名空间权限和审核流程；Git 来源不会绕过审核。

这是本组织 fork 的新增 CLI 功能，尚不意味着 npm 上的 `@astron-team/skillhub` 已发布该命令。以下命令均在本仓库 `cli/` 目录运行，使用本地源码或构建产物。

## 网页发布

1. 登录后进入「发布技能」，选择目标命名空间与可见性，将技能包来源切换为「Git 仓库」。
2. 输入已启用 Git 平台仓库的 HTTPS 地址，例如 `https://github.com/Norte-AI/skillhub`。填写分支、标签或完整 commit（默认 `HEAD`），以及包含 `SKILL.md` 的目录，例如 `builtin-skills/skills/weather`。
3. 点击「读取并校验仓库」。检查返回的技能名称、版本、描述、完整 commit、文件清单和警告。此操作仅准备技能包，不创建技能版本，也不代表已完成安全扫描。
4. 点击页面底部的发布按钮，提交到既有扫描与审核流程。权限、版本冲突、校验警告与文件上传采用同一规则。

浏览器保留的是预览生成的那份 ZIP，提交时不会再次解析分支。修改仓库、ref 或目录会清除预览，需要重新读取；刷新或离开页面也不会保存预览。版本仍由 `SKILL.md` 决定，不会用分支名覆盖技能版本。

网页导入默认启用 `github.com`；管理员可以精确启用 GitLab（包括嵌套 group）及授权的私有仓库凭据别名。页面只展示当前用户获授权的凭据别名，绝不接收或返回 Token。仓库 URL 不得包含凭证、SSH、端口、查询串、片段或网页 `/tree/` 地址。后端只访问管理员配置的固定 HTTPS API/archive 地址，禁止跟随重定向，不执行仓库代码。archive 上限 50 MiB，所选技能 20 MiB，单文件 10 MiB，最多 499 个来源文件加 1 个来源记录；拒绝符号链接、LFS 指针和路径冲突，子模块内容不导入。平台更严格的包限制仍然生效。

## Git 来源与同步

「Git 来源」页面保存仓库、ref、技能目录、目标命名空间与可见性。来源记录保存在数据库，凭据仅保存配置别名，不保存 Token。每位用户最多 20 个来源；只有创建者能管理来源、触发手动同步和轮换 Webhook 密钥。

创建来源不立即发布。点击「同步」后，服务端重新读取配置 ref 对应的完整 commit，用该 commit 获取快照，复用正常发布、安全扫描及审核流程。同步按创建者当前账号状态和命名空间成员资格检查；不会继承管理员直接发布特权，也不会自动确认新的包警告。使用来源前请加入目标命名空间。

- 同一来源 commit 已成功提交时，再次同步返回 `UNCHANGED`，不重复提交。
- 新 commit 必须使用新的 `SKILL.md` 版本；已有版本不可静默覆盖。版本冲突、权限撤销、包警告及取件失败会保留原成功 commit，状态标为 `FAILED`，在网页中查看后处理。
- 每个来源使用数据库租约避免并发重复发布；运行中的来源不能删除。进程异常退出后租约 3 分钟到期，可重新同步；若上次已提交成功但尚未记录结果，重试由不可变版本规则拒绝覆盖，需检查已提交版本后再发布新的版本。
- 来源停用后，新的手动、定时和 Webhook 同步均不会启动。已启动的同步可继续完成。
- 自动同步默认全局关闭。管理员开启后，还需在来源中勾选；轮询每分钟检查最多 10 个来源，每个来源至少间隔 15 分钟。失败状态也遵循该间隔。

### 管理员配置 GitLab 与私有访问

将以下配置放入部署专用 Spring 配置，通过受控环境变量/secret 提供值，不把真实 Token 写入仓库。`providers` 的 key 是精确的仓库主机，API/archive 地址由管理员指定，用户不能覆盖。自托管 GitLab 可替换为本组织的固定 HTTPS 地址；部署网络出口策略应只允许这些地址。

```yaml
skillhub:
  git:
    providers:
      "[github.com]":
        kind: GITHUB
        api-base: https://api.github.com
        archive-base: https://codeload.github.com
      "[gitlab.com]":
        kind: GITLAB
        api-base: https://gitlab.com/api/v4
        archive-base: https://gitlab.com/api/v4
    credentials:
      team-read:
        token: ${SKILLHUB_GIT_TEAM_READ_TOKEN}
        repository: https://gitlab.com/my-team/skills.git
        user-ids: [actual-platform-user-id]
    automatic-sync-enabled: false
    webhook-secret: ${SKILLHUB_GIT_WEBHOOK_SECRET}
```

使用只读、最小仓库权限的 Token。凭据绑定**完整规范仓库地址（含 `.git`）和平台用户 ID**，不会授权同组织其他仓库；移除授权或轮换 Token 后，下次读取立即按新配置检查。GitLab 通过 `PRIVATE-TOKEN` 请求头发送，GitHub 通过 `Authorization: Bearer` 请求头发送，凭据不会进入 URL、来源文件、下载包或错误记录。

GitHub 私有仓库使用固定 API 的 Git Trees / Git Blobs 读取已固定 commit 的文件，不使用需要跳转的私有 archive 下载地址；原始 blob 使用官方 `application/vnd.github.raw+json` 媒体类型。树元数据最多 2 MiB，拒绝截断的树；树取回后的文件请求开始前检查 90 秒总期限，已启动的单个请求仍受连接/响应体期限限制（最多额外 30 秒）。文件数量、总大小、符号链接和来源记录规则仍适用。较大仓库/文件数过多时建议上传 ZIP。参见 [Git Trees API](https://docs.github.com/en/rest/git/trees) 和 [Git Blobs API](https://docs.github.com/en/rest/git/blobs)。

GitHub 公开仓库默认可直接使用；GitLab 和私有凭据需要管理员配置。本轮私有 GitLab 与 GitHub 的固定提交、认证请求头与快照打包使用隔离 fake-provider 传输集成测试验证；在组织提供真实私有仓库凭据前，不宣称已完成真实外部私有仓库验收。

### Webhook

管理员配置至少 32 字符的随机 `webhook-secret` 后，来源创建者在网页点击「生成/轮换 Webhook 密钥」。响应只显示这一次生成的来源专属密钥、相对 URL 和需要的请求头；列表不会回显密钥。将相对 URL 拼接平台地址，在仓库的 Push Webhook 中配置该密钥：

- GitHub：选择 JSON 内容格式，在 Secret 中填入来源密钥；原生 `X-Hub-Signature-256` 使用原始请求体 HMAC-SHA256，按恒定时间比较。
- GitLab：在 Secret token 中填入来源密钥；原生 `X-Gitlab-Token` 按恒定时间比较。

服务端只把验签成功的请求当作唤醒信号，不信任 payload 中的仓库、commit、ref、文件或版本，而是重新解析来源配置。请求体最多 64 KiB；重复投递由固定 commit 幂等处理；轮换后旧密钥失效。来源专属密钥由全局主密钥与来源随机 nonce 派生，数据库不保存明文 Webhook 密钥。

本机部署的 `127.0.0.1` 地址无法接受外部 GitHub/GitLab 的回调；可以在本机通过签名请求验证，真实外部回调需要将平台部署到托管平台可访问的 HTTPS 地址。本轮范围是本机交付，不会自动创建公网入口。

## CLI 准备

- 安装 Git 和项目支持的 Bun，按 `cli/README.md` 安装 CLI 依赖。
- 准备一个可匿名读取的公开 HTTPS Git 仓库。
- 所选目录根部包含符合发布规范的 `SKILL.md`，其名称、描述和版本遵循现有包校验规则。
- 准备目标 Registry 的凭证和命名空间发布权限。显式指定 `--registry`，避免使用默认 Registry。

本阶段不支持私有仓库、SSH/本地仓库地址、Git 子模块和符号链接。仓库 URL 不得包含凭证、查询串或非标准端口；重定向、Git hooks、checkout filters 和 Git LFS 自动下载不会执行。所需大文件应以普通 Git 文件纳入技能目录。网页使用上方导入流程；以下说明针对本地 CLI，支持范围与限额有所不同。Git 取件在运行 CLI 的机器完成，Registry 接收普通技能包。源文件上限为 499 个（另保留一项用于来源记录），单文件 10 MiB、含来源元数据的包总内容 100 MiB（取件预留 8 KiB 来源记录空间）；Git 传输上限为 256 MiB、最长 60 秒。

## 先校验，再发布

先运行服务端校验，不创建技能版本：

```bash
cd cli
bun install --frozen-lockfile
bun run src/index.ts publish-git https://github.com/example/team-skills.git \
  --ref main \
  --subdir skills/code-review \
  --namespace team \
  --registry https://skillhub.example.com \
  --visibility public \
  --dry-run \
  --json
```

将示例仓库、目录、命名空间和 Registry 替换成真实值。`--dry-run` 仍需读取 Git 仓库并访问目标 Registry 完成校验，需要相应网络与凭证；它不是离线检查。

检查校验结果后，将输出 `source.commit` 填入正式发布的 `--ref`，并删除 `--dry-run`。两次命令独立解析引用；重复使用 `main` 时，分支可能已变化。固定校验输出的提交才能发布同一份快照：

```bash
bun run src/index.ts publish-git https://github.com/example/team-skills.git \
  --ref "校验输出的完整提交SHA" \
  --subdir skills/code-review \
  --namespace team \
  --registry https://skillhub.example.com \
  --visibility public \
  --json
```

也可以先 `bun run build`，再使用 `node dist/index.js publish-git ...`。凭证按现有 CLI 的登录记录或 `SKILLHUB_TOKEN` 读取；请勿把真实 Token 写入示例、Git 仓库或日志。

## 固定来源

`--ref` 可以指定分支、标签或提交 SHA（默认 `HEAD`）；`--subdir` 默认仓库根目录 `.`，命名空间默认 `global`，可见性默认 `public`。建议明确指定目标目录、命名空间和 Registry。分支和标签会先解析成具体提交，包中附带 `.skillhub-source.json`，记录不可变提交及其 Git 来源。来源文件格式为 `{schemaVersion: 1, repository, requestedRef, commit, subdir}`，其中 `commit` 是解析后的完整提交 SHA（通常为 40 位，SHA-256 仓库为 64 位）。若源目录已经存在 `.skillhub-source.json`，命令拒绝打包，避免覆盖来源记录。Skill 版本仍取自原有 `SKILL.md`，命令不会改写它。

版本发布后不会跟随远端分支移动自动更新；后续修改需要发布新的 Skill 版本。

为便于复现，正式发布建议使用完整提交 SHA：

```bash
bun run src/index.ts publish-git https://github.com/example/team-skills.git \
  --ref 0123456789abcdef0123456789abcdef01234567 \
  --subdir skills/code-review \
  --namespace team \
  --registry https://skillhub.example.com \
  --visibility public
```

示例 SHA 是占位值。`--subdir` 指定仓库内的单个技能目录；不要指向包含多个独立 Skill 的父目录。

## 审核和使用

发布后根据 CLI 返回的版本与状态，在 Registry 中检查扫描和审核结果。提交成功不代表已经公开可安装；命名空间策略、扫描结果和审核决定最终可见性。

通过审核后，用户通过既有的搜索、查看和安装流程使用固定版本。详情页可浏览随包保存的来源文件；来源记录用于追溯，不构成代码安全认证。参见 [发布与版本管理](./skill-publish)、[审核流程](./review) 和 [CLI 指南](./cli)。

## 常见问题

- 仓库无法读取：确认匿名 HTTPS 访问可用，且未使用 SSH、私有或本地地址。
- 引用或目录不存在：检查 `--ref` 是否存在，`--subdir` 是否位于该提交内并包含 `SKILL.md`。
- 提示子模块不支持：将技能需要的文件直接纳入目标仓库，再发布。
- 校验失败：按 CLI 返回的字段、路径或包限制修正内容，重新 `--dry-run`。
- 版本重复：为修改后的技能使用新版本，不覆盖已经发布的版本。
- 权限或认证失败：核对 `--registry`、对应 Registry 的凭证，以及目标命名空间权限。
