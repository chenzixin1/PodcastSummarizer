import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import LiteYouTubeEmbed from '../../components/LiteYouTubeEmbed';
import '@testing-library/jest-dom';

const VIDEO_ID = 'I9aGC6Ui3eE';
const TITLE = 'Demo podcast video';
const SECOND_VIDEO_ID = 'dQw4w9WgXcQ';
const SECOND_TITLE = 'Replacement podcast video';
const PERMISSION_POLICY =
  'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share';

describe('LiteYouTubeEmbed', () => {
  test('renders an accessible fixed-aspect placeholder without a remote YouTube resource', () => {
    const { container } = render(<LiteYouTubeEmbed videoId={VIDEO_ID} title={TITLE} />);

    expect(screen.getByRole('button', { name: `Play ${TITLE}` })).toHaveClass('aspect-video');
    expect(container.querySelectorAll('iframe')).toHaveLength(0);
    expect(container.innerHTML).not.toMatch(/youtube(?:-nocookie)?\.com|ytimg\.com/i);
  });

  test('creates one permission-preserving iframe after click and moves focus to it', async () => {
    const user = userEvent.setup();
    const { container } = render(<LiteYouTubeEmbed videoId={VIDEO_ID} title={TITLE} />);

    await user.click(screen.getByRole('button', { name: `Play ${TITLE}` }));

    const iframe = screen.getByTitle(TITLE);
    expect(container.querySelectorAll('iframe')).toHaveLength(1);
    expect(iframe).toHaveAttribute(
      'src',
      `https://www.youtube-nocookie.com/embed/${VIDEO_ID}?autoplay=1`
    );
    expect(iframe).toHaveAttribute('loading', 'lazy');
    expect(iframe).toHaveAttribute('allow', PERMISSION_POLICY);
    expect(iframe).toHaveAttribute('referrerpolicy', 'strict-origin-when-cross-origin');
    expect(iframe).toHaveAttribute('allowfullscreen');
    await waitFor(() => expect(iframe).toHaveFocus());
  });

  test('requires fresh activation when the video ID changes on the same component instance', async () => {
    const user = userEvent.setup();
    const { container, rerender } = render(
      <LiteYouTubeEmbed videoId={VIDEO_ID} title={TITLE} />
    );

    await user.click(screen.getByRole('button', { name: `Play ${TITLE}` }));
    expect(screen.getByTitle(TITLE)).toHaveAttribute(
      'src',
      `https://www.youtube-nocookie.com/embed/${VIDEO_ID}?autoplay=1`
    );

    rerender(<LiteYouTubeEmbed videoId={SECOND_VIDEO_ID} title={SECOND_TITLE} />);

    expect(container.querySelectorAll('iframe')).toHaveLength(0);
    const replacementPlayButton = screen.getByRole('button', {
      name: `Play ${SECOND_TITLE}`,
    });

    await user.click(replacementPlayButton);

    expect(container.querySelectorAll('iframe')).toHaveLength(1);
    expect(screen.getByTitle(SECOND_TITLE)).toHaveAttribute(
      'src',
      `https://www.youtube-nocookie.com/embed/${SECOND_VIDEO_ID}?autoplay=1`
    );
  });

  test('requires fresh activation when an inactive A video returns after A to B to A transitions', async () => {
    const user = userEvent.setup();
    const { container, rerender } = render(
      <LiteYouTubeEmbed videoId={VIDEO_ID} title={TITLE} />
    );

    await user.click(screen.getByRole('button', { name: `Play ${TITLE}` }));
    expect(container.querySelectorAll('iframe')).toHaveLength(1);

    rerender(<LiteYouTubeEmbed videoId={SECOND_VIDEO_ID} title={SECOND_TITLE} />);
    expect(container.querySelectorAll('iframe')).toHaveLength(0);

    rerender(<LiteYouTubeEmbed videoId={VIDEO_ID} title={TITLE} />);
    expect(container.querySelectorAll('iframe')).toHaveLength(0);

    await user.click(screen.getByRole('button', { name: `Play ${TITLE}` }));
    expect(container.querySelectorAll('iframe')).toHaveLength(1);
    expect(screen.getByTitle(TITLE)).toHaveAttribute(
      'src',
      `https://www.youtube-nocookie.com/embed/${VIDEO_ID}?autoplay=1`
    );
  });

  test('creates exactly one iframe when the focused placeholder receives Enter', async () => {
    const user = userEvent.setup();
    const { container } = render(<LiteYouTubeEmbed videoId={VIDEO_ID} title={TITLE} />);
    const playButton = screen.getByRole('button', { name: `Play ${TITLE}` });

    playButton.focus();
    await user.keyboard('{Enter}');

    expect(container.querySelectorAll('iframe')).toHaveLength(1);
    expect(screen.getByTitle(TITLE)).toHaveFocus();
  });
});
