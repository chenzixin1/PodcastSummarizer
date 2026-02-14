/**
 * @jest-environment node
 */

jest.mock('@vercel/postgres', () => ({
  sql: jest.fn(),
}));

jest.mock('../../lib/db', () => ({
  ensureExtensionMonitorTables: jest.fn().mockResolvedValue(undefined),
}));

import { sql } from '@vercel/postgres';
import {
  createExtensionMonitorTask,
  listExtensionMonitorTasks,
  recordExtensionMonitorEvent,
} from '../../lib/extensionMonitor';

const mockSql = sql as jest.MockedFunction<typeof sql>;
const { ensureExtensionMonitorTables } = require('../../lib/db');

describe('extensionMonitor', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.EXTENSION_MONITOR_ENABLED = 'true';
    process.env.EXTENSION_MONITOR_CAPTURE_RAW = 'true';
    process.env.EXTENSION_MONITOR_RETENTION_DAYS = '3';
  });

  it('returns null when monitor is disabled', async () => {
    process.env.EXTENSION_MONITOR_ENABLED = 'false';

    const result = await createExtensionMonitorTask({
      path: 'path1',
      status: 'received',
      stage: 'request_received',
      userId: 'u1',
      userEmail: 'user@example.com',
    });

    expect(result).toBeNull();
    expect(mockSql).not.toHaveBeenCalled();
    expect(ensureExtensionMonitorTables).not.toHaveBeenCalled();
  });

  it('redacts password in recorded request body', async () => {
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(0);

    mockSql.mockResolvedValue({
      rows: [
        {
          id: 1,
          taskId: 't1',
          level: 'info',
          stage: 'request_received',
          endpoint: '/api/extension/auth/login',
          httpStatus: 200,
          message: 'ok',
          requestHeaders: { authorization: 'Bearer test-token' },
          requestBody: { email: 'demo@example.com', password: '***' },
          responseHeaders: null,
          responseBody: null,
          errorStack: null,
          meta: null,
          createdAt: '2026-01-01T00:00:00.000Z',
        },
      ],
    } as any);

    const event = await recordExtensionMonitorEvent({
      taskId: 't1',
      stage: 'request_received',
      endpoint: '/api/extension/auth/login',
      requestBody: {
        email: 'demo@example.com',
        password: 'secret123',
      },
      requestHeaders: {
        authorization: 'Bearer test-token',
      },
    });

    const values = mockSql.mock.calls[0].slice(1);
    const joined = values.map((value) => (typeof value === 'string' ? value : '')).join(' ');

    expect(event).not.toBeNull();
    expect(joined).toContain('"password":"***"');
    expect(joined).toContain('Bearer test-token');
    expect(joined).not.toContain('secret123');

    nowSpy.mockRestore();
  });

  it('lists tasks with pagination metadata', async () => {
    mockSql
      .mockResolvedValueOnce({
        rows: [{ total: 1 }],
      } as any)
      .mockResolvedValueOnce({
        rows: [
          {
            id: 'm1',
            path: 'path2',
            status: 'transcribing',
            stage: 'provider_polling',
            userId: 'u1',
            userEmail: 'demo@example.com',
            clientTaskId: 'c1',
            traceId: 'tr1',
            sourceReference: 'https://youtube.com/watch?v=abc',
            videoId: 'abc123xyz00',
            title: 'Demo title',
            isPublic: false,
            transcriptionJobId: 'tj1',
            podcastId: null,
            providerTaskId: 'pv1',
            lastErrorCode: null,
            lastErrorMessage: null,
            lastHttpStatus: null,
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:01.000Z',
          },
        ],
      } as any);

    const result = await listExtensionMonitorTasks({
      page: 1,
      pageSize: 20,
      path: 'path2',
      status: 'transcribing',
      q: 'demo',
    });

    expect(result.total).toBe(1);
    expect(result.page).toBe(1);
    expect(result.pageSize).toBe(20);
    expect(result.tasks).toHaveLength(1);
    expect(result.tasks[0].id).toBe('m1');
    expect(result.tasks[0].path).toBe('path2');
  });
});
