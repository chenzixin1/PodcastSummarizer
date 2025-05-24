// 导入jest-dom扩展断言
import '@testing-library/jest-dom';

// 模拟localStorage (仅在jsdom环境中)
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

// 全局模拟localStorage (仅在jsdom环境中)
if (typeof window !== 'undefined') {
  Object.defineProperty(window, 'localStorage', {
    value: new LocalStorageMock(),
  });
}

// 模拟TextEncoder和TextDecoder
global.TextEncoder = require('util').TextEncoder;
global.TextDecoder = require('util').TextDecoder;

// Mock NextResponse for API route testing
jest.mock('next/server', () => ({
  NextRequest: jest.requireActual('next/server').NextRequest,
  NextResponse: {
    json: (data, options = {}) => {
      const status = options.status || 200;
      const headers = new Map();
      
      // Set content-type header
      headers.set('content-type', 'application/json');
      
      // Add any custom headers
      if (options.headers) {
        Object.entries(options.headers).forEach(([key, value]) => {
          headers.set(key, value);
        });
      }
      
      return {
        status,
        headers: {
          get: (name) => headers.get(name.toLowerCase()),
          set: (name, value) => headers.set(name.toLowerCase(), value),
          has: (name) => headers.has(name.toLowerCase())
        },
        json: () => Promise.resolve(data),
        ok: status >= 200 && status < 300
      };
    }
  }
}));

// Mock Request and Response for Next.js API testing
if (typeof global.Request === 'undefined') {
  global.Request = class MockRequest {
    constructor(url, options = {}) {
      this._url = url;
      this.method = options.method || 'GET';
      this.headers = new Map();
      this._body = options.body;
      
      // Handle headers
      if (options.headers) {
        if (options.headers instanceof Map) {
          this.headers = options.headers;
        } else if (typeof options.headers === 'object') {
          Object.entries(options.headers).forEach(([key, value]) => {
            this.headers.set(key, value);
          });
        }
      }
    }
    
    get url() {
      return this._url;
    }
    
    async formData() {
      return this._body;
    }
    
    async json() {
      return JSON.parse(this._body);
    }
    
    async text() {
      return this._body;
    }
  };
}

if (typeof global.Response === 'undefined') {
  global.Response = class MockResponse {
    constructor(body, options = {}) {
      this.body = body;
      this.status = options.status || 200;
      this.statusText = options.statusText || 'OK';
      this.headers = new Map();
      
      if (options.headers) {
        Object.entries(options.headers).forEach(([key, value]) => {
          this.headers.set(key, value);
        });
      }
    }
    
    get(name) {
      return this.headers.get(name);
    }
    
    async json() {
      if (typeof this.body === 'object' && this.body !== null) {
        return this.body;
      }
      return JSON.parse(this.body);
    }
    
    async text() {
      return typeof this.body === 'string' ? this.body : JSON.stringify(this.body);
    }
  };
}

// Mock Headers
if (typeof global.Headers === 'undefined') {
  global.Headers = Map;
}

// 模拟Web APIs for API route testing
// Mock File API
if (typeof global.File === 'undefined') {
  global.File = class MockFile {
    constructor(chunks, filename, options = {}) {
      this.name = filename;
      this.size = chunks.reduce((size, chunk) => size + chunk.length, 0);
      this.type = options.type || '';
      this.lastModified = Date.now();
      this._chunks = chunks;
    }
  };
}

// Mock FormData
if (typeof global.FormData === 'undefined') {
  global.FormData = class MockFormData {
    constructor() {
      this._data = new Map();
    }
    
    append(key, value) {
      this._data.set(key, value);
    }
    
    get(key) {
      return this._data.get(key);
    }
    
    has(key) {
      return this._data.has(key);
    }
  };
}

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

// 模拟window.scrollIntoView (仅在jsdom环境中)
if (typeof Element !== 'undefined') {
  Element.prototype.scrollIntoView = jest.fn();
}

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