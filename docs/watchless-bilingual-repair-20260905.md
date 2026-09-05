# Watchless 双语修复记录 · 2026-09-05

## 已发布

- URL 与 MCP 发布共享双语检查及按场景补齐逻辑；不完整内容不会被当作完整双语文章发布。
- 保留 sourceTranscript，译文与原话分别标识；中文原话文章的 English 显示 Translation。
- 翻译按段落编号验证数量、顺序和非空内容，并缓存中间结果；401/403 不自动重试。
- Sam Altman 文章 `watchless-vv3ceas-w34` 修复 JSON ID 与数据库 ID 不一致导致的 500；正文未重新生成。
- `watchless-hi2kb8eizwy` 的 20 场景和 `watchless-z_f0z7wf5xu` 的 19 场景补齐双语，新 R2 对象发布后逐场景回读比对一致。
- 林杰屏文章混合中文开场的两段英文由 Codex 补译，其他英文段落保持原文，完整原始文本仍保存在 sourceTranscript。

## 验证

- 31 篇发布 API 全部 HTTP 200；13 篇四种模式，18 篇仅中文。
- 生产页面实际展开并切换中英对照、词汇提示；中文原话文章确认显示“中文 / 原话实录”和“English / Translation”。
- 定向单元测试、类型检查、ESLint、diff 检查与 OpenNext 构建通过。
- Worker 版本：`80dc0522-5b44-4648-ba13-f601a7493963`。Container 未部署新版本。
- 未提交新的付费 URL 转换任务；未做新的真实 MCP 发布端到端测试。

## 尚未完成

历史全量升级期间，Luna 对部分请求返回 HTTP 403 地区不可用。18 篇单语文章仍需补齐；部分已有双语的旧文章仍为编辑稿，不能声称全站已经升级为逐字原话。等待用户授权其他可用低价模型，未更改模型或绕过限制。

本次修复保留已有转录，不代表原始 ASR 错词已经校正。译文完整性检查验证结构和语言，不等同于逐句人工语义审校。

## 恢复与回滚

31 篇原始 JSON 与清单位于本地 `outputs/watchless-bilingual-repair/`，原 R2 对象保留。迁移脚本 `scripts/repair-watchless-bilingual.ts` 支持 `--id=<podcast-id>` 及 `--apply`；不加 apply 仅生成本地结果。缓存可恢复，数据库指针更新校验旧值，避免覆盖并发修改。

需要回滚时，使用清单及备份确认旧 article_key 后有条件切回数据库指针，不删除新旧对象。密钥仅从执行环境读取，不纳入版本库。
