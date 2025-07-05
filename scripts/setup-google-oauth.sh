#!/bin/bash

# Google OAuth 设置脚本
# 此脚本帮助设置 Google OAuth 环境变量

echo "🚀 Google OAuth 设置助手"
echo "========================"
echo

# 检查是否存在 .env.local 文件
if [ ! -f ".env.local" ]; then
    echo "📝 创建 .env.local 文件..."
    touch .env.local
fi

echo "请按照以下步骤配置 Google OAuth："
echo

echo "1. 访问 Google Cloud Console: https://console.cloud.google.com/"
echo "2. 创建新项目或选择现有项目"
echo "3. 启用 Google OAuth2 API"
echo "4. 配置 OAuth 同意屏幕"
echo "5. 创建 OAuth 2.0 客户端 ID"
echo "6. 添加回调 URL: http://localhost:3000/api/auth/callback/google"
echo

# 获取用户输入
read -p "请输入 Google Client ID: " GOOGLE_CLIENT_ID
read -p "请输入 Google Client Secret: " GOOGLE_CLIENT_SECRET

# 生成随机的 NEXTAUTH_SECRET
NEXTAUTH_SECRET=$(openssl rand -base64 32)

echo
echo "📝 更新环境变量..."

# 检查并更新环境变量
if grep -q "GOOGLE_CLIENT_ID" .env.local; then
    sed -i.bak "s/GOOGLE_CLIENT_ID=.*/GOOGLE_CLIENT_ID=$GOOGLE_CLIENT_ID/" .env.local
else
    echo "GOOGLE_CLIENT_ID=$GOOGLE_CLIENT_ID" >> .env.local
fi

if grep -q "GOOGLE_CLIENT_SECRET" .env.local; then
    sed -i.bak "s/GOOGLE_CLIENT_SECRET=.*/GOOGLE_CLIENT_SECRET=$GOOGLE_CLIENT_SECRET/" .env.local
else
    echo "GOOGLE_CLIENT_SECRET=$GOOGLE_CLIENT_SECRET" >> .env.local
fi

if grep -q "NEXTAUTH_URL" .env.local; then
    sed -i.bak "s/NEXTAUTH_URL=.*/NEXTAUTH_URL=http:\/\/localhost:3000/" .env.local
else
    echo "NEXTAUTH_URL=http://localhost:3000" >> .env.local
fi

if grep -q "NEXTAUTH_SECRET" .env.local; then
    sed -i.bak "s/NEXTAUTH_SECRET=.*/NEXTAUTH_SECRET=$NEXTAUTH_SECRET/" .env.local
else
    echo "NEXTAUTH_SECRET=$NEXTAUTH_SECRET" >> .env.local
fi

# 清理备份文件
rm -f .env.local.bak

echo "✅ 环境变量已设置完成！"
echo
echo "现在你可以："
echo "1. 重启开发服务器: npm run dev"
echo "2. 访问登录页面: http://localhost:3000/auth/signin"
echo "3. 使用 Google 账户登录"
echo
echo "📖 更多详细信息请查看 GOOGLE_OAUTH_SETUP.md" 