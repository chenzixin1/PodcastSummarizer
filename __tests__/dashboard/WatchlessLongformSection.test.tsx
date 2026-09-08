import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';
import WatchlessLongformSection from '../../components/watchless/WatchlessLongformSection';
import type { WatchlessArticle } from '../../lib/watchless/article';

jest.mock('next/dynamic', () => () => function Reader({ active }: { active: boolean }) { return <a href="#source" data-reader-active={String(active)}>Original source</a>; });

test('loads only on expansion, makes collapsed content inert, and respects reduced motion', async () => {
  const scroll = jest.fn();
  Element.prototype.scrollIntoView = scroll;
  window.matchMedia = jest.fn().mockReturnValue({ matches: true });
  window.requestAnimationFrame = callback => { callback(0); return 1; };
  const loadArticle = jest.fn().mockResolvedValue({} as WatchlessArticle);
  const { container } = render(<WatchlessLongformSection articleMeta={{sceneCount:10,durationLabel:'45:00'}} loadArticle={loadArticle} />);
  expect(loadArticle).not.toHaveBeenCalled();
  expect(container.querySelector('.watchless-expand-region')).toHaveAttribute('inert');
  await userEvent.click(screen.getByRole('button', {name:/继续阅读完整图文/}));
  await waitFor(() => expect(loadArticle).toHaveBeenCalledTimes(1));
  expect(container.querySelector('.watchless-expand-region')).not.toHaveAttribute('inert');
  expect(screen.getByRole('link')).toHaveAttribute('data-reader-active', 'true');
  await userEvent.click(screen.getByRole('button', {name:/收起完整图文/}));
  expect(container.querySelector('.watchless-expand-region')).toHaveAttribute('inert');
  expect(container.querySelector('[data-reader-active]')).toHaveAttribute('data-reader-active', 'false');
  expect(scroll).toHaveBeenCalledWith({block:'center',behavior:'auto'});
  expect(screen.getByRole('button', {name:/继续阅读完整图文/})).toHaveFocus();
});
