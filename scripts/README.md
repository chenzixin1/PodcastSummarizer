# 🛠️ Scripts 目录说明

本目录包含项目的各种脚本和工具，按功能分类组织。

## 📁 目录结构

```
scripts/
├── 📂 testing/              # 测试相关脚本
│   ├── test-openrouter.sh   # OpenRouter API 测试脚本
│   ├── test-openrouter.mjs  # OpenRouter API 连接测试
│   ├── simple-openrouter-test.mjs # 简化版 OpenRouter 测试
│   ├── test-db-connection.mjs # 数据库连接测试
│   └── test-stream.mjs      # 流式处理测试
│
├── 📂 utils/                # 工具脚本
│   └── update-api-key.mjs   # 更新 API Key 工具
│
├── 🧪 test.sh              # 主测试运行脚本 (Jest)
├── 🗃️ init-db.mjs           # 数据库初始化脚本
├── 🗃️ init-db.ts            # 数据库初始化 (TypeScript版)
├── 📡 test-requests.ts      # HTTP 请求测试工具
└── 📋 README.md             # 本文档
```

## 🧪 测试脚本 (testing/)

### 主要测试工具

#### `test.sh` - Jest 测试运行器
```bash
# 最常用的测试脚本
./scripts/test.sh status    # 查看测试状态
./scripts/test.sh working   # 运行通过的测试
./scripts/test.sh db        # 运行数据库测试
./scripts/test.sh help      # 查看所有选项
```

### API 连接测试

#### `testing/test-openrouter.mjs` - OpenRouter API 完整测试
```bash
node scripts/testing/test-openrouter.mjs
```
- ✅ 测试 API 连接
- ✅ 验证 API Key 有效性
- ✅ 测试模型响应
- ✅ 错误处理验证

#### `testing/simple-openrouter-test.mjs` - 简化版 API 测试
```bash
node scripts/testing/simple-openrouter-test.mjs
```
- 🚀 快速 API 连通性检查
- 💡 适合快速验证配置

#### `testing/test-openrouter.sh` - Shell 版本测试
```bash
./scripts/testing/test-openrouter.sh
```
- 🔄 可以在不同环境中运行
- 📝 输出详细的测试日志

### 数据库测试

#### `testing/test-db-connection.mjs` - 数据库连接测试
```bash
node scripts/testing/test-db-connection.mjs
```
- 🗃️ 验证 Postgres 连接
- 🔍 检查数据库配置
- 📊 显示连接状态

### 流式处理测试

#### `testing/test-stream.mjs` - 流式响应测试
```bash
node scripts/testing/test-stream.mjs
```
- 🌊 测试 OpenRouter 流式 API
- 📡 验证实时响应处理
- 🎯 性能和延迟测试

## 🛠️ 工具脚本 (utils/)

#### `utils/update-api-key.mjs` - API Key 管理工具
```bash
node scripts/utils/update-api-key.mjs
```
- 🔑 更新 OpenRouter API Key
- 🔄 批量更新环境变量
- ✅ 验证新 Key 的有效性

## 🗃️ 数据库脚本

#### `init-db.mjs` - 数据库初始化 (推荐)
```bash
npm run db:init
# 或
node scripts/init-db.mjs
```
- 🚀 快速数据库设置
- 🔄 重置数据库结构
- 📝 详细初始化日志

#### `init-db.ts` - TypeScript 版本
```bash
npx ts-node scripts/init-db.ts
```
- 🔧 开发环境使用
- 📘 TypeScript 类型支持

## 📡 HTTP 测试

#### `test-requests.ts` - HTTP 请求测试工具
```bash
npm run test:requests
# 或
npx ts-node scripts/test-requests.ts
```
- 🌐 测试所有 API 端点
- 📊 性能基准测试
- 🔍 错误处理验证

## 🚀 快速开始指南

### 1. 环境验证
```bash
# 检查数据库连接
node scripts/testing/test-db-connection.mjs

# 检查 API 连接
node scripts/testing/simple-openrouter-test.mjs
```

### 2. 运行测试
```bash
# 运行稳定的测试
./scripts/test.sh working

# 查看测试状态
./scripts/test.sh status
```

### 3. 数据库初始化
```bash
npm run db:init
```

## 🔧 开发者指南

### 添加新脚本
1. **测试脚本**: 放在 `testing/` 目录
2. **工具脚本**: 放在 `utils/` 目录  
3. **数据库脚本**: 放在根目录
4. **HTTP测试**: 使用 TypeScript，放在根目录

### 脚本命名规范
- 测试脚本: `test-*.mjs` 或 `test-*.sh`
- 工具脚本: `update-*.mjs` 或 `manage-*.mjs`
- 初始化脚本: `init-*.mjs` 或 `setup-*.mjs`

### 权限设置
```bash
# 给Shell脚本添加执行权限
chmod +x scripts/testing/*.sh
chmod +x scripts/*.sh
```

## 📊 脚本状态

| 脚本 | 状态 | 用途 | 推荐度 |
|------|------|------|--------|
| `test.sh` | ✅ 稳定 | Jest测试运行 | ⭐⭐⭐⭐⭐ |
| `testing/test-openrouter.mjs` | ✅ 稳定 | API连接测试 | ⭐⭐⭐⭐ |
| `testing/test-db-connection.mjs` | ✅ 稳定 | 数据库测试 | ⭐⭐⭐⭐ |
| `init-db.mjs` | ✅ 稳定 | 数据库初始化 | ⭐⭐⭐⭐⭐ |
| `test-requests.ts` | 🟡 开发中 | HTTP测试 | ⭐⭐⭐ |

---

**📅 最后更新**: 2024年12月  
**🔗 相关文档**: 
- [项目主文档](../README.md)
- [测试文档](../__tests__/README.md)
- [改进任务清单](../IMPROVEMENT_TASKS.md) 