// 更新 OpenRouter API 密钥
import fs from 'fs';
import readline from 'readline';

// 创建读取用户输入的接口
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

// 更新 .env.local 中的 API 密钥
async function updateApiKey() {
  console.log('更新 OpenRouter API 密钥');
  
  // 检查 .env.local 是否存在
  if (!fs.existsSync('.env.local')) {
    console.error('错误：.env.local 文件不存在');
    rl.close();
    return;
  }
  
  // 读取当前 .env.local 内容
  const envContent = fs.readFileSync('.env.local', 'utf8');
  
  // 提示用户输入新的 API 密钥
  rl.question('请输入新的 OpenRouter API 密钥 (sk-or-v1-...): ', (newApiKey) => {
    if (!newApiKey.trim()) {
      console.log('操作已取消，未提供 API 密钥');
      rl.close();
      return;
    }
    
    if (!newApiKey.startsWith('sk-or-')) {
      console.log('警告: 输入的密钥可能不是有效的 OpenRouter API 密钥，应以 sk-or- 开头');
      rl.question('是否继续? (y/n): ', (answer) => {
        if (answer.toLowerCase() !== 'y') {
          console.log('操作已取消');
          rl.close();
          return;
        }
        performUpdate(envContent, newApiKey);
      });
    } else {
      performUpdate(envContent, newApiKey);
    }
  });
}

// 执行更新操作
function performUpdate(envContent, newApiKey) {
  try {
    // 替换 API 密钥
    const updatedContent = envContent.replace(
      /OPENROUTER_API_KEY=.*/,
      `OPENROUTER_API_KEY=${newApiKey}`
    );
    
    // 保存到原文件
    fs.writeFileSync('.env.local', updatedContent);
    
    console.log('API 密钥已成功更新到 .env.local 文件');
    
    // 创建备份
    fs.writeFileSync('.env.local.backup', envContent);
    console.log('原始 .env.local 已备份到 .env.local.backup');
    
    rl.close();
  } catch (error) {
    console.error('更新 API 密钥时出错:', error);
    rl.close();
  }
}

// 运行更新脚本
updateApiKey(); 