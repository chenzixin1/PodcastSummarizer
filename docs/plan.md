# PodSum 修复、上线与完整自测执行计划

**Goal:** 修复本轮审查的安全和内容链路问题，让 MCP/URL Watchless 同时提供完整分析与原话图文，切换 GLM 并验证生产。
**模板:** 现有 Next.js / OpenNext / Cloudflare Worker、D1、R2、Container，不迁移技术栈。
**needs_dw:** false
**needs_db:** true

用户已明确授权修复和上线。所有历史更新先备份，原始字幕和原图不覆写；不新增充值，不使用 Superpower。

- [x] **F1: 权限与规范源** — 修复 `app/api/files/[...key]/route.ts`、`lib/objectStorage.ts`、`app/api/process/route.ts`：文件必须属于可访问播客；私有和未知资源不缓存；处理只使用数据库源。验证匿名/非所有者/所有者/公开、跨源地址及大小边界。
- [x] **F2: 完整分析生命周期** — `lib/watchless/analysis*.ts`、发布/队列路由与 D1 migration 区分 overview、queued、complete、failed；为 Watchless 生成双语完整 Summary 和脑图，但绝不改写英文原话。验证幂等、错误保留图文、可恢复重试。
- [x] **F3: bundle 数据契约** — `lib/watchless/jobs.ts` 按场景引用精确绑定关键帧，保存规范字幕而非 article JSON，验证来源一致性和全文大小。补非补零图片名、无字幕、原话篡改和超限测试。
- [x] **F4: 服务端数据与 UI** — 删除生产样例覆盖，保留开发预览；同步分析状态和重试入口；检查四种阅读模式、目录、折叠、问答与键盘体验。
- [x] **F5: 依赖与安全复核** — 检查可达依赖、优先兼容更新/删除未用依赖；复核所有输入、权限、并发和资源预算。对无法安全本轮解决的问题记录证据，不虚报通过。
- [ ] **F6: 历史数据备份与回填** — 备份生产 D1/文章引用；全文按文章逐场景恢复；完整分析先单篇验证，再有界批量补齐，保留每篇结果与失败原因。
- [x] **F7: 全量自动回归** — Jest、Python、TypeScript、lint、依赖审计、生产构建，覆盖新增安全与内容契约。
- [x] **F8: 迭代预览** — 本地真实浏览器 1440×960 / 390×844，自测 Summary/全文/脑图/完整图文、四语言模式、原视频/PDF、无横向溢出和折叠焦点，保存截图。
- [x] **F9: Dockerfile 检查/构建** — 确认 GLM 模块进入 Linux amd64 Container，构建并测试；Worker 与 Container 版本一致，积分1000门槛不变。
- [ ] **F10: 注册发布** — 在干净的 Git 发布版本运行 Cloudflare 迁移/部署；生产回读权限、内容、模型和任务状态，端到端 smoke；记录 commit、Worker/Container 版本与回滚边界。历史安全缓存单独核查。

## 追加：词汇浮层字体一致性

- [x] T1: `app/globals.css` 与 `components/watchless/watchless.css` 共用词汇字体、字号、释义和主题色变量；保留完整图文正文衬线字体，修复深色中文释义对比度。
- [x] T2: 迭代预览 — 85 套 712 项通过；真实浏览器确认下方浮层使用 Geist/中文无衬线、13.12px 释义、14.4px 标题；浅/深色截图，390px 浮层 x=35、宽320，正文衬线保留。生产再比对上下两处。
- [x] T3: 注册发布 — Worker `5c8cbc28-1cfe-4aec-a20e-c5dde0ddf490`，代码 `84faad7`；Container 镜像、数据和积分不变。生产上下浮层浅/深色字体、字号、字重、文字色完全一致；390px 下两处 x=35、宽320，无截断。

## 之前迭代记录（以下待办由本轮 F1–F10 接续）

## 本轮：项目审查、MCP bundle 分析差异与 UI 优化

**Goal:** 核对字幕处理和 Watchless 发布的数据差异，记录有证据的问题，修复本轮相关内容与阅读 UI；保留现有暖纸张设计。
**模板:** 现有 Next.js / Cloudflare / Python 项目；needs_dw=false，needs_db=true。

- [x] V1: 对比 `lib/watchless/jobs.ts`、`app/api/process/route.ts` 和线上 D1 字段覆盖，确认 Summary、Full Text、Mind Map 的缺失来源；只读查询，不批量生成或覆盖历史数据。
- [x] V2: 审查 MCP 鉴权、发布校验、状态/积分事务、文件访问、页面加载与部署配置；在 `docs/project-review-20260905.md` 记录严重性、文件位置与证据。
- [x] V3: 修复已确认的 bundle 映射/呈现问题并补回归测试；不把文章导语伪装为完整分析，不重写英文原话。
- [x] V4: 优化详情页分析与完整图文的关系、空状态和键盘/reduced-motion 体验；复用 `.impeccable.md` 设计。
- [x] V5: 迭代预览：72 套/565 个 Jest 测试、6 个 Python 测试、类型检查与 OpenNext 构建通过；1440×960 和 390×844 无横向溢出，截图位于 output/playwright。预览为公开数据只读代理，未回填生产。
- [x] V6: Dockerfile 检查：确认 COPY 包含 GLM transport；容器镜像尚未构建发布，不改变其他模型或已有积分机制。
- [ ] V7: 注册发布：汇总审查与预览结果；本轮 UI 先预览，生产发布与历史回填另行确认，不绕过发布检查。

## 本轮：切换 Cloudflare 托管 GLM-5.3 Flash

- [x] M1: 官方模型标识与小额 API 翻译验证，`@cf/zai-org/glm-5.3-flash` 返回 HTTP 200。
- [x] M2: TS/Python transport 增加 Workers AI 原生接口和响应校验，保留 OpenRouter 兼容路径。
- [x] M3: 配置仅 Workers AI 权限的服务令牌，模型配置传递到 Container；保留积分门槛与退款逻辑。
- [x] M4: 单元测试、类型检查、真实结构化翻译 smoke test。
- [x] M5: 迭代预览：构建检查和模型显示检查；不启动历史批量任务。
- [ ] M6: 注册发布：Cloudflare Worker/Container 发布并核实线上配置；未验证不宣称切换完成。

**Goal:** 增加直连 Cloudflare 统一计费 API 的可选通道，先小额验证 Luna，不自动充值或切换生产。
**模板:** 现有 Next.js / Cloudflare / Python Container
**needs_dw:** false
**needs_db:** true

- [x] G1: 核对官方 Luna 目录与现有账户权限；以单次短请求测试，不输出密钥。

2026-09-05 调用诊断：网页 Playground 的标准 `openai/gpt-5.6-luna` 返回 OK；Wrangler OAuth 经账户 Responses API 返回 402 Payment error，经网关原生 Responses 返回 401 Unauthorized。创建当前账户 Run 权限的 `PodSum Watchless Luna` 专用令牌后，原生 Responses 请求返回 403 `unsupported_country_region_territory`（Country, region, or territory not supported）。因此尚未修通生产 API，停止模型重试和上线；不得通过伪装地区或复用网页登录会话规避准入。临时远程绑定探针因 Network connection lost 未得出有效模型结果。现有 provider 代码仍为未上线草稿。
- [ ] G2: `lib/watchless/modelProvider.ts` 与 Python provider 配置提供显式双通道；默认保留 OpenRouter，Cloudflare 配置缺失不回退或扣错账户。
- [ ] G3: 接入双语补齐及 Container，传递限定用途凭证；测试 URL、请求参数、配置失败与原路径兼容。
- [ ] G4: 迭代预览：定向测试、类型检查及有限 smoke test；无 UI 改动，无全量历史重跑。
- [ ] G5: Dockerfile 检查：确认新 Python 模块进入镜像，不改变基础运行环境。
- [ ] G6: 注册发布：记录试验与余额/权限阻碍；仅在真实请求验证通过且部署条件具备时启用云端新通道。

## 上轮双语完整性修复执行计划

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
