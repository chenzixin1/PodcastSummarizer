import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';
import WatchlessReader from '../../components/watchless/WatchlessReader';
import type { WatchlessArticle } from '../../lib/watchless/article';

jest.mock('next/image', () => function MockImage(props: React.ImgHTMLAttributes<HTMLImageElement> & { priority?: boolean }) {
  const imageProps = { ...props };
  delete imageProps.priority;
  // eslint-disable-next-line @next/next/no-img-element
  return <img {...imageProps} alt={props.alt || ''} />;
});

jest.mock('react-markdown', () => function MockMarkdown({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
});

jest.mock('remark-gfm', () => () => null);

class NoopIntersectionObserver implements IntersectionObserver {
  readonly root = null;
  readonly rootMargin = '';
  readonly thresholds = [];
  disconnect = jest.fn();
  observe = jest.fn();
  takeRecords = jest.fn(() => []);
  unobserve = jest.fn();
}

const article: WatchlessArticle = {
  id: 'watchless-demo',
  videoId: 'hI2KB8eiZwY',
  title: 'Original title',
  titleZh: '中文标题',
  eyebrow: 'Watchless',
  author: 'PodSum',
  sourceName: 'YouTube',
  sourceUrl: 'https://www.youtube.com/watch?v=hI2KB8eiZwY',
  pdfUrl: '/api/files/watchless/demo/article.pdf',
  durationSec: 60,
  durationLabel: '01:00',
  publishedLabel: '1 个场景',
  summaryZh: '中文导读唯一内容。',
  summaryEn: 'Unique English overview.',
  bodyMode: 'verbatim',
  articleZhKind: 'translation',
  transcriptLanguage: 'en',
  availableLanguageModes: ['zh', 'en', 'bilingual', 'hint'],
  scenes: [{
    id: 'scene-1',
    number: 1,
    titleZh: '第一幕',
    timeLabel: '00:00–01:00',
    startSec: 0,
    endSec: 60,
    keyframe: '/watchless/demo.jpg',
    keyframeAlt: '两人对谈',
    articleZh: '**Ti Morse：** 中文翻译唯一正文。',
    transcriptEn: 'Ti Morse: Unique original English transcript.',
    visualDescriptionZh: '两人正在交谈。',
    boundaryReasonEn: 'Opening exchange.',
  }],
};

describe('WatchlessReader language modes', () => {
  beforeEach(() => {
    global.IntersectionObserver = NoopIntersectionObserver;
    global.fetch = jest.fn(async () => ({
      ok: true,
      json: async () => ({ original: { zh: '原始的', level: ['CET6'] } }),
    })) as jest.Mock;
  });

  test('switches among Chinese translation, English original, bilingual, and vocabulary hints', async () => {
    render(<WatchlessReader article={article} />);

    expect(screen.getAllByRole('button', { name: /中文.*忠实翻译/ }).length).toBeGreaterThan(0);
    expect(document.body).toHaveTextContent('中文翻译唯一正文');
    expect(document.body).not.toHaveTextContent('Unique original English transcript');
    expect(document.body).toHaveTextContent('中文翻译 · 按原话逐条对齐');

    await userEvent.click(screen.getByRole('button', { name: /English.*Transcript/ }));
    expect(document.body).toHaveTextContent('Unique original English transcript');
    expect(document.body).not.toHaveTextContent('中文翻译唯一正文');
    expect(document.body).toHaveTextContent('English transcript · 英文原话');

    await userEvent.click(screen.getByRole('button', { name: /中英对照.*逐场景/ }));
    expect(document.body).toHaveTextContent('中文翻译唯一正文');
    expect(document.body).toHaveTextContent('Unique original English transcript');
    expect(document.body).toHaveTextContent('中文导读唯一内容');
    expect(document.body).toHaveTextContent('Unique English overview');

    await userEvent.click(screen.getByRole('button', { name: /词汇提示.*English/ }));
    await waitFor(() => expect(global.fetch).toHaveBeenCalledWith('/vocab/advanced-words.json'));
    expect(document.body).toHaveTextContent('Unique original English transcript');
    expect(document.body).toHaveTextContent('在英文原话上标注进阶词汇');
  });
});
