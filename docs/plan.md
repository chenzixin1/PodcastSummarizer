# PodSum Watchless 转换详情页执行计划

目标：定位生产任务 `wl_e0wUkXU4mtBlxWTv8t` 的超时原因，并在不泄露内部密钥或基础设施细节的前提下，把 Watchless 转换页升级为可追踪、可解释、可恢复的任务详情页。

- 项目：现有 Next.js + Cloudflare Workers / Workflows / Containers / D1 应用
- 视觉：延续 PodSum 暖纸张、安静知识工作台风格
- 数据仓库：否
- 应用数据库：是（Cloudflare D1）

## 任务

- [x] 生产故障取证：核对 D1 任务记录、Workflow 步骤、Container 状态和超时边界，给出可验证的失败位置。
- [x] 状态数据完善：向任务接口安全暴露标题、模型、错误码、创建/开始/结束时间，并记录后续任务的阶段事件。
- [x] 详情页改造：增加阶段时间线、真实进度、耗时、来源、模型、积分退款说明、失败解释和下一步操作。
- [x] 自动化验证：补充状态序列化、阶段事件和错误展示测试，运行类型检查与生产构建。
- [x] 迭代预览：在本地桌面和手机尺寸检查真实滚动、可访问性、刷新轮询与失败态。
- [x] Dockerfile 检查/生成：检查现有 Watchless Container Dockerfile 与 Worker 配置，不覆盖已在生产使用的镜像方案。
- [x] 注册发布：通过现有 Cloudflare 发布链路部署，并对生产任务 URL 做页面与 API 回读验证。

> 本项目已有正式 Cloudflare 架构，因此“注册发布”沿用 Wrangler/Cloudflare，不另行迁移到 AnyDev。
