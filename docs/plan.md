# PodSum Watchless 四种阅读模式执行计划

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
