# Release 产物签名

服务端可用 Ed25519 为构建产物签名。客户端必须固定可信公钥，才能判断产物确实来自预期发布者；仅核对 SHA256 不能证明发布者身份。

## 创建密钥

在项目根目录执行，输出目录必须尚不存在：

```sh
node scripts/signing-keygen.mjs --out .skillhub-keys
```

得到 `private.pem`、`public.pem` 和 `trusted-keys.json`。目录权限为 0700，私钥为 0600；命令拒绝复用已有目录或覆盖密钥。该目录已加入项目 Git 忽略规则；正式部署应选择持久安全路径。私钥不可提交到 Git 或发送给客户端；公钥与 trusted-keys 文件需经可信渠道交给使用者。

## 配置服务端

```sh
SKILLHUB_SIGNING_KEY_FILE=.skillhub-keys/private.pem npm run dev:db
```

修改配置后重新启动服务。新构建的 Release 产物包含签名；旧版本保持原样，不会自动补签。保持发布密钥持久化，避免重启后更换身份。轮换时先通过可信渠道更新客户端 trusted-keys，再使用新密钥构建版本；需要拒绝旧密钥时从可信列表移除，但之后旧签名版本的回滚也会被拒绝。

## 客户端强制验签

```sh
npm run cli -- install release-tools --client codex \
  --server http://127.0.0.1:4317 \
  --trusted-keys .skillhub-keys/trusted-keys.json

npm run cli -- doctor --trusted-keys .skillhub-keys/trusted-keys.json
```

trusted-keys 是 JSON 对象，键为 keyId、值为公钥 PEM。使用 `--trusted-keys` 后，缺少签名、不受信任密钥、错误签名或被篡改的内容都应失败；不要从待验证产物本身自动信任公钥。不传该选项保留历史未签名版本兼容路径。

签名覆盖版本 Release digest、目标 manifest 和产物 digest；验证同时重算内容与产物 SHA256。签名通过只证明发布者与完整性，不证明 Skill 安全、正确或已在原生客户端加载。目前 CLI 是隔离暂存工具；Codex Git 原生插件安装没有接入本项目 CLI 的签名验证，应分别记录其证据边界。

模块 API 位于 `packages/signing/index.mjs`：`generateSigningKeyPair`、`signingKeyId`、`signArtifact`、`verifyArtifactSignature`、`verifyReleaseSignatures`。签名失败抛出 `SIGNATURE_INVALID`。测试运行 `node --test tests/signing.test.mjs`。
