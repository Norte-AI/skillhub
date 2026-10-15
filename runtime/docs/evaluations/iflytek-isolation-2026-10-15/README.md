# 讯飞 SkillHub 隔离验证

验证日期：2026-10-15，Asia/Shanghai。结论：上传、真实扫描、审核、版本发布、CLI 安装/更新/降版和 Codex 技能发现均通过，具备作为技能管理底座的可行性。本轮没有迁移原项目，也没有调用模型执行技能。

## 环境与隔离

- 官方 server/web/scanner 稳定镜像 0.2.22，源码提交 `72429e6f69ac5d04e8314b1eed2f8c055809c9f5`。应用镜像按实际拉取的摘要固定，详情见 [镜像记录](image-manifest.json)。
- 第一方 npm CLI `@astron-team/skillhub@0.1.12`，在临时目录解包执行，无全局安装。
- Compose 项目 `iflytek-skillhub-isolation`；独立 PostgreSQL16、Redis、存储卷与扫描服务。
- Web http://127.0.0.1:48130/；API http://127.0.0.1:48180；端口只绑定回环。
- 本机 Colima 的回环端口没有直接转发到 macOS，因此使用单独 SSH 回环隧道访问，未更改 VM 或全局代理配置。
- CLI HOME、CODEX_HOME、项目技能目录均位于 `/private/tmp/iflytek-isolation-20261015/cli-tests/`。原服务4317仍 ready，真实用户 Codex 配置未修改。
- 使用隔离的 bootstrap 管理员与普通发布者。密码、Token 只存临时私有文件，未写入本报告或仓库。

## 验证结果

| 项目 | 结果与证据 |
|---|---|
| 普通发布者上传 v1/v2 | 创建待审任务，启用真实扫描服务，未配置 LLM 分析 |
| 待审核版本 | 匿名解析与下载均400，审核前不能公开获取 |
| 扫描与批准 | 扫描进行中批准400；扫描完成后批准200 |
| 不可变版本 | 同版本覆盖400；已批准 v1 ZIP 的 SHA256 保持不变 |
| 渠道与历史 | stable 指向1.1.0，再回滚1.0.0；历史v2仍可按固定版本获取 |
| 拒绝审核 | v1.2.0保持REJECTED，扫描结束后匿名下载仍400 |
| CLI生命周期 | 安装1.0.0 → upgrade到1.1.0 → 显式安装1.0.0降版，清单/元数据/正文均一致 |
| Codex发现 | 隔离 app-server skills/list 识别 `.agents/skills` 和默认 `.codex/skills` 的技能，enabled=true，无解析错误 |
| Web | 市场、技能详情、README、文件浏览和版本正常；安装指引使用隔离站地址；未观察到外部Registry请求 |
| 重启恢复 | 独立数据库与应用分别重启后，渠道、历史、ZIP及既有API Token均保留 |

[注册审核证据](registry-results.json)、[CLI生命周期](cli-lifecycle-results.json)、[原生安装](cli-native-install.json)、[Codex默认目录发现](codex-native-discovery.json)、[Web检查](web-results.json)、[重启检查](restart-results.json)。注册审核报告中的37条成功观察含恢复执行重复步骤，不代表37个独立测试案例；早期失败保留在diagnosticAttempts中。

## 接入时需要处理的事项

1. 超级管理员发布会跳过人工审核。测试和团队日常上传应使用普通发布者，不能用管理员演示代替审核验收。
2. 公开/命名空间可见发布要求扫描器启用，单独禁用scanner会阻止这些发布。审批还需等待异步扫描完成，本轮样例约6秒。
3. 稳定0.2.22的认证入口与main文档存在差异，身份方法查询为 `/api/v1/auth/methods`。不存在的旧测试路径返回了通用500，已记录。
4. stable标签PUT请求实际需要 `{tagName:"stable",targetVersion:"1.1.0"}`，只有targetVersion会400。
5. 降版使用 `install --version 1.0.0 --force`；upgrade用于升级，不能当作降版命令。
6. 当前本机Codex实际支持上游默认`.codex/skills`，无需因官方文档侧重`.agents/skills`而判定默认安装失败。应按实际客户端版本复测。

## 边界与采用建议

本轮证明本地技能注册治理、分发与发现；未验证模型实际选择/执行Skill、新旧会话固定、Kimi桌面/ZCode、Codex Git原生插件市场导出、Suite组合安装、LLM安全分析或公网部署。浏览器截图工具失败，Web证据来自真实页面/网络/布局冒烟检查，不是截图视觉验收。

建议优先用上游承接内容、审核、权限、版本与市场。现有项目保留原生Git导出、三端适配、MCP和会话证据能力；数据迁移与权限映射在下一阶段单独验证。本轮只做隔离部署和验证，未替换原项目。

复现配置和测试脚本见 [实验目录](../../../experiments/iflytek-isolation/README.md)。
