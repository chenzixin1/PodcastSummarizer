# PodSum Watchless 可恢复转换链路执行计划

**Goal:** 修复 Watchless 生产转换失败，让过程产物可持久保存、可诊断、可恢复，并用 3 分钟视频完成一次真实生产转换。
**模板:** 现有 Next.js + Cloudflare Worker / Workflow / Container / D1 / R2 项目
**needs_dw:** false
**needs_db:** true

---

- [x] **Task 1: 生产故障与产物链路取证**

  **Files:**
  - Inspect: `workers/watchlessRuntime.ts`
  - Inspect: `containers/watchless-runtime/app.py`
  - Inspect: `lib/watchless/jobs.ts`

  **Step 1:** 查询长视频新任务、Workflow、Container 日志、D1 事件和 R2 资产，确定真实失败阶段及当前保存边界。

  **Step 2: 验证**

  用任务状态、事件、日志与对象列表相互印证，不以页面文案代替后端证据。

- [x] **Task 2: 过程产物持久化与断点诊断**

  **Files:**
  - Modify: `containers/watchless-runtime/app.py`
  - Modify: `workers/watchlessRuntime.ts`
  - Modify: `lib/watchless/jobs.ts`
  - Modify/Create: `migrations/d1/*.sql`

  **Step 1:** 在下载元数据、音频准备、原话转录、结构化场景、关键帧、文章与 PDF 等阶段完成后，把可复用中间产物上传 R2，并记录资产类型、大小、校验值和阶段事件。

  **Step 2:** 对失败任务保留最后成功阶段、已保存产物和可诊断错误；回调采用幂等写入，避免重复上传或重复扣费。

  **Step 3: 验证**

  单元测试覆盖成功、失败、重复回调、部分产物和超时场景；Python 编译与类型检查通过。

- [x] **Task 3: 转换详情页补充过程产物与恢复信息**

  **Files:**
  - Modify: `app/watchless/jobs/[id]/page.tsx`
  - Modify: `app/api/watchless/jobs/[id]/route.ts`

  **Step 1:** 展示每个阶段的真实状态、时间和已保存过程产物，失败时说明哪些结果仍被保留及能否继续。

  **Step 2: 验证**

  在桌面与手机尺寸检查运行中、部分失败和成功三种状态，无横向溢出且键盘可访问。

- [x] **Task 4: 自动化与本地端到端验证**

  **Files:**
  - Modify/Create: `__tests__/**`

  **Step 1:** 运行定向 Jest、ESLint、TypeScript、Python 编译和生产构建。

  **Step 2:** 用模拟回调验证 R2 上传、D1 事件与最终发布逻辑完整闭环。

- [x] **Task 5: 迭代预览**

  **Files:**
  - Verify: `app/watchless/jobs/[id]/page.tsx`

  **Step 1:** 启动现有应用本地预览，检查详情页和 API 数据；本项目沿用既有 Cloudflare 架构，不迁移到 AnyDev。

  **Step 2: 验证**

  桌面和手机视口通过真实浏览器回读，页面与接口一致。

- [x] **Task 5.5: 生产失败任务可恢复重跑**

  **Files:**
  - Modify: `containers/watchless-runtime/app.py`
  - Modify: `lib/watchless/jobs.ts`
  - Create: `app/api/watchless/jobs/[id]/retry/route.ts`
  - Modify: `app/watchless/jobs/[id]/page.tsx`

  **Step 1:** 根据 OpenRouter 官方模型目录校验 Luna 参数能力，移除不兼容的 `temperature`，并记录脱敏错误摘要。

  **Step 2:** 同一失败 URL 任务可重新运行，不占用新的每日提交名额；重新校验 1000 积分，保留现有过程产物，并启动唯一 Workflow 尝试。

  **Step 3: 验证**

  部署后在原 3 分钟任务上完成重跑。

- [x] **Task 6: Dockerfile 检查/生成**

  **Files:**
  - Verify/Modify: `containers/watchless-runtime/Dockerfile`
  - Verify: `wrangler.jsonc`

  **Step 1:** 验证 Container 可在 `linux/amd64` 构建，依赖和非 root 运行配置保持可复现。

  **Step 2: 验证**

  本地镜像构建与健康检查通过。

- [ ] **Task 7: 注册发布**

  **Files:**
  - Deploy: `migrations/d1/*.sql`
  - Deploy: Cloudflare Worker / Workflow / Container

  **Step 1:** 通过项目现有 Wrangler 发布链路部署，核对 Worker 版本、Container 镜像和健康状态。

  **Step 2:** 在生产站提交 `https://www.youtube.com/watch?v=k9V45BFeNeU`，持续追踪到转换成功，核对过程产物、积分结算、首页条目与完整图文页面。

  **Step 3:** 推送 GitHub `main`，生产与仓库提交保持一致，并把 page-deliver state 标记完成。
