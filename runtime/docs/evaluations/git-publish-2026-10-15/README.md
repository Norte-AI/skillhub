# Norte-AI fork 的 Git 发布验证

日期：2026-10-15（Asia/Shanghai）。组织 fork：https://github.com/Norte-AI/skillhub ，分支 codex/git-publish，提交5b2123e2。

## 实现范围

第一阶段新增本地 CLI `publish-git`。公开 HTTPS 仓库的分支、标签或提交会解析为固定 commit，再从单一 Skill 子目录导出普通受跟踪文件，添加`.skillhub-source.json`，交给既有发布服务。源代码不执行checkout、hooks、子模块或LFS；拒绝符号链接与LFS指针。

支持dry-run。校验与正式发布是两次独立操作，正式发布应使用校验返回的完整commit，以确保分支移动不会改变已确认内容。本阶段未新增Web Git表单、私有Git凭据或自动同步。

## 真实流程

- 来源：https://github.com/Norte-AI/skillhub.git ，ref main，子目录builtin-skills/skills/weather。
- 解析提交：accdfeba94f4c6d2083c79965ba28303e890d41a。
- 目标：独立Registry48180，namespace isolation-review；使用普通发布者Token，没有管理员发布绕过。
- dry-run valid=true，无错误/警告。
- 正式提交返回action=submitted；待审包匿名下载400。
- 真实扫描、人工审批后下载200。
- ZIP包含.skillhub-source.json、LICENSE.txt、NOTICE.md、SKILL.md；来源字段与CLI输出及Git commit完全一致。
- artifact SHA256：8d0221a55fed46a86c290d43518c30cce3c78a429c021e693bbbdeb65c9fde47。
- 不带.git后缀的GitHub URL和显式固定SHA也已实际取件成功。

脱敏证据：[dry-run](dry-run.json)、[提交结果](publish.json)、[审批后产物](live-results.json)。凭据仅留在私有临时目录，未进入仓库。

CLI最终575测试通过，build/typecheck/lint通过。后端2260项，0失败/错误、1跳过；前端typecheck/lint通过；隔离make staging及18项smoke全部通过。草稿PR：https://github.com/Norte-AI/skillhub/pull/1 。现有48130隔离站与4317原项目均未被替换。
