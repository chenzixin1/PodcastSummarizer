// 测试 OpenRouter API 连接
// 参考：https://openrouter.ai/docs/quickstart

import { config } from 'dotenv';
import fs from 'fs';
import fetch from 'node-fetch';

// 读取 .env.local 文件
async function loadEnv() {
  try {
    // 检查 .env.local 是否存在
    if (fs.existsSync('.env.local')) {
      console.log('找到 .env.local 文件');
      config({ path: '.env.local' });
    } else {
      console.log('没有找到 .env.local 文件');
      return false;
    }

    return true;
  } catch (error) {
    console.error('读取环境变量出错:', error);
    return false;
  }
}

async function testOpenRouter() {
  console.log('开始测试 OpenRouter API 连接...');
  
  // 加载环境变量
  const envLoaded = await loadEnv();
  if (!envLoaded) {
    console.error('环境变量加载失败');
    return;
  }

  // 获取 API key
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    console.error('错误：未找到 OPENROUTER_API_KEY 环境变量');
    return;
  }

  console.log(`使用的 API Key 前缀: ${apiKey.substring(0, 5)}...`);

  try {
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'HTTP-Referer': 'http://localhost:3000',
        'X-Title': 'PodSum.cc Test'
      },
      body: JSON.stringify({
        model: 'google/gemini-1.5-flash',
        messages: [
          {
            role: 'user',
            content: '你好，这是一个 API 连接测试。请简单回复。'
          }
        ],
        temperature: 0.7,
        max_tokens: 100
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`API 错误: ${response.status} ${errorText}`);
      return;
    }

    const data = await response.json();
    console.log('连接成功！');
    console.log('API 响应:');
    console.log(JSON.stringify(data, null, 2));
    console.log('消息内容:', data.choices[0].message.content);

    if (data.usage) {
      console.log('Token 使用情况:', data.usage);
    }
  } catch (error) {
    console.error('请求出错:', error);
  }
}

// 运行测试
testOpenRouter(); 