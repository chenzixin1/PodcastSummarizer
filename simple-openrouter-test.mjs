// 简单的 OpenRouter API 测试
// 参考：https://openrouter.ai/docs/quickstart
import fetch from 'node-fetch';

async function testOpenRouter() {
  // 如果用户提供了命令行参数，使用它作为 API key
  const apiKey = process.argv[2];
  
  if (!apiKey) {
    console.error('请提供 OpenRouter API 密钥作为命令行参数');
    console.error('用法: node simple-openrouter-test.mjs YOUR_API_KEY');
    process.exit(1);
  }

  console.log('开始测试 OpenRouter API 连接...');
  console.log(`使用的 API Key 前缀: ${apiKey.substring(0, 8)}...`);

  try {
    // 模型选择一个更小的模型以减少成本
    const model = 'google/gemini-1.5-flash';
    console.log(`使用模型: ${model}`);

    // 创建请求
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'HTTP-Referer': 'http://localhost:3000',
        'X-Title': 'PodSum.cc Simple Test'
      },
      body: JSON.stringify({
        model: model,
        messages: [
          {
            role: 'user',
            content: '你好，这是 API 连接测试，请回复"API 连接正常"。'
          }
        ],
        temperature: 0.7,
        max_tokens: 50  // 限制 token 以控制成本
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`API 错误: ${response.status} ${errorText}`);
      return;
    }

    const data = await response.json();
    console.log('连接成功！✅');
    console.log('-------------------');
    console.log('回复内容:', data.choices[0].message.content);
    console.log('-------------------');
    
    if (data.usage) {
      console.log('Token 使用情况:', JSON.stringify(data.usage, null, 2));
    }
    
    console.log('完整 API 响应保存到 openrouter-response.json');
    const fs = await import('fs');
    fs.writeFileSync('openrouter-response.json', JSON.stringify(data, null, 2));
    
  } catch (error) {
    console.error('请求出错:', error);
  }
}

// 运行测试
testOpenRouter(); 