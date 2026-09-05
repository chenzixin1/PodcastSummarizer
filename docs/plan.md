# PodSum Watchless 双语完整性修复执行计划

**Goal:** 补齐历史文章双语内容，修复加载失败，并保证新发布内容具备真实四种阅读模式。
**模板:** 现有 Next.js / Cloudflare 项目
**needs_dw:** false
**needs_db:** true

- [x] Task R1: 备份 31 篇线上文章，定位 Sam Altman 校验失败与单语数据来源。
- [x] Task R2: 在 lib/watchless 中实现双语完整性检查、原文标识与发布补齐；保留原话。
- [ ] Task R3: 添加可恢复的历史迁移脚本，逐场景翻译、校验、上传新版本并安全切换。
- [x] Task R4: 定向测试、类型检查和生产构建。
- [x] Task R5: 迭代预览，真实检查中英四种模式和代表性历史文章。
- [x] Task R6: 注册发布，Cloudflare 增量发布、全量 API 回读及 GitHub 同步。

2026-09-05：R3 脚本已完成，2 篇历史双语内容已发布；全站 31 篇 API 均返回 200，其中 13 篇具备四种模式，18 篇仍只有中文。剩余补齐被 Luna 的 HTTP 403 地区限制阻断，等待用户决定是否允许其他低价模型，未擅自切换。Sam Altman 的文章 ID 不一致已修复。Worker 已发布为 `80dc0522-5b44-4648-ba13-f601a7493963`，Container 未改动。详见 `docs/watchless-bilingual-repair-20260905.md`。

## 上轮已完成记录

**Goal:** 让 Watchless 完整图文真实支持中文、English、中英对照和词汇提示，同时保证英文原话逐人逐行、不被模型改写。
**模板:** 现有 Next.js + Cloudflare Worker / Workflow / Container / D1 / R2 项目
**needs_dw:** false
**needs_db:** true

---

- [x] **Task 1: 核对文章数据契约与线上兼容边界**

  **Files:**
  - Inspect: `lib/watchless/article.ts`
  - Inspect: `components/watchless/WatchlessReader.tsx`
  - Inspect: `containers/watchless-runtime/app.py`

  **Step 1:** 明确中文翻译、英文原话、中英对照和词汇提示各自使用的数据字段与标签，保留旧 Watchless 文章兼容性。

  **Step 2: 验证**

  确认任何翻译失败都不会覆盖英文 ASR 原话，也不会把英文原话误标成中文。

- [x] **Task 2: 生成逐条对齐的中文翻译**

  **Files:**
  - Modify: `containers/watchless-runtime/app.py`

  **Step 1:** 给每条 ASR 发言稳定编号，调用 Luna 生成仅包含编号与中文译文的结构化结果；按批次校验编号完整、唯一且无越界。

  **Step 2:** 按场景和说话人分别组装中文翻译与英文原话，保持同一时间线和发言顺序；保存翻译中间产物以便诊断。

  **Step 3: 验证**

  Python 单元测试覆盖完整翻译、缺项、重复编号和场景组装，原始英文逐字归一化对比必须完全一致。

- [x] **Task 3: 完成四种阅读呈现**

  **Files:**
  - Modify: `components/watchless/WatchlessReader.tsx`
  - Modify: `components/watchless/watchless.css`
  - Modify: `lib/watchless/article.ts`

  **Step 1:** 中文模式明确显示“中文翻译”，English 明确显示“英文原话”，中英对照使用同场景双栏，词汇提示在英文原话上加载 PodSum 词表。

  **Step 2:** 根据文章能力显示可用模式，并为旧文章提供安全降级，不展示没有真实内容的入口。

  **Step 3: 验证**

  键盘、移动端堆叠、加载失败回退和辅助标签通过定向组件测试。

- [x] **Task 4: 自动化与构建验证**

  **Files:**
  - Modify/Create: `__tests__/**`
  - Modify/Create: `containers/watchless-runtime/tests/**`

  **Step 1:** 运行定向 Jest、ESLint、TypeScript、Python 测试与编译、生产构建及 `git diff --check`。

  **Step 2:** 校验文章 JSON 规范化后包含四种模式，且 PDF 与正文仍可生成。

- [x] **Task 5: 迭代预览**

  **Files:**
  - Verify: `components/watchless/WatchlessReader.tsx`

  **Step 1:** 在本地 Watchless 完整图文中逐一切换四种模式，使用桌面和手机视口真实回读。

  **Step 2: 验证**

  中文、英文、双语和词汇提示内容均可辨识，正文无横向溢出，场景与说话人行保持一致。

- [x] **Task 6: 注册发布**

  **Files:**
  - Deploy: Cloudflare Worker / Workflow / Container

  **Step 1:** 通过项目既有 Cloudflare 发布链路部署，核对 Worker 版本、Container 镜像与健康状态。

  **Step 2:** 用线上历史英文文章回归 English 与词汇提示，用本地真实样例和自动化测试核对四种模式、原话完整性与翻译对齐；不在未获授权时额外创建消耗 1000 积分的生产任务。

  **Step 3:** 将 page-deliver state 标记完成并记录生产回读证据。
