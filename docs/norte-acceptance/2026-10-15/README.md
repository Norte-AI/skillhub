# Norte 本机 Git 发布与同步验收

2026-10-15，源码分支codex/git-publish，组织PR #1。正式交付只要求本机环境，GitLab为新增优先平台。启动与私有配置见 [本机部署](../../../deploy/norte-local/README.md)。

## 结果

- 后端完整2282项，0失败/错误、1跳过，含真实PostgreSQL来源V75迁移/UUID/租约/停用/轮换/删除。
- 前端完整1074项通过；typecheck、lint、production build通过。文档站build通过。
- 完整make staging通过，18项smoke全部成功。
- GitLab真实公开仓库 `gitlab-org/ai/skills` 的 `skills/mcp-creator` 导入成功，9文件，固定commit `0021229ee3b697ee258639de2352c320fb93462a`。
- 浏览器1440及390宽度：新增来源不发布、Webhook生成/隐藏、暂停/恢复、暂停时同步禁用、无横向溢出/运行错误。
- 真实HTTP：所有者隔离、普通用户同步进入SCANNING、相同commit幂等、假签名拒绝、有效签名重新读取已配置源、轮换使旧签名失效、暂停拒绝同步。
- 重启后保留来源及commit；仅将本次测试来源的时间回拨16分钟，真实定时轮询重新远程检查，结果UNCHANGED（没有模拟调度响应）。

## 能力与验证边界

私有GitHub采用固定API trees/blobs，不开放重定向；GitLab采用原生API和PRIVATE-TOKEN，凭据别名严格绑定用户和完整仓库。两条私有链路经过隔离fake-transport快照集成测试。未提供外部组织私有只读凭据，因此没有宣称真实外部私有仓库验收通过。Gitee枚举模板不是已交付平台，默认不启用、不在页面宣传。

完整日志保存于 `/private/tmp/norte-full-delivery-20261015/`。本目录仅保留脱敏结果，不含Token/Webhook主密钥。日志里的CLI未变化部分沿用先前575测试证据。原站48130保留；旧规则平台4317本轮已重新启动并HTTP/MCP smoke通过。
