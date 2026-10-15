# 从 Git 仓库发布 Skill

`publish-git` 从公开 HTTPS Git 仓库取出一个确定的提交，把指定目录打包后提交到 SkillHub。它复用现有发布校验、安全扫描、命名空间权限和审核流程；Git 来源不会绕过审核。

这是本组织 fork 的新增 CLI 功能，尚不意味着 npm 上的 `@astron-team/skillhub` 已发布该命令。以下命令均在本仓库 `cli/` 目录运行，使用本地源码或构建产物。

## 网页发布

1. 登录后进入「发布技能」，选择目标命名空间与可见性，将技能包来源切换为「Git 仓库」。
2. 输入公开 GitHub 仓库的 HTTPS 地址，例如 `https://github.com/Norte-AI/skillhub`。填写分支、标签或完整 commit（默认 `HEAD`），以及包含 `SKILL.md` 的目录，例如 `builtin-skills/skills/weather`。
3. 点击「读取并校验仓库」。检查返回的技能名称、版本、描述、完整 commit、文件清单和警告。此操作仅准备技能包，不创建技能版本，也不代表已完成安全扫描。
4. 点击页面底部的发布按钮，提交到既有扫描与审核流程。权限、版本冲突、校验警告与文件上传采用同一规则。

浏览器保留的是预览生成的那份 ZIP，提交时不会再次解析分支。修改仓库、ref 或目录会清除预览，需要重新读取；刷新或离开页面也不会保存预览。版本仍由 `SKILL.md` 决定，不会用分支名覆盖技能版本。

网页导入仅支持公开 `github.com/owner/repository` 地址；不接受私有凭据、SSH、任意主机、端口、查询串或网页 `/tree/` 地址。服务端只访问固定的 GitHub API 与 archive 主机，禁止跟随重定向，不执行仓库代码。GitHub archive 上限 50 MiB，所选技能内容上限 20 MiB，单文件 10 MiB，最多 499 个来源文件加 1 个来源记录（如平台配置更严格，则采用更严格限制）。拒绝符号链接、LFS 指针和路径冲突；子模块内容不导入。GitHub API 限流时可稍后重试或改用文件上传。此功能不会自动同步新提交。

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
