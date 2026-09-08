import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import Page from '../../app/watchless/jobs/page';
jest.mock('../../components/AppFrame', () => ({ __esModule: true, default: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
const job = { id: 'wl_one', title: 'Test video', sourceKind: 'url', status: 'failed', stage: 'preparing_metadata', progressCurrent: 5, progressTotal: 100, createdAt: '2026-09-08 03:00:00', errorMessage: 'Duration exceeded', creditStatus: 'reserved', creditsReserved: 1000 };
const payload = (data = [job], page = 1) => ({ ok: true, status: 200, json: async () => ({ success: true, data, pagination: { page, total: 21, totalPages: 2 } }) });
describe('My conversion tasks', () => {
  beforeEach(() => { global.fetch = jest.fn().mockResolvedValue(payload()); });
  test('shows failure, stage and actual credit state, links to details', async () => {
    render(<Page />);
    expect(await screen.findByText('失败原因：Duration exceeded')).toBeInTheDocument();
    expect(screen.getByText('停止阶段：读取视频信息')).toBeInTheDocument();
    expect(screen.getByText('已预留 1000 积分')).toBeInTheDocument();
    expect(screen.queryByText('已退回 1000 积分')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: '任务详情' })).toHaveAttribute('href', '/watchless/jobs/wl_one');
  });
  test('requests next page and resets page on filter change', async () => {
    render(<Page />);
    await screen.findByText('转换失败');
    fireEvent.click(screen.getByRole('button', { name: '下一页' }));
    await waitFor(() => expect(fetch).toHaveBeenCalledWith('/api/watchless/jobs?page=2&status=all', expect.anything()));
    fireEvent.change(screen.getByLabelText('任务状态'), { target: { value: 'failed' } });
    await waitFor(() => expect(fetch).toHaveBeenCalledWith('/api/watchless/jobs?page=1&status=failed', expect.anything()));
  });
  test('unauthenticated users get sign-in, not task records', async () => {
    (fetch as jest.Mock).mockResolvedValue({ status: 401 });
    render(<Page />);
    expect(await screen.findByRole('link', { name: '登录' })).toBeInTheDocument();
    expect(screen.queryByText('Test video')).not.toBeInTheDocument();
  });
  test('late response from previous filter cannot replace current results', async () => {
    let resolveOld: (value: unknown) => void = () => {};
    (fetch as jest.Mock).mockImplementationOnce(() => new Promise(resolve => { resolveOld = resolve; })).mockResolvedValue(payload([]));
    render(<Page />);
    fireEvent.change(screen.getByLabelText('任务状态'), { target: { value: 'failed' } });
    expect(await screen.findByText('没有符合这个状态的任务。')).toBeInTheDocument();
    resolveOld(payload());
    await waitFor(() => expect(screen.queryByText('Test video')).not.toBeInTheDocument());
  });
  test('MCP successes expose article and genuine refund status', async () => {
    (fetch as jest.Mock).mockResolvedValue(payload([{ ...job, status: 'completed', sourceKind: 'mcp_bundle', creditStatus: 'refunded', outputPodcastId: 'article-1' } as typeof job]));
    render(<Page />);
    expect(await screen.findByRole('link', { name: '查看文章' })).toHaveAttribute('href', '/dashboard/article-1');
    expect(screen.getByText('已退回 1000 积分')).toBeInTheDocument();
  });
});
