const nextJest = require('next/jest');

const createJestConfig = nextJest({
  // 指向Next.js应用根目录
  dir: './',
});

// 自定义配置
const customJestConfig = {
  setupFilesAfterEnv: ['<rootDir>/jest.setup.js'],
  testEnvironment: 'jest-environment-jsdom',
  testPathIgnorePatterns: [
    '<rootDir>/node_modules/',
    '<rootDir>/.next/'
  ],
  moduleNameMapper: {
    // 处理模块别名
    '^@/(.*)$': '<rootDir>/$1',
  },
};

// createJestConfig会将Next.js的配置和自定义配置合并
module.exports = createJestConfig(customJestConfig); 