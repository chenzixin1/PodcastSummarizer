# PodSum Chrome Extension

## 功能
- 登录 PodSum 账号（邮箱 + 密码）
- 在 YouTube 页面点击“添加当前视频”
- 路径 1：抓取页面字幕 -> 本地下载 `.srt` -> 上传 PodSum
- 路径 2：页面无字幕时可手动启动，浏览器下载音频 -> 上传 PodSum -> 火山转写 -> 网站分析
- 最近任务列表（最多 5 条）+ 状态灯（S / D / U / P）
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
- Path1 失败后，任务会进入 `awaiting_path2_confirm`，可在任务行内点击“启动 Path2”
- Path2 下载策略为双栈：先 `youtubejs`，失败自动回退 `local_decsig`
- Path2 时长限制默认 180 分钟，转写轮询超时默认 60 分钟
