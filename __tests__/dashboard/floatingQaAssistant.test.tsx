import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import FloatingQaAssistant from '../../components/FloatingQaAssistant';

jest.mock('react-markdown', () => ({ __esModule: true, default: ({ children }: { children: string }) => <div>{children}</div> }));
jest.mock('remark-gfm', () => ({ __esModule: true, default: jest.fn() }));

test('history must finish before a question can be sent by click or Enter', async () => {
  let resolveHistory!: (value: unknown) => void;
  const history = new Promise(resolve => { resolveHistory = resolve; });
  const fetchMock = jest.fn().mockReturnValueOnce(history).mockResolvedValue({
    ok: true, json: async () => ({ success: true, data: { id: 'answer-1', answer: 'A grounded answer.' } }),
  });
  global.fetch = fetchMock;
  Element.prototype.scrollTo = jest.fn();
  render(<FloatingQaAssistant podcastId="podcast-1" enabled />);
  fireEvent.change(screen.getByRole('textbox', { name: '你的问题' }), { target: { value: 'My question?' } });
  expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();
  fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' });
  expect(fetchMock).toHaveBeenCalledTimes(1);
  await act(async () => resolveHistory({ ok: true, json: async () => ({ success: true, data: { messages: [] } }) }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Send' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: 'Send' }));
  await screen.findByText('A grounded answer.');
  expect(screen.getByText('My question?')).toBeInTheDocument();
  expect(fetchMock).toHaveBeenCalledTimes(2);
});
