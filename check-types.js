const { exec } = require('child_process');

console.log('正在检查TypeScript类型...');
exec('npx tsc --noEmit', (error, stdout, stderr) => {
  if (error) {
    console.log('发现TypeScript错误:');
    console.log(stderr);
    process.exit(1);
  } else {
    console.log('✅ TypeScript类型检查通过!');
    process.exit(0);
  }
});