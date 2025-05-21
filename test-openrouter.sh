#!/bin/bash
# 测试 OpenRouter API 连接
# 用法: ./test-openrouter.sh YOUR_API_KEY

if [ "$#" -ne 1 ]; then
    echo "错误：请提供 OpenRouter API 密钥"
    echo "用法: ./test-openrouter.sh YOUR_API_KEY"
    exit 1
fi

API_KEY="$1"
echo "开始测试 OpenRouter API 连接..."
echo "使用的 API Key 前缀: ${API_KEY:0:8}..."

curl -s https://openrouter.ai/api/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $API_KEY" \
  -H "HTTP-Referer: http://localhost:3000" \
  -H "X-Title: PodSum.cc Curl Test" \
  -d '{
    "model": "meta-llama/llama-2-70b-chat",
    "messages": [
      {
        "role": "user",
        "content": "你好，这是 API 测试。请简短回复。"
      }
    ],
    "temperature": 0.7,
    "max_tokens": 50
  }' | jq

if [ $? -eq 0 ]; then
  echo "测试完成。如果结果显示正确，则 API 连接成功！"
else
  echo "测试失败，可能 jq 未安装。尝试不使用 jq 的版本..."
  curl -s https://openrouter.ai/api/v1/chat/completions \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $API_KEY" \
    -H "HTTP-Referer: http://localhost:3000" \
    -H "X-Title: PodSum.cc Curl Test" \
    -d '{
      "model": "meta-llama/llama-2-70b-chat",
      "messages": [
        {
          "role": "user",
          "content": "你好，这是 API 测试。请简短回复。"
        }
      ],
      "temperature": 0.7,
      "max_tokens": 50
    }'
fi 