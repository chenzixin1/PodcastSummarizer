# Full Text 阅读重点恢复

## 范围与依据

历史 `lib/prompts.ts` 的 Full Text 提示词要求重要事实、数字、决策加粗；`26aa0f8` 添加了 Summary 的本地关键词强调。Watchless 后来改用原话投影，原文没有 Markdown 重点标记，因此只剩说话人加粗。未找到名为 Bionic 的既有实现，不将用户描述擅自解释为单词前半段加粗。

本次仅恢复显示层重点：使用与现有摘要相同类别的术语、缩略词和数字信号，限制密度；既有加粗、代码、链接、时间戳和原文不改变。不调用模型、不回写文章、不重新计费。

- [x] 实现共享 Markdown AST 阅读强调，接普通 Full Text 与 Watchless 的中文、英文、对照、词汇模式。
- [x] 自动测试验证原文字符保持、已有加粗、链接与生词提示、边界与密度。
- [x] 迭代预览：桌面与移动真实浏览器检查强调与生词交互。
- [x] 注册发布：交付独立 commit 给 authorized_retry，由其统一生产部署。

## 本地验证（2026-09-06）

- TypeScript 通过；定向三套测试 24 项通过，补充强调节点内发音按钮回归测试。ESLint 无错误，dashboard 原有 9 条警告保持不变。
- 浏览器使用本地代码和只读生产文章数据；上方四模式均出现重点，下面四模式分别有 225 / 128 / 353 / 128 个 strong（包含原有说话人）。词汇模式保留 147 个提示按钮，其中 3 个包含新强调，`deployment` hover 显示词义并请求原有 pronunciation 词库；单测验证 hover 和 tap 仍使用原单词。
- 390×844 无横向溢出；1440×960 与手机截图实际回看，暖纸、原字体和强调颜色未改。截图：`output/playwright/reading-emphasis-fulltext-desktop.png`、`reading-emphasis-watchless-desktop.png`、`reading-emphasis-watchless-mobile.png`、`reading-emphasis-vocabulary.png`。
- 本地没有 R2 绑定，关键帧接口的 503 属于预览环境，不是本次阅读强调错误；生产发布后另行核验。此变更不更新任何 D1/R2 或模型内容。

## 生产验收

- Worker `d0faa1c7-0473-4e9d-9a45-ac5e930274f3`（release `b83a8bc`，代码 `ae53f1a`），目标 `/dashboard/watchless-veizk1m7v7e`。
- 桌面 1440×960、手机 390×844，上方四模式与 Watchless 四模式实际切换通过；明暗色均可读，移动无横向溢出。
- 30 张关键帧只读 GET 全部返回 200，生产不存在本地预览的 R2 503。
- 147 个生词提示保留；`deployment` 内部 strong 保留，hover 词义正常。该词无预录音频，实际点击确认调用原有浏览器 `speechSynthesis.speak('deployment')` 回退，未声称听到音频。测试用的浏览器方法观测包装已恢复。
- 生产截图：`output/playwright/reading-emphasis-production-fulltext-mobile-light.png`、`reading-emphasis-production-watchless-desktop-light.png`、`reading-emphasis-production-watchless-mobile-light.png`、`reading-emphasis-production-vocabulary.png`。已实际回看生产桌面与手机版图片。
