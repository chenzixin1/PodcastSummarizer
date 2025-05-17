// 导入jest-dom扩展断言
import '@testing-library/jest-dom';

// 模拟localStorage
class LocalStorageMock {
  constructor() {
    this.store = {};
  }

  clear() {
    this.store = {};
  }

  getItem(key) {
    return this.store[key] || null;
  }

  setItem(key, value) {
    this.store[key] = String(value);
  }

  removeItem(key) {
    delete this.store[key];
  }
}

// 全局模拟localStorage
Object.defineProperty(window, 'localStorage', {
  value: new LocalStorageMock(),
});

// 模拟TextEncoder和TextDecoder
global.TextEncoder = require('util').TextEncoder;
global.TextDecoder = require('util').TextDecoder;

// 模拟fetch和ReadableStream
if (typeof global.fetch !== 'function') {
  global.fetch = jest.fn();
}

if (typeof global.ReadableStream === 'undefined') {
  global.ReadableStream = class MockReadableStream {
    constructor({ start }) {
      this.controller = {
        enqueue: jest.fn(),
        close: jest.fn(),
      };
      start(this.controller);
    }
  };
}

// 模拟window.scrollIntoView
Element.prototype.scrollIntoView = jest.fn();

// 静默控制台报错
jest.spyOn(console, 'error').mockImplementation(() => {});
jest.spyOn(console, 'warn').mockImplementation(() => {});

// 模拟next/navigation
jest.mock('next/navigation', () => ({
  useParams: jest.fn(),
  useRouter: jest.fn(() => ({
    push: jest.fn(),
    replace: jest.fn(),
    prefetch: jest.fn(),
  })),
})); 