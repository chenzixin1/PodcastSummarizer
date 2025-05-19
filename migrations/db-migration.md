# PodSum.cc 数据存储迁移

本文档记录了PodSum.cc从客户端localStorage存储迁移到Neon PostgreSQL数据库的过程。

## 迁移概述

这次迁移的主要目标是将数据从客户端浏览器存储转移到服务器端数据库，解决以下问题：

1. 数据持久化 - 避免用户清理浏览器缓存导致数据丢失
2. 跨设备访问 - 允许用户在不同设备上访问自己的内容
3. 数据共享功能 - 支持内容公开共享，允许用户分享分析结果
4. 数据安全性 - 提高数据安全性和备份能力

## 技术栈

- **数据库**: Neon PostgreSQL (serverless) - 通过Vercel集成
- **ORM**: @vercel/postgres - Vercel官方PostgreSQL客户端
- **部署**: Vercel Edge Functions

## 数据库结构

### podcasts 表

存储上传的播客信息：

```sql
CREATE TABLE IF NOT EXISTS podcasts (
  id VARCHAR(36) PRIMARY KEY,
  title VARCHAR(255) NOT NULL,
  original_filename VARCHAR(255) NOT NULL,
  file_size VARCHAR(50) NOT NULL,
  blob_url TEXT,
  is_public BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
)
```

### analysis_results 表

存储AI分析结果：

```sql
CREATE TABLE IF NOT EXISTS analysis_results (
  podcast_id VARCHAR(36) REFERENCES podcasts(id),
  summary TEXT,
  translation TEXT,
  highlights TEXT,
  processed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (podcast_id)
)
```

## 实现的功能

1. **数据库连接与初始化**
   - 创建Vercel与Neon PostgreSQL的连接
   - 自动初始化数据库表
   
2. **上传流程改进**
   - 支持本地存储与数据库双重保存
   - 添加文件公开/私有选项
   
3. **获取播客列表**
   - 支持分页加载
   - 支持公开/私有内容筛选
   - 兼容本地存储内容显示
   
4. **处理和保存分析结果**
   - 分析结果同步保存到数据库
   - 保留客户端流式处理体验

## 兼容性与迁移策略

为确保平滑迁移，系统采用了双写双读策略：

1. **双写**: 数据同时保存到localStorage和数据库
2. **优先读数据库**: 先从数据库读取，再从localStorage读取本地记录
3. **去重**: 确保来自两个来源的记录不会重复显示

这种策略确保了:
- 对于新用户，完全使用数据库存储
- 对于老用户，可以继续访问他们之前的数据
- 系统可以逐步过渡到完全依赖数据库

## 前端适配

1. 上传页面新增"公开"切换选项
2. 历史页面支持分页加载、公开标记
3. 保持用户体验一致性，无需用户手动迁移数据

## 未来计划

1. 添加用户系统，支持登录和授权
2. 开发数据分析功能，提供播客消费统计
3. 添加社区功能，共享高质量的播客分析

## 注意事项

- 环境变量必须包含有效的Neon PostgreSQL连接信息
- 默认数据是私有的，除非用户明确设置为公开
- 老数据将继续保留在localStorage中，不会自动清除 