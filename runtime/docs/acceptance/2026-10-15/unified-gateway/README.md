# 统一入口客户端链路验收

日期：2026-10-15。唯一Web入口 http://127.0.0.1:48230 ，未使用旧4317，未修改真实客户端配置。

实际通过：Registry会话登录→Java管理网关读取迁移后的personal→专名测试bundle构建三目标签名Release→固定公钥Ed25519验证→stable与市场发布→Codex Git快照发布→新设备凭据仅能访问分配的测试bundle→Streamable HTTP MCP固定Release get_content→Git ls-remote发现main及不可变snapshot tag。

专名验收Release：unified-client-acceptance-20261015@1.0.0。MCP是实际SDK HTTP请求，非模型自报；本次不重复调用三种客户端模型。报告仅保留标识、摘要、检查项和Git refs，不包含登录凭据、cookie或token。

部署中发现并修复真实卷错误：Git首次发布将/tmp中的裸库rename进独立Docker卷会发生EXDEV。现裸库stage位于目标父目录同一文件系统，仍经过全部内容校验，并在结束清理；真实Docker卷发布复验通过。Runtime镜像重建、仅该容器重启并健康，未删除数据卷。

`results.json`为精简持久证据。原始日志与0600测试设备凭据保存在主机私有`/private/tmp/norte-unified-platform`，凭据不随仓库分发。验收产生了测试内容、Release、设备和审计；此前迁移快照核验通过后目标有这些有意新增记录，不能把此后全库摘要变化当作迁移失败。

## Registry Skill真正进入签名Bundle

另行实际构建`unified-registry-skill-acceptance-20261015@1.1.0`，引用Registry导入的weather revision 1与验收Rule。三端产物逐一验证：Skill修订摘要一致、原始正文与全部4个资源（含来源provenance）完全保留、Ed25519签名均通过。精简证据见`registry-bundle-results.json`，全部通过单入口48230 Java管理网关执行，没有直接数据库写入或旧4317依赖。

该验收发现并修复导入兼容性：Registry内容ID是不可变包的哈希标识，不能作为原始`name: weather`的原生Skill目录名。导出器对有效Registry来源记录保留原始合法Skill name及目录，sourceId仍为原存储ID，碰撞检查和普通内容严格名称校验保留。新增三端回归证明原始正文/资源未被静默重写；12项exporter/product-flow测试通过。Runtime镜像已更新，真实1.1.0构建复验成功。

补充CRLF兼容回归：原生Skill frontmatter接受LF或CRLF，仅解析时标准化，不修改已锁定正文或生成第二份frontmatter；外部CRLF完整摘要快照的三端导出回归通过。最终Runtime全量数据库测试108/108通过、0跳过；最终镜像部署健康后再次经统一网关读取并验签上述weather包通过。
