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
    '<rootDir>/.next/',
    '<rootDir>/__tests__/utils/requestTracker.ts',
    '<rootDir>/__tests__/dashboard/DashboardPage.test.tsx',
  ],
  moduleNameMapper: {
    // 处理模块别名
    '^@/(.*)$': '<rootDir>/$1',
    // Mock nanoid to avoid ES module issues
    '^nanoid$': '<rootDir>/__mocks__/nanoid.js',
  },
  transformIgnorePatterns: [
    'node_modules/(?!(react-markdown|remark|unified|bail|is-plain-obj|trough|vfile|unist|mdast|micromark|decode-named-character-reference|character-entities|property-information|hast-util-whitespace|space-separated-tokens|comma-separated-tokens|pretty-bytes)/)',
  ],
  extensionsToTreatAsEsm: ['.ts', '.tsx'],
  globals: {
    'ts-jest': {
      useESM: true,
    },
  },
};

// createJestConfig会将Next.js的配置和自定义配置合并
module.exports = createJestConfig(customJestConfig); 