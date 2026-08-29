import React from 'react';
import { render, screen } from '@testing-library/react';
import LiteYouTubeEmbed from '../../components/LiteYouTubeEmbed';
import '@testing-library/jest-dom';

const VIDEO_ID = 'I9aGC6Ui3eE';
const TITLE = 'Demo podcast video';
const SECOND_VIDEO_ID = 'dQw4w9WgXcQ';
const SECOND_TITLE = 'Replacement podcast video';

describe('LiteYouTubeEmbed', () => {
  test('makes the complete preview a YouTube link without playback controls', () => {
    const { container } = render(<LiteYouTubeEmbed videoId={VIDEO_ID} title={TITLE} />);

    const previewLink = screen.getByRole('link', { name: `在 YouTube 打开原视频：${TITLE}` });
    expect(previewLink).toHaveAttribute('href', `https://www.youtube.com/watch?v=${VIDEO_ID}`);
    expect(previewLink).toHaveAttribute('target', '_blank');
    expect(container.querySelector('img')).toHaveAttribute(
      'src',
      `https://i.ytimg.com/vi/${VIDEO_ID}/hqdefault.jpg`,
    );
    expect(container.querySelectorAll('iframe')).toHaveLength(0);
    expect(container.querySelectorAll('button')).toHaveLength(0);
  });

  test('updates the destination and thumbnail when the video changes', () => {
    const { container, rerender } = render(
      <LiteYouTubeEmbed videoId={VIDEO_ID} title={TITLE} />,
    );

    rerender(<LiteYouTubeEmbed videoId={SECOND_VIDEO_ID} title={SECOND_TITLE} />);

    expect(screen.getByRole('link', { name: `在 YouTube 打开原视频：${SECOND_TITLE}` }))
      .toHaveAttribute('href', `https://www.youtube.com/watch?v=${SECOND_VIDEO_ID}`);
    expect(container.querySelector('img')).toHaveAttribute(
      'src',
      `https://i.ytimg.com/vi/${SECOND_VIDEO_ID}/hqdefault.jpg`,
    );
  });
});
