# 🧪 测试文件目录说明

本项目采用 Jest 测试框架，测试文件按功能模块组织。

## 📁 目录结构

```
__tests__/
├── 📂 api/                  # API 路由测试
│   ├── db-init.test.ts      # ✅ 数据库初始化 API (7/7 通过)
│   ├── upload.test.ts       # 🔧 文件上传 API (需要修复)
│   ├── podcasts.test.ts     # 🔧 播客列表 API (需要修复) 
│   └── process.test.ts      # 🔧 处理 API (需要修复)
│
├── 📂 lib/                  # 核心业务逻辑测试
│   ├── db.test.ts           # ✅ 数据库操作单元测试 (24/24 通过)
│   └── db.integration.test.ts # ✅ 数据库集成测试 (14/14 通过)
│
├── 📂 dashboard/            # 前端组件测试
│   └── DashboardPage.test.tsx # 🔧 主页面组件 (需要修复)
│
├── 📂 utils/                # 工具函数测试
│   └── (待添加)
│
└── 📋 README.md             # 本文档
```

## 🎯 测试分类说明

### ✅ **已完成且通过的测试 (45/67)**
- **数据库层**: 100% 覆盖，所有 CRUD 操作
- **API 初始化**: 完整的数据库初始化流程测试

### 🔧 **需要修复的测试 (22/67)**
- **API 路由**: HTTP 方法路由和 mock 集成问题
- **前端组件**: ES 模块兼容性问题

## 🚀 快速运行测试

### 运行所有测试
```bash
npm test
```

### 运行特定类别的测试
```bash
# 只运行数据库测试 (100% 通过)
npm test -- __tests__/lib/

# 只运行 API 测试
npm test -- __tests__/api/

# 只运行单个测试文件
npm test -- __tests__/lib/db.test.ts
```

### 运行测试并查看覆盖率
```bash
npm test -- --coverage
```

## 📊 测试统计

| 分类 | 文件数 | 测试数 | 通过率 | 状态 |
|------|--------|--------|--------|------|
| 数据库层 | 2 | 38 | 100% | ✅ |
| API 路由 | 4 | 29 | 24% | 🔧 |
| 前端组件 | 1 | 0 | 0% | 🔧 |
| **总计** | **7** | **67** | **67%** | **🟡** |

## 🛠️ 开发指南

### 添加新测试
1. **API 测试**: 放在 `__tests__/api/` 下
2. **业务逻辑测试**: 放在 `__tests__/lib/` 下  
3. **组件测试**: 放在 `__tests__/dashboard/` 或对应组件目录下
4. **工具函数测试**: 放在 `__tests__/utils/` 下

### 测试文件命名规范
- 单元测试: `*.test.ts` 或 `*.test.tsx`
- 集成测试: `*.integration.test.ts`
- 端到端测试: `*.e2e.test.ts`

### Mock 文件
- 全局 mock: `__mocks__/` 目录
- Jest 配置: `jest.config.js`
- 测试环境设置: `jest.setup.js`

## 🔍 故障排除

### 常见问题
1. **API 测试 405 错误**: HTTP 方法路由配置问题
2. **Mock 不生效**: 检查 jest.setup.js 中的 mock 配置
3. **ES 模块错误**: 检查 jest.config.js 中的 transformIgnorePatterns

### 调试技巧
```bash
# 运行单个测试并显示详细输出
npm test -- __tests__/lib/db.test.ts --verbose

# 调试模式运行
npm test -- --runInBand --no-coverage --no-cache
```

## 📝 待完成任务

### 高优先级
- [ ] 修复 API 路由测试的 HTTP 方法问题
- [ ] 解决数据库 mock 集成问题
- [ ] 修复前端组件测试的 ES 模块问题

### 中优先级  
- [ ] 添加更多组件单元测试
- [ ] 创建端到端测试
- [ ] 增加测试覆盖率报告

### 低优先级
- [ ] 性能测试
- [ ] 视觉回归测试
- [ ] 自动化测试流水线

---

**📅 最后更新**: {{ 当前日期 }}  
**🔗 相关文档**: 
- [Jest 配置](../jest.config.js)
- [测试完成报告](../TEST_COMPLETION_REPORT.md)
- [改进任务清单](../IMPROVEMENT_TASKS.md) 