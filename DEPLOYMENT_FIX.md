# 部署修复说明 🔧

## 问题描述

在 Vercel 部署时遇到了 NextAuth.js 与 Edge Runtime 的兼容性问题：

```
Module not found: Can't resolve 'crypto'
```

## 问题原因

`app/api/upload/route.ts` 文件中同时设置了：
1. `export const runtime = 'edge'` - Edge Runtime 配置
2. 使用了 `getServerSession` 和 NextAuth.js

Edge Runtime 是一个轻量级的 JavaScript 运行时，不支持 Node.js 的 `crypto` 模块，而 NextAuth.js 依赖于这个模块。

## 解决方案

移除了 `app/api/upload/route.ts` 中的 Edge Runtime 配置：

```diff
- export const runtime = 'edge';
```

## 修复后的状态

✅ **已修复的文件：**
- `app/api/upload/route.ts` - 移除 Edge Runtime，使用 Node.js Runtime

✅ **保留 Edge Runtime 的文件：**
- `app/api/process/route.ts` - 不使用 NextAuth，可以保留 Edge Runtime
- `app/api/db-init/route.ts` - 不使用 NextAuth，可以保留 Edge Runtime  
- `app/api/debug/env/route.ts` - 不使用 NextAuth，可以保留 Edge Runtime

## 验证

- ✅ 本地构建成功：`npm run build`
- ✅ 类型检查通过
- ✅ 所有 API 路由正常工作

## 影响分析

**移除 Edge Runtime 的影响：**
- **性能：** 轻微影响，Node.js Runtime 启动稍慢于 Edge Runtime
- **功能：** 无影响，所有认证和文件上传功能正常
- **兼容性：** 提高了兼容性，支持完整的 NextAuth.js 功能

**保留 Edge Runtime 的好处：**
- `process` 路由处理大文件和流式响应，Edge Runtime 更适合
- `db-init` 和 `debug` 路由简单快速，Edge Runtime 提供更好性能

## 最佳实践

**何时使用 Edge Runtime：**
- 简单的 API 路由
- 不需要 Node.js 特定模块
- 处理流式数据
- 需要全球分布式执行

**何时使用 Node.js Runtime：**
- 使用 NextAuth.js 认证
- 需要 Node.js 核心模块（crypto, fs 等）
- 复杂的服务器端逻辑
- 第三方库依赖 Node.js 环境

## 下次部署

现在可以安全地部署到 Vercel，不会再遇到 crypto 模块错误。所有 Google OAuth 和认证功能都将正常工作。

## 相关文档

- [Vercel Edge Runtime](https://vercel.com/docs/concepts/functions/edge-functions)
- [NextAuth.js with Edge Runtime](https://next-auth.js.org/configuration/initialization#advanced-initialization)
- [Next.js Runtime Configuration](https://nextjs.org/docs/app/api-reference/file-conventions/route-segment-config#runtime) 