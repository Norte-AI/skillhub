# Norte SkillHub 统一平台本机验收

日期：2026-10-15。主仓库`Norte-AI/skillhub`，统一Web入口`http://127.0.0.1:48230/`。记录本轮合仓、运行时网关、旧数据迁移与注册中心到运行时的联通验收，不能将历史模块测试计数当作本轮全量后端结果。

| 验收项 | 结果 | 实际边界 |
|---|---|---|
| 本机部署冒烟 | 18/18通过 | 统一Compose栈；loopback部署 |
| 登录与运行时页面 | 通过 | 真浏览器iframe可用、浏览器不持有内部runtime令牌 |
| 网关身份边界 | 通过 | 匿名401、普通发布者403、SUPER_ADMIN 200；internal路径拒绝 |
| Java数据库schema | 通过 | Hikari/Flyway固定public，runtime使用skillhub，不baseline/搬表 |
| 旧数据迁移 | 通过 | 只读源快照，2内容项/1Bundle/1Release/1渠道/1listing，verify摘要一致；旧源数据保留 |
| 公开固定技能导入 | 通过 | weather公开PUBLISHED版本导入；重复导入revision仍1；不允许绕过审核或导入私有内容 |
| runtime真实数据库回归 | 106项通过 | 模块完整数据库测试 |
| 前端回归 | 1076项通过 | 本轮前端检查 |
| 签名与发布 | 真实导入衔接复验通过 | Registry weather固定版→runtime→三端签名Bundle通过；12项exporter/productflow检查通过；stable/listing/Git通过 |
| 客户端同源分发 | 通过 | 限定assignment的设备令牌；48230/runtime/mcp固定Release get_content；48230/runtime/git/codex.git真实ls-remote |
| Git跨卷发布修复 | 8项定向测试通过 | EXDEV窄修部署后再次实际发布验证 |
| 本轮Java全量后端 | BUILD SUCCESS | 2285 tests，0 failures/0 errors，1 skipped；跳过不计通过 |
| 仓库交付 | 完成 | 统一分支提交并通过PR交付；本机运行验收独立留证 |

[同源客户端网关实测结果](client-gateway-results.json)保留Release摘要、Git refs及逐项检查，不包含设备令牌、内部令牌、cookie或数据库连接串。

固定Release为`unified-client-acceptance-20261015@1.0.0`，摘要`979639bd726f01d976231339e2c1a53671f0cfc6972707817d33e9fd89ce012d`。HTTP MCP取件固定Release，不因stable移动而混入其它版本。三目标产物验签与既有Codex/ZCode/Kimi真实模型证据是不同层次：本轮同源集成不声称重新调用三端模型；既有真实行为证据仍在`runtime/docs/acceptance/2026-10-15/clients/`。

范围决定：公网部署不做；真实外部私有GitHub/GitLab按用户决定后补，目前隔离集成验证交付；Kimi原生自动注入未通过，用户接受固定版本+显式初始化，实测HTTP MCP通过。Git来源支持GitHub/GitLab，不支持Gitee。

旧4317受管服务已由根任务停止，保留其数据、密钥和历史目录，旧README重定向统一主仓库。原48130评估站保留历史地位，不是统一项目使用依赖。


统一整栈所有卷与私有配置的备份恢复演练本轮未执行，不标通过。已完成的是原runtime模块历史恢复演练及本轮旧数据迁移快照只读校验；下一步N15应在隔离目标实际恢复Registry数据库、MinIO、runtime数据库/Git及密钥配置的一致窗口备份。


实际weather注册中心→runtime导入已通过，但继续Bundle构建发现frontmatter技能名与内容ID映射问题，构建400。该问题已通过exporter窄修和12项检查修复，真实weather→三端签名Bundle复验通过；失败过程保留，不再是当前阻断。


[真实Registry技能到三端签名Bundle结果](../../../runtime/docs/acceptance/2026-10-15/unified-gateway/registry-bundle-results.json)是N06最终证据，独立于之前合成Bundle网关验证。
