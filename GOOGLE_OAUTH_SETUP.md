# Google OAuth 设置说明

## 概述

现在系统已经支持 Google OAuth 登录！用户可以使用 Google 账户直接登录，无需单独注册。

## 设置步骤

### 1. 创建 Google Cloud 项目

1. 访问 [Google Cloud Console](https://console.cloud.google.com/)
2. 创建新项目或选择现有项目
3. 启用 Google+ API 和 Google OAuth2 API

### 2. 配置 OAuth 同意屏幕

1. 在 Google Cloud Console 中，转到 "APIs & Services" > "OAuth consent screen"
2. 选择 "External" 用户类型
3. 填写必要信息：
   - 应用名称：`PodSum.cc`
   - 用户支持邮箱：你的邮箱
   - 开发者联系信息：你的邮箱
4. 添加作用域：`email`, `profile`, `openid`
5. 添加测试用户（开发阶段）

### 3. 创建 OAuth 2.0 客户端 ID

1. 转到 "APIs & Services" > "Credentials"
2. 点击 "Create Credentials" > "OAuth 2.0 Client ID"
3. 选择 "Web application"
4. 设置名称：`PodSum.cc Web Client`
5. 添加授权的重定向 URI：
   - 开发环境：`http://localhost:3000/api/auth/callback/google`
   - 生产环境：`https://your-domain.com/api/auth/callback/google`
6. 保存并获取 Client ID 和 Client Secret

### 4. 配置环境变量

在你的 `.env.local` 文件中添加以下配置：

```bash
# NextAuth.js
NEXTAUTH_URL=http://localhost:3000
NEXTAUTH_SECRET=your-secret-key-here

# Google OAuth
GOOGLE_CLIENT_ID=your-google-client-id-here
GOOGLE_CLIENT_SECRET=your-google-client-secret-here

# 其他现有配置...
```

### 5. 重启开发服务器

```bash
npm run dev
```

## 功能特性

### 自动用户创建
- 当用户首次使用 Google 登录时，系统会自动创建用户账户
- 用户信息从 Google 获取（邮箱、姓名）
- 无需额外的注册步骤

### 用户体验
- 登录页面现在显示 Google 登录按钮
- 保留了原有的邮箱密码登录方式
- 清晰的视觉分隔和引导

### 安全性
- 使用 NextAuth.js 的安全实践
- JWT 会话管理
- 自动处理 OAuth 流程

## 测试

1. 访问 `http://localhost:3000/auth/signin`
2. 点击 "Continue with Google" 按钮
3. 完成 Google OAuth 流程
4. 自动重定向到上传页面

## 故障排除

### 常见错误

1. **"Invalid client_id"**
   - 检查 `GOOGLE_CLIENT_ID` 是否正确
   - 确保在 Google Cloud Console 中启用了相应的 API

2. **"Redirect URI mismatch"**
   - 确保在 Google Cloud Console 中添加了正确的回调 URL
   - 开发环境：`http://localhost:3000/api/auth/callback/google`

3. **"Access blocked"**
   - 确保 OAuth 同意屏幕已正确配置
   - 在开发阶段，添加测试用户

### 调试技巧

1. 检查浏览器控制台的错误信息
2. 查看 Next.js 开发服务器的日志
3. 确保所有环境变量都已正确设置

## 生产部署

在生产环境中部署时：

1. 更新 `NEXTAUTH_URL` 为你的域名
2. 在 Google Cloud Console 中添加生产环境的回调 URL
3. 确保 OAuth 同意屏幕已发布（不是测试模式）
4. 生成强随机的 `NEXTAUTH_SECRET`

## 数据库影响

- Google 用户会自动添加到 `users` 表
- `password_hash` 字段对 Google 用户为 NULL
- 用户可以同时拥有 Google 登录和密码登录（如果后续添加密码）

## 下一步

你现在可以：
1. 使用 Google 账户登录测试系统
2. 上传和管理播客文件
3. 享受无需注册的便捷体验

如果需要任何帮助或遇到问题，请参考故障排除部分或联系开发者。 