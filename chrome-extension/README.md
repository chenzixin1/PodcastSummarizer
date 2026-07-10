# PodSum Chrome Extension

## 功能
- 使用 PodSum Google 登录授权扩展，邮箱密码登录作为兜底
- 在 YouTube 页面点击“添加当前视频”
- 服务端抓取字幕 -> 上传 PodSum -> 网站分析
- 最近任务列表（最多 5 条）
- 两次通知：上传成功、分析完成

## 开发测试
1. 打开 Chrome `chrome://extensions/`
2. 开启开发者模式
3. （可选）先执行 `npm --prefix chrome-extension run stamp-version`，把 `manifest.version_name` 更新为当前 git short hash
4. 点击“加载已解压的扩展程序”
5. 选择本目录：`chrome-extension`

## 版本可见性
- Popup 顶部会显示：`版本 <manifest.version> (git-<short-hash>)`
- 排障时请先确认该版本号，再截图或反馈问题，避免旧扩展干扰

## 设置
- 右键扩展 -> 选项
- `PodSum 网站地址` 默认 `https://podsum.cc`
- 本地开发可改为 `http://localhost:3000`

## 说明
- Google 登录通过 Chrome `identity.launchWebAuthFlow` 打开 PodSum 登录页。只有配置在 `CHROME_EXTENSION_IDS` 白名单中的扩展构建可以接收 PodSum 访问令牌。
- 邮箱密码登录仍保留给本地调试或 Google OAuth 不可用时使用。
