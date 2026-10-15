# 只读 Git HTTP 传输

使用官方 [git-http-backend CGI](https://git-scm.com/docs/git-http-backend)，无需第三方依赖。

```js
const gitHttp = createGitHttpHandler({ rootDir: '/managed/bare-repositories', prefix: '/git' });
if (await gitHttp(req, res)) return;
```

仅接受直接来自回环地址的连接；不信任代理的 X-Forwarded-For。根 HTTP 服务负责 Host/Origin 校验。该入口无匿名远程访问能力，反向代理不能用于公开发布这个本地入口。

只服务 `codex.git` 与 `zcode.git` 的 smart HTTP upload-pack，支持 ls-remote、clone、fetch。禁用 receive-pack 及 dumb HTTP，不能读取 config、HEAD 等任意文件。仓库应由发布器生成和管理，仓库根不能是符号链接。非 `/git` 前缀返回 false；匹配的请求由处理器完成响应并返回 true。

默认请求正文上限 16 MiB、CGI 头上限 16 KiB、响应上限 256 MiB、读取与子进程超时各 30 秒。支持 gzip 请求，其压缩与解压后的正文分别受同一大小限制。后端使用隔离临时 HOME，禁用用户和系统 Git 配置，并在请求结束、断开或超时后清理进程与临时目录。

```sh
node --test tests/git-http.test.mjs
```
