# 北邮学习台 · 分享版

将本人授权访问的北邮课程、作业截止和未完成作业同步到 Google Calendar / Google Tasks。可选私有学习台支持通知详情、课程筛选和资料文字阅读。示例均为虚构数据，不包含任何个人账户、站点、同步历史或课程文件。

## 不用账号试跑

需要 Node.js 22+。运行 `node site/scripts/demo.mjs`，打开 http://127.0.0.1:4173/。演示只监听本机，不访问 Google、北邮或 Sites，不提供写入接口。终端按 Ctrl+C 停止。

## 配置自己的同步

1. 用自己的专用仓库（推荐私有）运行 GitHub Actions。将学校凭据放在 Actions Secrets：`BUPT_USER`、`BUPT_PASSWORD`、`BUPT_JWGL_PASSWORD`。使用学校允许的方式，仅访问本人有权读取的数据。同步不会提交作业或标记通知为已读。
2. 在自己的 Google Cloud 项目启用 Calendar API、Tasks API，创建 Web OAuth 客户端并登记回调 `http://127.0.0.1:8765/callback`。授权后将 `GOOGLE_CLIENT_ID`、`GOOGLE_CLIENT_SECRET`、`GOOGLE_REFRESH_TOKEN` 放在 Actions Secrets。已有 Deno 和登录的 GitHub CLI 时可用：
   ```sh
   deno run --allow-read=/path/to/client.json --allow-net=127.0.0.1:8765,oauth2.googleapis.com --allow-run=gh scripts/google_oauth.mjs --github /path/to/client.json YOUR_OWNER/YOUR_REPO
   ```
3. 在 Actions 先手动运行只读检查。想启用定时写入时，再把仓库 Actions Variable `ENABLE_SCHEDULED_SYNC` 设为 `true`。Calendar 和 Tasks 均成功结束才显示正式同步成功；只读检查不写入。
4. 可选：建立**仅自己可见**的 ChatGPT Site。将 `site/.openai/hosting.example.json` 复制为同目录的 `hosting.json`，换成自己的站点项目 ID，配置 R2 绑定 `BUCKET` 和运行时密钥 `BUPT_INGEST_SECRET`，再按 Sites 的 Worker 发布流程部署。将自己的 Site 源地址（只填 HTTPS 域名，不填路径）放进仓库 Variable `BUPT_SITE_ORIGIN`，然后设置两个 Secrets：`BUPT_SITE_SERVICE_TOKEN` 和 `BUPT_SITE_INGEST_SECRET`；后者与站点运行时的 ingest 密钥一致。没有这组配置时仍可独立同步 Google。不要把任何真实数据接到公开演示站。
5. 课程学期边界和日历命名可在 `src/semester.mjs`、`src/google.mjs` 检查；跨学期运行前验证。若账号要求验证码，先了解学校访问规则及认证依赖的数据流。本项目不要求开启第三方 OCR；如果自愿配置，相关验证码数据会发送给服务提供方。

## 测试

```sh
deno check src/sync.mjs
deno test tests/
node site/scripts/test.mjs
npm --prefix site run build
npm --prefix site run validate
```

站点示例配置中的项目 ID 是占位符，用于测试构建，不能原样部署。没有任何原始 Git 提交历史；依赖应遵循各自许可。本包未替原作者选择开源许可证。
