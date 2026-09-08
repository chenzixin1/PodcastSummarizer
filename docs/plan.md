# PodSum 修复、上线与完整自测执行计划

## 我的转换任务（2026-09-08）

保持现有 Next.js / Cloudflare 架构和纸张风格；仅展示当前用户的 URL / MCP 转换记录，不启动或重试任务。
- [x] J1 扩展 `GET /api/watchless/jobs`：兼容数组字段，添加有界分页和状态过滤，强制所有者约束及 private no-store。
- [x] J2 新增 `/watchless/jobs`：加载、登录、错误、空态、分页、阶段、失败原因、积分及详情/文章链接；首页和详情页提供入口。
- [x] J3 迭代预览：94 套 / 797 项测试、类型检查、生产构建通过；桌面手机样例布局无溢出，生产匿名访问需登录。
- [x] J4 Dockerfile 检查：纯页面/API 变更，部署跳过容器；上一轮六小时时长仍未发布。
- [x] J5 注册发布：Worker `62768beb-8d31-43b3-b379-d02adf633a59`；生产页面可达，匿名列表接口 401；27/27 缓存回读验证。

## Watchless 六小时时长上限（2026-09-08）

仅修改 URL 转换视频的时长准入，不自动重试失败任务，不改变积分、文件大小或请求预算。
- [x] D1 修改 runtime 时长校验为 1–21600 秒（含边界），区分无效元数据和超限错误。
- [x] D2 迭代预览：边界与异常值单测、Python 回归；amd64 执行镜像内 14/14 通过，不调用付费模型。
- [x] D3 Dockerfile 检查：校验模块进入 amd64 镜像且导入、HTTP 测试通过。
- [ ] D4 注册发布：镜像构建成功，但 registry 登录被本机缺失 `docker-credential-desktop` 阻断；新转换镜像未上线，需修复 Docker 凭据助手后继续。不声称生产支持六小时。

## 当前执行：细分标签修复（2026-09-08）

详见 `docs/topic-specificity-repair-plan.md`。不调用模型、不重跑视频或全文、不改积分。
- [x] T1 共享提取：完整内容证据、英文词边界、具体主题排序和 FDE/招聘/交付别名。
- [x] T2 URL / MCP 发布与完整分析保存统一持久化标签及筛选关系。
- [x] T3 历史标签只读预览、备份、带源版本保护的回填；41/41 成功且首页缓存刷新。
- [x] T4 测试、类型检查、七项代码审查；91 套 / 786 项通过。
- [x] T5 迭代预览：首页桌面/手机、封面跳转及收藏刷新保留实测；匿名筛选保持私有条目不可见，登录浏览器断连限制见 review。
- [x] T6 Dockerfile 检查：沿用现有视频容器。
- [x] T7 注册发布：Worker `2ff6ab3a-7e54-4cb4-ac31-a77d3ff0819d`；41 篇生产回读均有标签和关系，原文/分析/积分/请求记录哈希不变。

## Full Text 阅读强调恢复（2026-09-06）

用户要求恢复普通全文、词汇提示全文及 Watchless 正文的关键词提亮加粗，两个子代理分别处理此任务与授权补试。
- [x] H1 核对历史阅读强调逻辑，建立共享的非改写强调层；保留原有加粗和全文字符，限制强调密度。
- [x] H2 接入普通与 Watchless 的中文/英文/中英对照/词汇提示；保护生词释义、自动发音与原有字体风格。
- [x] H3 迭代预览：88套762项、类型和生产构建通过；桌面手机、明暗主题四种模式及释义/发音调用实测。
- [x] H4 Dockerfile检查：仅呈现层，视频容器不变。
- [x] H5 注册发布：Worker d0faa1c7-0473-4e9d-9a45-ac5e930274f3；30张关键帧200。主代理独立复核生产桌面/手机截图，详见docs/reading-emphasis-repair.md。

## 四段一次性授权补试（2026-09-06）

用户确认 go：仅 140ek7gjjoe / byv311hdohe / krboguz54vw / kwhgfwostoq 当前失败段各一次。保留所有历史计数；不授权其他失败段或33/34预算暂停文章扩额。
- [x] A1 D1一次性授权表绑定run/part/next attempt；原子保留与并发约束，默认预算不变。迁移前后265条请求完整字段哈希一致，外键检查通过。
- [x] A2 调度仅在未消费授权存在时恢复，失败后不自动再补；保留原文、分段和模型。
- [x] A3 迭代预览：授权消费、重复提交、过期/错误段、非空历史迁移测试及类型构建通过；主代理独立安全复核通过。
- [x] A4 Dockerfile检查：容器不变。
- [x] A5 注册发布：精确4次全部消费，3个卡段成功，kwh第4次内容残缺而暂停、无第5次。成功3篇后续继续原预算，不声称整篇完成。31个既有对象/27个成功段/原文/积分不变，mny未扩额。详见docs/watchless-authorized-retry-report.md。

## 格式暂停修复（2026-09-06）

- [x] P1 无损兼容模型超过12条的完整双语要点：合并相邻要点，不删文字、不补译文、不放宽MCP校验。
- [x] P2 已付费拒绝输出重新校验后才允许格式暂停续跑；失败原始输出通过 Workflow 独立存储步骤保留，历史次数不清零。
- [x] P3 迭代预览：87套747项测试、类型检查、OpenNext生产构建通过，无UI变更。
- [x] P4 Dockerfile检查：容器镜像指纹不变。
- [x] P5 注册发布：Worker `4cc1223d-ce3e-47f2-87b6-a19a534cd4ed`已部署，提交`58cbce2`；3篇卡点已恢复且各自该段新增模型请求为0，已继续剩余部分；其余4篇残缺/未留存结果继续暂停，不扩额。原文指纹和积分不变。不是七篇全部完成。

## 当前执行：其余历史文章有界续跑（2026-09-06）

用户要求“其他也重跑”。仅续跑未完成分析，不重做原文、图文、视频或转录，不重复扣转换积分；保留每段3次、整篇额外10次与全站3个请求租约。

- [x] B1 只读盘点：41篇发布记录，25篇完整分析跳过；16篇未完成，其中3篇双语原文不完整，暂不改动原文。
- [x] B2 扩展 `wrangler.jsonc` 指定名单至13篇双语完整的未完成文章，保持全局开关 false；部署同一已验证产物，仅更改配置。Worker `70ec9f7c-52ae-4800-981f-9c4327eb7d73`，主分支工作提交 `64b6108`，发布工作树 `bb95fea`。
- [x] B3 通过 operator enqueue 入口逐篇备份并提交，13/13已登记。导入历史缓存和预算；永久错误或额度用尽停止，不自动扩额。运行证据 `output/bulk-recovery-enqueue.jsonl`。
- [ ] B4 迭代预览：回读任务进度、摘要与原文指纹，记录完成/暂停数量，不将已提交当成已完成。
- [x] B5 Dockerfile 检查：没有视频执行或镜像改动，复用现有镜像。
- [ ] B6 注册发布：记录生产版本与逐篇结果；保留原有完整文章和积分，不批量重建其他产物。

## 当前执行：Watchless 分段续跑（2026-09-06）

用户已批准实现与上线；仅恢复 `watchless-veizk1m7v7e`，不批量重跑，不再收取 1000 积分。

- [x] R1 页面容错：分离读取错误和后台分析错误，已有各视图可读；增加进度、尝试次数、暂停原因和续跑入口。
- [x] R2 持久化：新增 D1 运行/分段/请求记录与原子预算、并发租约；导入旧缓存和尝试，不改变原文/模型/提示词/分段。
- [x] R3 执行链：独立分析 Workflow，逐段步骤、显式退避、存储恢复及最终幂等提交；每段最多3次，整篇额外10次，费用不确定请求也计数。
- [x] R4 接口兼容：查询、用户续跑、URL/MCP发布和修复入口统一调度；新旧执行互斥，默认关闭，指定文章灰度。
- [x] R5 自动回归与故障注入：权限、重复提交、预算并发、超时/限流/格式、存储中断、迟到响应、最终提交失败、页面仍可读。
- [x] R6 迭代预览：1440×960 / 390×844 真实浏览器；全量测试、类型、构建和安全复核。
- [x] R7 Dockerfile 检查：视频 Container 不变，仅新增 Worker Workflow 与 D1 状态。
- [x] R8 注册发布：干净发布、迁移和默认关闭的新执行链；只启用目标文章，导入19段并续跑至30/30；原文/图文/19段缓存指纹与积分流水不变。本次13次请求（11成功、1超时不确定、1格式失败），全篇含历史额外8/10；详见 docs/watchless-recovery-20260906.md。
- [x] R9 迭代预览与注册发布：视觉验收发现完整脑图节点过多，超过60节点默认收起详情，点击节点重新布局；保留所有节点，复测桌面/手机，增量发布纯前端修复，不重跑模型。Worker 0e4e517b-52b9-4920-8faf-caed9bc8f337。

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
