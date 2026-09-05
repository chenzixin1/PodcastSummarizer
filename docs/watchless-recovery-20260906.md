# Watchless 分段恢复交付记录

## 范围与上线顺序

仅灰度恢复 `watchless-veizk1m7v7e`。模型、提示词 version 1、原文指纹、现有分段不变；不调用转换入口，不扣转换积分。先迁移 D1，再发布默认关闭的 Workflow，最后启用单篇 allowlist。普通播客仍使用原队列。

## 持久状态与请求边界

- `watchless_analysis_runs/parts/attempts` 分别保存版本、进度和每一次已预留请求；缓存沿用原始模型/原文 hash。初始化导入全部历史记录后才允许新请求。
- 每段最多 3 次、整篇首次外最多 10 次；超时/网络结果不确定请求同样计数，并等待 180 秒租约到期。模型超时 120 秒，HTTP 408/429/5xx 有界重试，429 尊重 Retry-After；永久错误暂停，格式错误最多补试一次。
- D1 原子触发器约束新旧执行链与全站最多 3 个在途分析请求；取消是终态，旧 enqueue 不得清空 workflow 状态或预算。
- 模型步骤禁用 Workflow 隐式重试。模型结果首先返回为 Workflow 持久步骤输出，另一个仅存储步骤写 R2，再确认 D1。存储重试最多 100 次；若仍失败，标记 RESULT_PENDING，禁止普通继续重新调用模型，需恢复该保存步骤。
- 所有成功段复用；最终写入失败只重新提交，不请求模型。已提供且通过严格校验的 MCP 完整分析直接保存。
- 灰度关闭后不会退回旧执行器；回滚保留 D1/R2 和预算，先关闭调度。旧 Worker 二进制可能不识别 executor，不能在存在活动分析时直接回滚到引入隔离前的版本。

## 验证

故障注入覆盖预留请求后中断、模型已返回、R2 已保存但 D1 未确认、最后提交失败；验证匿名/非所有者拒绝、重复 force 保留进度、取消后状态/结果不可复活、格式上限、429、网络不确定租约、全站并发和额外预算。另有独立只读安全复核。

迁移前：原文 SHA256 `cfc70b33316ebaa491715d11b24939767c3bf4ab615c0691c0c37e416bb1729f`；30 场景；zh/en/bilingual/hint 四种模式；用户积分 7966，积分流水 31 条。恢复前后只读核对。

页面容错已先发布：主源码 `60a8a04`；Worker `d384dd4d-fa5f-4738-8a2f-b8f0e531b8b9`。桌面真实浏览器确认 19/30 暂停提示下 Full Text 仍可读。

后端发布、实际请求数和最终验收记录在恢复执行后补充；不得将本文件当作已完成 30/30 的证明。

迁移兼容：Wrangler migrations apply 的远程 query 路径报 incomplete input，读回确认事务回滚、未部分落库。使用 `wrangler d1 execute --remote --file` 的事务式导入路径成功执行 0010，核对 12 个表/索引/触发器后登记 d1_migrations。0011 为已有数据库补齐删除级联触发器，避免恢复状态阻止正常删除播客。

最终自动回归：87 套 / 743 项通过，TypeScript 与 OpenNext 生产构建通过。独立安全复核补齐跨 generation 请求结算，0012 保留历史 request workflow_id 并由当前 run owner 做结算 CAS。手机实际切换上方全文及下方阅读器的四种模式通过；390px 页面 scrollWidth=390。

默认关闭版：Worker `ef6a851a-4c24-448c-a5c6-ee62fbfe9db2`。单篇灰度版：主源码 `9ba3df7`（运行代码 `f009974`），干净发布 checkout `f1e60cb`；Worker `1f974e0a-1faa-4e2b-80da-eb99d22e0dcc`。Container 镜像摘要保持 `sha256:9445ded02ed08ebc8f34d43739ee1dd5520be8036734d3d0467ff27746be2064`。内部和用户处理接口匿名请求均返回 401。

已在上述灰度发布完成后，首次提交目标文章恢复。运维边界：运行中的播客若需删除，先取消并等 180 秒租约结束；运行中删除入口的进一步保护在 #18 跟踪。

## 最终生产验收

- D1 run `df2373f40c1a1c353e8deb3a61bec498905671059db2e8e129c65cb9f44e39f0` 已 completed，30/30 parts completed。
- generation 1 导入全部历史记录后从第20段续跑。第30段首次请求120秒超时，随后 Cloudflare 返回 WorkflowInternalError；持久状态安全停在29/30。等租约到期后显式恢复到 generation 2，预算未重置。第二次响应格式不合格，退避后第三次成功，自动完成最终提交。
- 本次新请求13次：11成功、1超时不确定、1格式失败。旧记录25次：19成功、5格式失败、1超时不确定。合计38次，全篇额外8/10，每段均≤3。前19段新增模型请求 **0**。
- `analysis_kind=full`，双语摘要30节；中文22424字符、英文68034字符；中英文脑图均已保存，网页真实渲染可用。
- 原文SHA256仍为 `cfc70b33316ebaa491715d11b24939767c3bf4ab615c0691c0c37e416bb1729f`；文章文件SHA256仍为 `9621b957a3f49eaee491305f31e8c84235e16ef6251afa9364de2efdfdf06596`；19份原分析缓存逐文件hash全部一致。
- 积分7966→7966，流水31→31；未重复扣1000转换积分。模型超时请求已计数，不声称上游未计费。
- 生产桌面/手机验证完成：失败提示消失，完整摘要、脑图、原文和图文可读；四种阅读模式保留；390px无横向页面溢出。
- 截图：`output/playwright/recovery-complete-summary-desktop.png`、`recovery-complete-mindmap-desktop.png`、`recovery-complete-bilingual-mobile.png`；只读比较记录在 `output/recovery-audit-before.json` / `recovery-audit-after.json`。
- 没有批量恢复其他历史文章。PR #21 仍保持草稿，因为项目级历史回填验收由 #18 单独跟踪。
