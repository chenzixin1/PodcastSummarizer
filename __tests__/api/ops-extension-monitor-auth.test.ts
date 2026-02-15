/**
 * @jest-environment node
 */

import { NextRequest } from 'next/server';
import { GET as GET_LIST } from '../../app/api/ops/extension-monitor/tasks/route';
import { GET as GET_DETAIL } from '../../app/api/ops/extension-monitor/tasks/[id]/route';

jest.mock('next-auth/next', () => ({
  getServerSession: jest.fn(),
}));

jest.mock('../../lib/auth', () => ({
  authOptions: {},
}));

jest.mock('../../lib/extensionMonitor', () => ({
  isExtensionMonitorEnabled: jest.fn(),
  isExtensionMonitorCaptureRawEnabled: jest.fn(),
  listExtensionMonitorTasks: jest.fn(),
  getExtensionMonitorTaskDetail: jest.fn(),
}));

const mockGetServerSession = jest.fn();
const mockIsExtensionMonitorEnabled = jest.fn();
const mockIsExtensionMonitorCaptureRawEnabled = jest.fn();
const mockListExtensionMonitorTasks = jest.fn();
const mockGetExtensionMonitorTaskDetail = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();

  require('next-auth/next').getServerSession = mockGetServerSession;
  require('../../lib/extensionMonitor').isExtensionMonitorEnabled = mockIsExtensionMonitorEnabled;
  require('../../lib/extensionMonitor').isExtensionMonitorCaptureRawEnabled =
    mockIsExtensionMonitorCaptureRawEnabled;
  require('../../lib/extensionMonitor').listExtensionMonitorTasks = mockListExtensionMonitorTasks;
  require('../../lib/extensionMonitor').getExtensionMonitorTaskDetail = mockGetExtensionMonitorTaskDetail;

  mockIsExtensionMonitorEnabled.mockReturnValue(true);
  mockIsExtensionMonitorCaptureRawEnabled.mockReturnValue(false);
  mockListExtensionMonitorTasks.mockResolvedValue({
    tasks: [],
    total: 0,
    page: 1,
    pageSize: 20,
  });
  mockGetExtensionMonitorTaskDetail.mockResolvedValue({
    task: {
      id: 'task-1',
      path: 'path1',
      status: 'received',
      stage: 'start',
    },
    events: [],
  });
});

describe('Extension monitor auth fallback', () => {
  it('allows list API when session has email but no id', async () => {
    mockGetServerSession.mockResolvedValue({
      user: { email: 'demo@example.com' },
    });

    const request = new NextRequest('http://localhost:3000/api/ops/extension-monitor/tasks?page=1');
    const response = await GET_LIST(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(mockListExtensionMonitorTasks).toHaveBeenCalled();
  });

  it('allows detail API when session has email but no id', async () => {
    mockGetServerSession.mockResolvedValue({
      user: { email: 'demo@example.com' },
    });

    const request = new NextRequest('http://localhost:3000/api/ops/extension-monitor/tasks/task-1');
    const response = await GET_DETAIL(request, { params: Promise.resolve({ id: 'task-1' }) });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.task.id).toBe('task-1');
    expect(mockGetExtensionMonitorTaskDetail).toHaveBeenCalledWith('task-1');
  });

  it('rejects list API when neither id nor email exists in session', async () => {
    mockGetServerSession.mockResolvedValue({ user: {} });

    const request = new NextRequest('http://localhost:3000/api/ops/extension-monitor/tasks');
    const response = await GET_LIST(request);
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.success).toBe(false);
    expect(body.code).toBe('AUTH_REQUIRED');
  });
});
