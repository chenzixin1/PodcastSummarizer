# 🔧 环境变量配置指南

## 概述
本项目使用环境变量来配置数据库连接、API keys 和其他敏感信息。

## ✅ 正确的配置方式

### 1. 创建 `.env.local` 文件
```bash
# 在项目根目录创建 .env.local 文件
touch .env.local
```

### 2. 添加必需的环境变量
```bash
# .env.local 文件内容示例

# ========== API 配置 ==========
OPENROUTER_API_KEY=your_openrouter_api_key_here
BLOB_READ_WRITE_TOKEN=your_vercel_blob_token_here

# ========== 数据库配置 (Neon PostgreSQL) ==========
POSTGRES_URL=postgres://REDACTED:REDACTED@REDACTED
POSTGRES_PRISMA_URL=postgres://REDACTED:REDACTED@REDACTED
POSTGRES_URL_NON_POOLING=postgres://REDACTED:REDACTED@REDACTED
POSTGRES_USER=your_db_user
POSTGRES_HOST=your_db_host
POSTGRES_PASSWORD=your_db_password
POSTGRES_DATABASE=your_db_name

# ========== 可选配置 (有默认值) ==========
OPENROUTER_MODEL=google/gemini-2.5-flash
MAX_CONTENT_LENGTH=300000
SUMMARY_CHUNK_LENGTH=80000
TRANSLATION_CHUNK_BLOCKS=120
HIGHLIGHTS_CHUNK_BLOCKS=120
MAX_SUMMARY_TOKENS=8000
MAX_TRANSLATION_TOKENS=16000
MAX_HIGHLIGHTS_TOKENS=12000
MAX_RETRIES=2
RETRY_DELAY=1000
```

## 🔒 安全最佳实践

### ✅ 应该做的
- **使用 `.env.local`**: 标准的 Next.js 环境变量文件
- **添加到 .gitignore**: 确保不会被提交到版本控制
- **不同环境使用不同配置**: 开发/生产环境分离
- **定期轮换 API keys**: 提高安全性

### ❌ 不应该做的
- **不要创建多个环境文件**: 避免 `postgres_config.txt`, `new_env.local` 等冗余文件
- **不要硬编码敏感信息**: 避免在代码中直接写入密钥
- **不要提交到 git**: 确保 `.env*` 在 .gitignore 中
- **不要在日志中输出**: 避免意外泄露

## 🛠️ 环境验证工具

### 快速验证配置
```bash
# 验证数据库连接
node scripts/testing/test-db-connection.mjs

# 验证 API 连接
node scripts/testing/simple-openrouter-test.mjs

# 查看当前环境变量 (安全方式)
node -e "console.log('OPENROUTER_MODEL:', process.env.OPENROUTER_MODEL || 'Not set')"
```

### 配置检查脚本
```bash
# 运行完整的环境检查
./scripts/test.sh status
```

## 📁 文件组织

### ✅ 推荐的文件结构
```
项目根目录/
├── .env.local              # ✅ 主要环境变量文件 (被 gitignore)
├── .env.example             # ✅ 示例文件 (可选，可提交)
├── .gitignore               # ✅ 包含 .env* 规则
└── ENVIRONMENT_SETUP.md     # ✅ 本文档
```

### ❌ 应该避免的文件
```
❌ postgres_config.txt       # 冗余且可能被提交
❌ new_env.local            # 命名不标准
❌ config.txt               # 不明确的配置文件
❌ .env                     # 容易被误提交
```

## 🚀 快速开始

### 1. 复制现有配置 (如果存在)
```bash
# 如果你有旧的配置文件，复制到 .env.local
cp old_config_file .env.local
```

### 2. 验证配置
```bash
# 验证数据库
node scripts/testing/test-db-connection.mjs

# 验证 API
node scripts/testing/simple-openrouter-test.mjs
```

### 3. 运行项目
```bash
npm run dev
```

## 🔧 故障排除

### 常见问题

#### 1. 数据库连接失败
```bash
# 检查数据库配置
node scripts/testing/test-db-connection.mjs

# 常见问题：
# - POSTGRES_URL 格式错误
# - 密码包含特殊字符需要编码
# - SSL 配置问题
```

#### 2. API 调用失败  
```bash
# 检查 API 配置
node scripts/testing/simple-openrouter-test.mjs

# 常见问题：
# - OPENROUTER_API_KEY 无效或过期
# - API 配额耗尽
# - 网络连接问题
```

#### 3. 环境变量未加载
```bash
# 确认文件名正确
ls -la .env*

# 确认文件被 Next.js 识别
node -e "console.log('NODE_ENV:', process.env.NODE_ENV)"
```

## 📋 迁移指南

### 从旧配置文件迁移

如果你之前使用了 `postgres_config.txt` 或其他配置文件：

1. **备份旧配置**:
   ```bash
   cp postgres_config.txt postgres_config.txt.backup
   ```

2. **迁移到 .env.local**:
   ```bash
   # 手动复制配置内容到 .env.local
   # 或使用脚本自动迁移
   ```

3. **验证新配置**:
   ```bash
   ./scripts/test.sh status
   ```

4. **删除旧文件**:
   ```bash
   rm postgres_config.txt new_env.local
   ```

## 🌍 部署配置

### Vercel 部署
在 Vercel 控制台中设置环境变量，而不是依赖 `.env.local` 文件。

### 其他平台
根据平台文档设置环境变量，通常通过：
- 控制台界面
- CLI 命令
- 配置文件 (平台特定)

---

**📅 最后更新**: 2024年12月  
**🔗 相关文档**: 
- [Next.js 环境变量文档](https://nextjs.org/docs/basic-features/environment-variables)
- [项目主文档](README.md)
- [测试脚本说明](scripts/README.md)
