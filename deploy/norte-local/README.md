# Norte 本机交付环境

本环境用于本机验收，不面向公网。独立 project `norte-web-git-check`，Web 48230、API 48280、MinIO 下载 48290，不替换原48130或4317服务。需要 Docker Compose v2（支持 `!override`/`!reset`）、Java21、pnpm、Python3。服务使用现有 staging 测试管理员 `admin / Admin@staging2026`，不得直接用于公网。

仓库根执行 `scripts/norte-local.sh up` 构建并启动；`status` 检查，`logs` 查看日志，`down` 停容器但保留数据卷。GitHub与GitLab已配置，自动检查开启；随机Webhook主密钥首次写入 `.norte-local/git-config.json`（0600，目录0700，Git忽略），重启复用同一文件。备份时必须保留数据库、MinIO卷与此配置，否则既有Webhook密钥失效。可通过 `NORTE_LOCAL_STATE` 指定受保护目录。

原有验收环境继续使用其临时私有配置时，先复制到上述 `git-config.json` 再运行脚本，避免意外轮换主密钥。私有仓库配置按[Git发布指南](../../docs/skillhub/guide/git-publish.md)在此JSON中增加凭据别名及授权userId，勿在命令行、文档或Git中写Token。服务端options只返回当前用户获授权的别名。

Colima若无法自动转发VM端口，可用其SSH配置为48230/48280/48290建立独立loopback转发；不要结束已有共享SSH master。标准Docker Desktop通常不需要此步骤。验收环境通过完整staging与18项smoke检查；当前运行站地址为 http://127.0.0.1:48230/dashboard/git-sources 。

手动同步、定时检查及Webhook都重新读取已配置仓库/ref并检查账号/命名空间权限，不能用Webhook payload指定来源。相同commit不重复发布；新commit需要新的SKILL.md版本，否则显示失败，保留既有版本。来源仅属创建用户，管理员身份不会继承其来源或跳过审核。
