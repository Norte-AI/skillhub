# 网页 Git 发布验收记录

日期：2026-10-15（Asia/Shanghai）。仓库：[Norte-AI/skillhub](https://github.com/Norte-AI/skillhub)，分支 `codex/git-publish`，网页提交 `b725ff64`，[草稿 PR #1](https://github.com/Norte-AI/skillhub/pull/1)。

## 功能与边界

发布页可选择文件上传或 Git 仓库。网页支持公开 GitHub HTTPS 仓库、分支/标签/commit、Skill 子目录；先预览技能元数据、文件及固定 commit，再将原样 ZIP 送入既有发布服务。来源字段修改使预览失效；扫描与审核按既有流程执行。私有仓库、其他 Git 托管平台、自动同步与 Webhook 尚未实现。使用说明在 fork 的 `docs/skillhub/guide/git-publish.md`。

新版独立站：http://127.0.0.1:48230/dashboard/publish ，Backend 48280，MinIO 48290。原 48130 站点保持运行。独立 Docker project `norte-web-git-check`；测试账号与原站独立。凭据仅在临时私有目录，不复制到项目文档。

## 验证结果

- 后端完整2268项，0失败/错误、1跳过；最后的GitImportService边界测试6项通过。
- 前端完整1069项通过，typecheck/lint/production build通过。Node25下使用 `NODE_OPTIONS=--no-experimental-webstorage` 避免原生Web Storage干扰jsdom。
- 完整隔离staging通过，18项smoke全部成功。
- 浏览器以普通发布者 `web_git_publisher` 发布到 `web-git-review`，真实导入 fork 的 weather 目录，commit `accdfeba94f4c6d2083c79965ba28303e890d41a`。不支持的主机被拒绝；没有预览不能提交；更改ref清除预览；固定SHA重读成功。
- 首次提交返回SCANNING（既有异步流程），扫描后进入审核。审核前匿名下载400；审核通过后下载200。
- 审批后下载与最终预览的每个文件逐字节一致，来源manifest一致。产物SHA256 `1a8f884b3f353069c1cafca34f46eeb5be3a56f46eb1c4dba31413a3172117c9`。
- 桌面1440和手机390宽度截图完成检查；无水平溢出。

首次浏览器断言原本只接受PENDING_REVIEW，实际请求成功返回SCANNING，属于既有异步生命周期；其后使用API继续核验扫描、审核、下载。Colima的MinIO重定向下载端口需额外48290任务转发，已补齐并完成产物核验。

脱敏证据：[最终结果](browser-proof.json)、[最终预览](browser-final-preview.json)、[提交响应](browser-publish.json)、[桌面截图](git-preview-desktop.png)、[手机截图](git-preview-mobile.png)。完整检查日志在 `/private/tmp/norte-web-git-publish-checks/`。
